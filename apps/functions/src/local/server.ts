/**
 * Local development server. Serves the dashboard API and the webhook on one port, the way API
 * Gateway does in AWS, and runs reviews in-process instead of through SQS.
 *
 *   npm run dev -w apps/functions
 *
 * Set LOCAL_DEMO=true to skip GitHub entirely: sign-in is faked and a few demo repos and
 * reviews are loaded, which is enough to work on the dashboard.
 */
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import OpenAI from "openai";
import { getSecret, log } from "../config.js";
import { OpenAIReviewer } from "../core/llm.js";
import { reviewPullRequest } from "../core/review.js";
import { DEFAULT_SETTINGS } from "../core/settings.js";
import { OctokitClient } from "../github/client.js";
import { GitHubUserApi, type UserGitHub } from "../github/user.js";
import { createApiHandler } from "../handlers/api.js";
import { createWebhookHandler } from "../handlers/webhook.js";
import { DynamoStore } from "../store/dynamo.js";
import { MemoryStore } from "../store/memory.js";
import { ensureTable } from "../store/table.js";
import type { Store } from "../store/types.js";

const PORT = Number(process.env.PORT ?? 8787);
const DEMO = process.env.LOCAL_DEMO === "true";
const dashboardUrl = process.env.DASHBOARD_URL ?? "http://localhost:5173";

async function createStore(): Promise<Store> {
  if (!process.env.DYNAMODB_ENDPOINT) return new MemoryStore();
  const client = new DynamoDBClient({
    endpoint: process.env.DYNAMODB_ENDPOINT,
    region: "us-east-1",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
  await ensureTable(client, "reviewbot-local");
  return new DynamoStore("reviewbot-local", client);
}

/** Pretends to be GitHub for dashboard work without a GitHub App. */
const demoGitHub: UserGitHub = {
  exchangeCode: async () => "demo-token",
  getUser: async () => ({ login: "demo-user", avatarUrl: "https://github.com/identicons/demo.png" }),
  listRepos: async () => [
    { fullName: "acme/storefront", private: true, canManage: true },
    { fullName: "acme/payments-api", private: true, canManage: true },
    { fullName: "acme/docs", private: false, canManage: false },
  ],
};

async function seedDemo(store: Store) {
  await store.putSettings("acme/docs", { ...DEFAULT_SETTINGS, enabled: false }, "demo-user");
  const runs = [
    { pr: 482, title: "Add discount codes at checkout", status: "COMPLETED", comments: 3, filtered: 4, files: 9 },
    { pr: 479, title: "Cache product images on the CDN", status: "COMPLETED", comments: 0, filtered: 1, files: 4 },
    { pr: 477, title: "WIP: new search page", status: "SKIPPED", note: "draft pull request" },
    { pr: 475, title: "Fix tax rounding for CA orders", status: "COMPLETED", comments: 1, filtered: 2, files: 2 },
    { pr: 471, title: "Upgrade to Node 22", status: "FAILED", note: "OpenAI API rate limit exceeded (retried)" },
  ] as const;
  for (const [i, r] of runs.entries()) {
    const startedAt = new Date(Date.now() - (i * 7 + 1) * 3600_000).toISOString();
    await store.finishReview({
      repo: "acme/storefront",
      prNumber: r.pr,
      headSha: randomBytes(20).toString("hex"),
      prTitle: r.title,
      status: r.status,
      startedAt,
      finishedAt: startedAt,
      ...("comments" in r
        ? {
            commentsPosted: r.comments,
            filteredOut: r.filtered,
            filesReviewed: r.files,
            reviewUrl: `https://github.com/acme/storefront/pull/${r.pr}`,
          }
        : { note: r.note }),
    });
  }
}

async function main() {
  const store = await createStore();
  if (DEMO) await seedDemo(store);

  const api = createApiHandler({
    store,
    github: DEMO ? demoGitHub : new GitHubUserApi(await getSecret("GITHUB_CLIENT_ID"), await getSecret("GITHUB_CLIENT_SECRET")),
    clientId: DEMO ? "demo" : await getSecret("GITHUB_CLIENT_ID"),
    sessionSecret: process.env.SESSION_SECRET ?? randomBytes(32).toString("base64"),
    dashboardUrl,
    appSlug: process.env.GITHUB_APP_SLUG ?? "reviewbot",
  });

  const webhook = createWebhookHandler({
    webhookSecret: () => getSecret("GITHUB_WEBHOOK_SECRET"),
    // No SQS locally: review right away in the background.
    enqueue: async (job) => {
      const github = OctokitClient.forInstallation(await getSecret("GITHUB_APP_ID"), await getSecret("GITHUB_PRIVATE_KEY"), job.installationId);
      const reviewer = new OpenAIReviewer(new OpenAI({ apiKey: await getSecret("OPENAI_API_KEY") }), process.env.OPENAI_MODEL ?? "gpt-4.1");
      reviewPullRequest({ github, reviewer, store, log: (m, d) => log("info", m, d) }, job).catch((err) =>
        log("error", "review failed", { error: String(err) }),
      );
    },
  });

  createServer(async (req, res) => {
    const event = await toEvent(req);
    let result: APIGatewayProxyStructuredResultV2;
    if (event.rawPath === "/webhook" && req.method === "POST") {
      result = (await webhook(event)) as APIGatewayProxyStructuredResultV2;
    } else if (event.rawPath.startsWith("/api/")) {
      result = await api(event);
      // Demo mode: skip the trip to github.com and come straight back to the callback.
      if (DEMO && event.rawPath === "/api/auth/login") {
        const state = new URL(result.headers!.location as string).searchParams.get("state");
        result.headers = { location: `/api/auth/callback?code=demo&state=${state}` };
      }
    } else {
      result = { statusCode: 404, body: "not found" };
    }
    send(res, result);
  }).listen(PORT, () => log("info", `local server on http://localhost:${PORT}`, { demo: DEMO, dashboardUrl }));
}

async function toEvent(req: IncomingMessage): Promise<APIGatewayProxyEventV2> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const url = new URL(req.url ?? "/", "http://localhost");
  const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v]));
  return {
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    queryStringParameters: Object.fromEntries(url.searchParams),
    headers,
    cookies: req.headers.cookie?.split(";").map((c) => c.trim()),
    body: Buffer.concat(chunks).toString(),
    isBase64Encoded: false,
    requestContext: { http: { method: req.method ?? "GET" } },
  } as unknown as APIGatewayProxyEventV2;
}

function send(res: ServerResponse, result: APIGatewayProxyStructuredResultV2) {
  res.statusCode = result.statusCode ?? 200;
  for (const [k, v] of Object.entries(result.headers ?? {})) res.setHeader(k, String(v));
  if (result.cookies?.length) res.setHeader("set-cookie", result.cookies);
  res.end(result.body ?? "");
}

main();
