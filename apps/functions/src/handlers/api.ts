import { randomBytes } from "node:crypto";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import {
  cookie,
  openSession,
  readCookies,
  type Session,
  SESSION_COOKIE,
  sealSession,
  STATE_COOKIE,
} from "../auth/session.js";
import { env, getSecret, log } from "../config.js";
import { repoSettingsSchema } from "../core/settings.js";
import { GitHubUserApi, type UserGitHub } from "../github/user.js";
import { DynamoStore } from "../store/dynamo.js";
import type { Store } from "../store/types.js";

export interface ApiDeps {
  store: Store;
  github: UserGitHub;
  clientId: string;
  sessionSecret: string;
  /** Public URL of the dashboard, e.g. https://reviewbot.example.com */
  dashboardUrl: string;
  /** Slug of the GitHub App, for the "install on another repo" link. */
  appSlug: string;
}

type Result = APIGatewayProxyStructuredResultV2;

const json = (statusCode: number, body: unknown, cookies?: string[]): Result => ({
  statusCode,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
  body: JSON.stringify(body),
  cookies,
});
const redirect = (location: string, cookies?: string[]): Result => ({ statusCode: 302, headers: { location }, cookies });

const REPO_ROUTE = /^\/api\/repos\/([\w.-]+)\/([\w.-]+)\/(settings|reviews)$/;

/** Backend for the dashboard: GitHub sign-in, the user's repos, and per-repo settings and history. */
export function createApiHandler(deps: ApiDeps) {
  const secure = deps.dashboardUrl.startsWith("https://");
  const callbackUrl = `${deps.dashboardUrl}/api/auth/callback`;

  return async (event: APIGatewayProxyEventV2): Promise<Result> => {
    const method = event.requestContext.http.method;
    const path = event.rawPath;
    const cookies = readCookies(event.cookies, event.headers?.cookie);

    try {
      // ---- sign-in ----
      if (method === "GET" && path === "/api/auth/login") {
        const state = randomBytes(16).toString("hex");
        const url = new URL("https://github.com/login/oauth/authorize");
        url.searchParams.set("client_id", deps.clientId);
        url.searchParams.set("redirect_uri", callbackUrl);
        url.searchParams.set("state", state);
        return redirect(url.toString(), [cookie(STATE_COOKIE, state, 600, secure)]);
      }

      if (method === "GET" && path === "/api/auth/callback") {
        const { code, state } = event.queryStringParameters ?? {};
        // The state cookie ties the callback to a login this browser started (CSRF protection).
        if (!code || !state || state !== cookies[STATE_COOKIE]) return json(400, { error: "invalid sign-in state" });
        const token = await deps.github.exchangeCode(code, callbackUrl);
        const user = await deps.github.getUser(token);
        const sealed = await sealSession({ ...user, token }, deps.sessionSecret);
        log("info", "signed in", { login: user.login });
        return redirect(`${deps.dashboardUrl}/`, [cookie(SESSION_COOKIE, sealed, 8 * 3600, secure), cookie(STATE_COOKIE, "", 0, secure)]);
      }

      if (method === "POST" && path === "/api/auth/logout") {
        return json(200, { ok: true }, [cookie(SESSION_COOKIE, "", 0, secure)]);
      }

      // ---- everything below needs a session ----
      const session = await openSession(cookies[SESSION_COOKIE], deps.sessionSecret);
      if (!session) return json(401, { error: "not signed in" });

      if (method === "GET" && path === "/api/me") {
        return json(200, {
          login: session.login,
          avatarUrl: session.avatarUrl,
          installUrl: `https://github.com/apps/${deps.appSlug}/installations/new`,
        });
      }

      if (method === "GET" && path === "/api/repos") {
        const repos = await deps.github.listRepos(session.token);
        const withStatus = await Promise.all(
          repos.map(async (r) => ({ ...r, enabled: (await deps.store.getSettings(r.fullName)).settings.enabled })),
        );
        return json(200, withStatus.sort((a, b) => a.fullName.localeCompare(b.fullName)));
      }

      const match = REPO_ROUTE.exec(path);
      if (match) {
        const [, owner, name, resource] = match;
        const repo = await findRepo(deps.github, session, `${owner}/${name}`);
        // 404 rather than 403 so the API doesn't reveal which private repos exist.
        if (!repo) return json(404, { error: "repository not found" });

        if (resource === "reviews" && method === "GET") {
          return json(200, await deps.store.listReviews(repo.fullName, 50));
        }
        if (resource === "settings" && method === "GET") {
          const stored = await deps.store.getSettings(repo.fullName);
          return json(200, { ...stored, canManage: repo.canManage });
        }
        if (resource === "settings" && method === "PUT") {
          if (!repo.canManage) return json(403, { error: "you need write access to change settings" });
          const parsed = repoSettingsSchema.safeParse(JSON.parse(event.body ?? "{}"));
          if (!parsed.success) return json(400, { error: "invalid settings", issues: parsed.error.issues });
          await deps.store.putSettings(repo.fullName, parsed.data, session.login);
          log("info", "settings updated", { repo: repo.fullName, by: session.login });
          return json(200, await deps.store.getSettings(repo.fullName));
        }
      }

      return json(404, { error: "not found" });
    } catch (err) {
      log("error", "api error", { path, error: err instanceof Error ? err.message : String(err) });
      return json(500, { error: "something went wrong" });
    }
  };
}

async function findRepo(github: UserGitHub, session: Session, fullName: string) {
  const repos = await github.listRepos(session.token);
  return repos.find((r) => r.fullName.toLowerCase() === fullName.toLowerCase()) ?? null;
}

let handlerPromise: Promise<ReturnType<typeof createApiHandler>> | undefined;

export const handler = async (event: APIGatewayProxyEventV2) => {
  handlerPromise ??= (async () =>
    createApiHandler({
      store: new DynamoStore(env("TABLE_NAME")),
      github: new GitHubUserApi(await getSecret("GITHUB_CLIENT_ID"), await getSecret("GITHUB_CLIENT_SECRET")),
      clientId: await getSecret("GITHUB_CLIENT_ID"),
      sessionSecret: await getSecret("SESSION_SECRET"),
      dashboardUrl: env("DASHBOARD_URL"),
      appSlug: env("GITHUB_APP_SLUG"),
    }))();
  return (await handlerPromise)(event);
};
