import { createHmac } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, SQSEvent, SQSRecord } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";
import type { ReviewJob } from "../core/review.js";
import { createWebhookHandler, verifySignature } from "./webhook.js";
import { createWorkerHandler } from "./worker.js";

const SECRET = "webhook-test-secret";
const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;

function webhookEvent(body: object, opts: { event?: string; signature?: string; base64?: boolean } = {}) {
  const raw = JSON.stringify(body);
  return {
    headers: {
      "X-GitHub-Event": opts.event ?? "pull_request",
      "X-GitHub-Delivery": "delivery-1",
      "X-Hub-Signature-256": opts.signature ?? sign(raw),
    },
    body: opts.base64 ? Buffer.from(raw).toString("base64") : raw,
    isBase64Encoded: opts.base64 ?? false,
  } as unknown as APIGatewayProxyEventV2;
}

const prEvent = (action: string) => ({
  action,
  installation: { id: 42 },
  repository: { name: "shop", owner: { login: "acme" } },
  pull_request: { number: 7, head: { sha: "abc123" } },
});

function setup() {
  const jobs: ReviewJob[] = [];
  const handler = createWebhookHandler({ webhookSecret: async () => SECRET, enqueue: async (j) => void jobs.push(j) });
  const call = async (e: APIGatewayProxyEventV2) => (await handler(e)) as APIGatewayProxyStructuredResultV2;
  return { jobs, call };
}

describe("verifySignature", () => {
  it("accepts GitHub's signature and rejects anything else", () => {
    expect(verifySignature(SECRET, "{}", sign("{}"))).toBe(true);
    expect(verifySignature(SECRET, "{}", sign("{ }"))).toBe(false);
    expect(verifySignature(SECRET, "{}", "sha256=short")).toBe(false);
    expect(verifySignature(SECRET, "{}", undefined)).toBe(false);
  });
});

describe("webhook handler", () => {
  it("queues a review for new pushes to a PR", async () => {
    const { jobs, call } = setup();
    for (const action of ["opened", "synchronize", "reopened", "ready_for_review"]) {
      expect((await call(webhookEvent(prEvent(action)))).statusCode).toBe(202);
    }
    expect(jobs[0]).toEqual({ installationId: 42, owner: "acme", repo: "shop", prNumber: 7, headSha: "abc123", deliveryId: "delivery-1" });
    expect(jobs).toHaveLength(4);
  });

  it("handles base64 bodies from API Gateway", async () => {
    const { jobs, call } = setup();
    expect((await call(webhookEvent(prEvent("opened"), { base64: true }))).statusCode).toBe(202);
    expect(jobs).toHaveLength(1);
  });

  it("rejects bad signatures before parsing anything", async () => {
    const { jobs, call } = setup();
    expect((await call(webhookEvent(prEvent("opened"), { signature: sign("tampered") }))).statusCode).toBe(401);
    expect(jobs).toHaveLength(0);
  });

  it("ignores events and actions that don't need a review", async () => {
    const { jobs, call } = setup();
    expect((await call(webhookEvent({ zen: "hi" }, { event: "ping" }))).statusCode).toBe(200);
    expect((await call(webhookEvent(prEvent("closed")))).statusCode).toBe(204);
    expect((await call(webhookEvent(prEvent("labeled")))).statusCode).toBe(204);
    expect((await call(webhookEvent({ action: "created" }, { event: "issues" }))).statusCode).toBe(204);
    expect(jobs).toHaveLength(0);
  });
});

describe("worker handler", () => {
  const record = (id: string): SQSRecord =>
    ({
      messageId: id,
      body: JSON.stringify({ installationId: 1, owner: "acme", repo: "shop", prNumber: Number(id), headSha: id, deliveryId: id }),
      attributes: { ApproximateReceiveCount: "1" },
    }) as unknown as SQSRecord;

  it("reports only the failed messages so the rest aren't retried", async () => {
    const depsFor = vi.fn(async (job: ReviewJob) => {
      if (job.prNumber === 2) throw new Error("GitHub is down");
      return {
        github: {} as never,
        reviewer: {} as never,
        store: { getSettings: async () => ({ settings: { enabled: false } }) } as never,
      };
    });
    const handler = createWorkerHandler(depsFor);
    const res = await handler({ Records: [record("1"), record("2"), record("3")] } as SQSEvent);
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: "2" }]);
  });
});
