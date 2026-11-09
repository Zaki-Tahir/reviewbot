import { randomBytes } from "node:crypto";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it } from "vitest";
import { openSession, sealSession, SESSION_COOKIE, STATE_COOKIE } from "../auth/session.js";
import { DEFAULT_SETTINGS } from "../core/settings.js";
import type { AccessibleRepo, UserGitHub } from "../github/user.js";
import { MemoryStore } from "../store/memory.js";
import { createApiHandler } from "./api.js";

const SECRET = randomBytes(32).toString("base64");

class FakeGitHub implements UserGitHub {
  repos: AccessibleRepo[] = [
    { fullName: "acme/shop", private: true, canManage: true },
    { fullName: "acme/docs", private: false, canManage: false },
  ];
  async exchangeCode(code: string) {
    if (code !== "good-code") throw new Error("bad code");
    return "user-token";
  }
  async getUser() {
    return { login: "zaki", avatarUrl: "https://avatars.example/zaki" };
  }
  async listRepos(token: string) {
    return token === "user-token" ? this.repos : [];
  }
}

function event(method: string, path: string, opts: { cookies?: string[]; query?: Record<string, string>; body?: object } = {}) {
  return {
    rawPath: path,
    requestContext: { http: { method } },
    headers: {},
    cookies: opts.cookies,
    queryStringParameters: opts.query,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  } as unknown as APIGatewayProxyEventV2;
}

describe("dashboard API", () => {
  let store: MemoryStore;
  let api: ReturnType<typeof createApiHandler>;
  let sessionCookie: string;

  beforeEach(async () => {
    store = new MemoryStore();
    api = createApiHandler({
      store,
      github: new FakeGitHub(),
      clientId: "Iv1.client",
      sessionSecret: SECRET,
      dashboardUrl: "https://reviewbot.example.com",
      appSlug: "acme-reviewbot",
    });
    sessionCookie = `${SESSION_COOKIE}=${await sealSession({ login: "zaki", avatarUrl: "", token: "user-token" }, SECRET)}`;
  });

  it("starts GitHub sign-in with a state cookie", async () => {
    const res = await api(event("GET", "/api/auth/login"));
    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers!.location as string);
    expect(location.origin).toBe("https://github.com");
    expect(location.searchParams.get("redirect_uri")).toBe("https://reviewbot.example.com/api/auth/callback");
    expect(res.cookies![0]).toMatch(new RegExp(`^${STATE_COOKIE}=${location.searchParams.get("state")}; .*HttpOnly.*Secure`));
  });

  it("completes sign-in only when the state matches, and issues an encrypted session", async () => {
    const bad = await api(event("GET", "/api/auth/callback", { query: { code: "good-code", state: "a" }, cookies: [`${STATE_COOKIE}=b`] }));
    expect(bad.statusCode).toBe(400);

    const ok = await api(event("GET", "/api/auth/callback", { query: { code: "good-code", state: "s1" }, cookies: [`${STATE_COOKIE}=s1`] }));
    expect(ok.statusCode).toBe(302);
    const value = ok.cookies![0]!.split(";")[0]!.split("=")[1]!;
    expect(value).not.toContain("user-token"); // encrypted, not just signed
    expect(await openSession(value, SECRET)).toMatchObject({ login: "zaki", token: "user-token" });
  });

  it("requires a valid session", async () => {
    expect((await api(event("GET", "/api/repos"))).statusCode).toBe(401);
    expect((await api(event("GET", "/api/repos", { cookies: [`${SESSION_COOKIE}=garbage`] }))).statusCode).toBe(401);
    const expired = await sealSession({ login: "zaki", avatarUrl: "", token: "user-token" }, SECRET, new Date("2020-01-01"));
    expect((await api(event("GET", "/api/me", { cookies: [`${SESSION_COOKIE}=${expired}`] }))).statusCode).toBe(401);
  });

  it("lists the user's repos with whether reviews are on", async () => {
    await store.putSettings("acme/docs", { ...DEFAULT_SETTINGS, enabled: false }, "someone");
    const res = await api(event("GET", "/api/repos", { cookies: [sessionCookie] }));
    expect(JSON.parse(res.body!)).toEqual([
      { fullName: "acme/docs", private: false, canManage: false, enabled: false },
      { fullName: "acme/shop", private: true, canManage: true, enabled: true },
    ]);
  });

  it("saves valid settings for repos the user can manage", async () => {
    const res = await api(
      event("PUT", "/api/repos/acme/shop/settings", { cookies: [sessionCookie], body: { ...DEFAULT_SETTINGS, minSeverity: "high" } }),
    );
    expect(res.statusCode).toBe(200);
    expect((await store.getSettings("acme/shop")).settings.minSeverity).toBe("high");
    expect((await store.getSettings("acme/shop")).updatedBy).toBe("zaki");
  });

  it("refuses read-only users, unknown repos and invalid settings", async () => {
    const put = (path: string, body: object) => api(event("PUT", path, { cookies: [sessionCookie], body }));
    expect((await put("/api/repos/acme/docs/settings", DEFAULT_SETTINGS)).statusCode).toBe(403);
    expect((await put("/api/repos/someone-else/secret/settings", DEFAULT_SETTINGS)).statusCode).toBe(404);
    expect((await put("/api/repos/acme/shop/settings", { ...DEFAULT_SETTINGS, maxComments: 500 })).statusCode).toBe(400);
  });

  it("returns review history", async () => {
    await store.finishReview({ repo: "acme/shop", prNumber: 3, headSha: "s", status: "COMPLETED", startedAt: "2026-11-09T12:00:00Z" });
    const res = await api(event("GET", "/api/repos/acme/shop/reviews", { cookies: [sessionCookie] }));
    expect(JSON.parse(res.body!)).toHaveLength(1);
  });
});
