import { DeleteTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/core/settings.js";
import { DynamoStore } from "../../src/store/dynamo.js";
import { ensureTable } from "../../src/store/table.js";

const endpoint = process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000";
const client = new DynamoDBClient({
  endpoint,
  region: "us-east-1",
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});
const table = `reviewbot-test-${Date.now()}`;
const store = new DynamoStore(table, client);

describe(`DynamoStore against DynamoDB Local (${endpoint})`, () => {
  beforeAll(() => ensureTable(client, table));
  afterAll(() => client.send(new DeleteTableCommand({ TableName: table })));

  it("returns defaults for a repo with no settings, then round-trips saved settings", async () => {
    expect((await store.getSettings("acme/new")).settings).toEqual(DEFAULT_SETTINGS);

    await store.putSettings("acme/shop", { ...DEFAULT_SETTINGS, minSeverity: "high", maxComments: 5 }, "zaki");
    const saved = await store.getSettings("acme/shop");
    expect(saved.settings).toMatchObject({ minSeverity: "high", maxComments: 5 });
    expect(saved.updatedBy).toBe("zaki");
  });

  it("lets exactly one of several concurrent workers claim a commit", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => store.claimReview("acme/shop", 1, "sha-race")));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("allows re-claiming after a failure or when a claim is stuck, but not after success", async () => {
    const t0 = new Date("2026-11-09T12:00:00Z");
    const base = { repo: "acme/shop", prNumber: 2, headSha: "sha-2", startedAt: t0.toISOString() };

    expect(await store.claimReview("acme/shop", 2, "sha-2", t0)).toBe(true);
    await store.finishReview({ ...base, status: "FAILED", note: "rate limited" });
    expect(await store.claimReview("acme/shop", 2, "sha-2", t0)).toBe(true);

    // still running 5 minutes later: not claimable; 20 minutes later: assumed dead
    expect(await store.claimReview("acme/shop", 2, "sha-2", new Date(t0.getTime() + 5 * 60_000))).toBe(false);
    expect(await store.claimReview("acme/shop", 2, "sha-2", new Date(t0.getTime() + 20 * 60_000))).toBe(true);

    await store.finishReview({ ...base, status: "COMPLETED", commentsPosted: 3 });
    expect(await store.claimReview("acme/shop", 2, "sha-2", new Date(t0.getTime() + 60 * 60_000))).toBe(false);
  });

  it("lists review history newest first, without internal keys", async () => {
    for (const [i, pr] of [10, 11, 12].entries()) {
      await store.finishReview({
        repo: "acme/history",
        prNumber: pr,
        headSha: `sha-${pr}`,
        status: "COMPLETED",
        startedAt: new Date(Date.UTC(2026, 10, 9, 12, i)).toISOString(),
        commentsPosted: i,
      });
    }
    const reviews = await store.listReviews("acme/history", 2);
    expect(reviews.map((r) => r.prNumber)).toEqual([12, 11]);
    expect(reviews[0]).not.toHaveProperty("PK");
    expect(reviews[0]).not.toHaveProperty("expiresAt");
  });
});
