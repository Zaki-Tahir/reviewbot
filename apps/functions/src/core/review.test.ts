import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHubClient, InlineComment, PullRequestInfo } from "../github/client.js";
import { MemoryStore } from "../store/memory.js";
import type { PullRequestFile } from "./diff.js";
import type { ModelComment, Reviewer } from "./llm.js";
import { mapLimit, type ReviewJob, reviewPullRequest } from "./review.js";
import { DEFAULT_SETTINGS } from "./settings.js";

const job: ReviewJob = { installationId: 1, owner: "acme", repo: "shop", prNumber: 7, headSha: "abc123", deliveryId: "d1" };

class FakeGitHub implements GitHubClient {
  pr: PullRequestInfo = {
    number: 7,
    title: "Add quantity to cart total",
    body: "",
    draft: false,
    state: "open",
    headSha: "abc123",
    htmlUrl: "https://github.com/acme/shop/pull/7",
  };
  files: PullRequestFile[] = [
    { filename: "src/cart.ts", status: "modified", additions: 2, deletions: 0, patch: "@@ -1,2 +1,4 @@\n a\n+b\n+c\n d" },
    { filename: "yarn.lock", status: "modified", additions: 10, deletions: 2, patch: "@@ -1 +1 @@\n-x\n+y" },
  ];
  reviews: { body: string; comments: InlineComment[]; commitId: string }[] = [];

  async getPullRequest() {
    return this.pr;
  }
  async listFiles() {
    return this.files;
  }
  async createReview(_o: string, _r: string, _n: number, review: { commitId: string; body: string; comments: InlineComment[] }) {
    this.reviews.push(review);
    return { url: "https://github.com/acme/shop/pull/7#pullrequestreview-1" };
  }
}

const finding = (over: Partial<ModelComment> = {}): ModelComment => ({
  path: "src/cart.ts",
  line: 2,
  category: "bug",
  severity: "high",
  confidence: 0.9,
  title: "Quantity is ignored",
  body: "The total doesn't multiply by quantity.",
  suggestion: null,
  ...over,
});

function fakeReviewer(comments: ModelComment[] = [finding()]): Reviewer & { calls: number } {
  const r = {
    calls: 0,
    reviewChunk: vi.fn(async () => {
      r.calls++;
      return { summary: "Adds quantity support to the cart.", comments };
    }),
    mergeSummaries: vi.fn(async (_pr, summaries: string[]) => summaries.join(" ")),
  };
  return r;
}

describe("reviewPullRequest", () => {
  let github: FakeGitHub;
  let store: MemoryStore;

  beforeEach(() => {
    github = new FakeGitHub();
    store = new MemoryStore();
  });

  it("posts one review with inline comments and records the result", async () => {
    const reviewer = fakeReviewer([finding(), finding({ line: 3, confidence: 0.3 })]);
    const result = await reviewPullRequest({ github, reviewer, store }, job);

    expect(result).toMatchObject({ status: "COMPLETED", commentsPosted: 1, filteredOut: 1, filesReviewed: 1, prTitle: "Add quantity to cart total" });
    expect(github.reviews).toHaveLength(1);
    expect(github.reviews[0]!.commitId).toBe("abc123");
    expect(github.reviews[0]!.comments).toEqual([
      { path: "src/cart.ts", line: 2, body: expect.stringContaining("Quantity is ignored") },
    ]);
    expect(github.reviews[0]!.body).toContain("`yarn.lock`: ignored by settings");
    expect(await store.listReviews("acme/shop", 10)).toHaveLength(1);
  });

  it("does nothing the second time the same commit arrives", async () => {
    const reviewer = fakeReviewer();
    await reviewPullRequest({ github, reviewer, store }, job);
    const again = await reviewPullRequest({ github, reviewer, store }, { ...job, deliveryId: "d2" });

    expect(again).toMatchObject({ status: "SKIPPED", note: "already reviewed" });
    expect(github.reviews).toHaveLength(1);
    expect(reviewer.calls).toBe(1);
  });

  it("skips drafts, closed PRs and commits that were already superseded", async () => {
    const reviewer = fakeReviewer();
    github.pr = { ...github.pr, draft: true };
    expect(await reviewPullRequest({ github, reviewer, store }, job)).toMatchObject({ status: "SKIPPED", note: "draft pull request" });

    github.pr = { ...github.pr, draft: false, headSha: "newer" };
    expect(await reviewPullRequest({ github, reviewer, store }, { ...job, headSha: "older" })).toMatchObject({
      note: "superseded by a newer commit",
    });

    github.pr = { ...github.pr, headSha: "abc999", state: "closed" };
    expect(await reviewPullRequest({ github, reviewer, store }, { ...job, headSha: "abc999" })).toMatchObject({
      note: "pull request is closed",
    });
    expect(reviewer.calls).toBe(0);
  });

  it("respects a repo that turned the bot off", async () => {
    await store.putSettings("acme/shop", { ...DEFAULT_SETTINGS, enabled: false }, "owner");
    const result = await reviewPullRequest({ github, reviewer: fakeReviewer(), store }, job);
    expect(result.status).toBe("SKIPPED");
    expect(github.reviews).toHaveLength(0);
  });

  it("records a failure and lets a retry claim the commit again", async () => {
    const reviewer = fakeReviewer();
    reviewer.reviewChunk = vi.fn().mockRejectedValueOnce(new Error("model timeout")).mockResolvedValue({
      summary: "ok",
      comments: [],
    });

    await expect(reviewPullRequest({ github, reviewer, store }, job)).rejects.toThrow("model timeout");
    expect((await store.listReviews("acme/shop", 1))[0]).toMatchObject({ status: "FAILED", note: "model timeout" });

    const retry = await reviewPullRequest({ github, reviewer, store }, job);
    expect(retry.status).toBe("COMPLETED");
    expect(github.reviews[0]!.body).toContain("found nothing worth flagging");
  });

  it("splits big PRs across several model calls", async () => {
    github.files = Array.from({ length: 6 }, (_, i) => ({
      filename: `src/f${i}.ts`,
      status: "modified",
      additions: 30,
      deletions: 0,
      patch: ["@@ -1,1 +1,31 @@", " x", ...Array.from({ length: 30 }, (_, j) => `+line ${j}`)].join("\n"),
    }));
    const reviewer = fakeReviewer([]);
    await reviewPullRequest({ github, reviewer, store, maxChunkChars: 1_500 }, job);
    expect(reviewer.calls).toBeGreaterThan(1);
    expect(reviewer.mergeSummaries).toHaveBeenCalledOnce();
  });
});

describe("mapLimit", () => {
  it("keeps order and never runs more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n));
      running--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
  });
});
