import type { GitHubClient } from "../github/client.js";
import type { ReviewRecord, Store } from "../store/types.js";
import { chunkFiles, prepareDiff } from "./diff.js";
import { filterComments } from "./filter.js";
import { formatComment, formatSummary } from "./format.js";
import type { ChunkReview, Reviewer } from "./llm.js";

/** One unit of work on the queue. */
export interface ReviewJob {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  deliveryId: string;
}

export interface ReviewDeps {
  github: GitHubClient;
  reviewer: Reviewer;
  store: Store;
  /** Characters of rendered diff per model request. */
  maxChunkChars?: number;
  /** How many chunks to send to the model at once. */
  concurrency?: number;
  /** Review merged/closed PRs too. Only the CLI uses this, to try the bot on past PRs. */
  includeClosed?: boolean;
  now?: () => Date;
  log?: (msg: string, data?: object) => void;
}

/**
 * Reviews one commit of one pull request and posts a single GitHub review.
 * Safe to call more than once for the same commit: only the first call does anything.
 */
export async function reviewPullRequest(deps: ReviewDeps, job: ReviewJob): Promise<ReviewRecord> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const fullName = `${job.owner}/${job.repo}`;
  const startedAt = now();
  const base: ReviewRecord = {
    repo: fullName,
    prNumber: job.prNumber,
    headSha: job.headSha,
    status: "IN_PROGRESS",
    startedAt: startedAt.toISOString(),
  };
  const finish = async (record: Partial<ReviewRecord>) => {
    const done = { ...base, ...record, finishedAt: now().toISOString() };
    await deps.store.finishReview(done);
    log("review finished", { repo: fullName, pr: job.prNumber, status: done.status, note: done.note });
    return done;
  };

  const { settings } = await deps.store.getSettings(fullName);
  if (!settings.enabled) return { ...base, status: "SKIPPED", note: "disabled for this repository" };

  if (!(await deps.store.claimReview(fullName, job.prNumber, job.headSha, startedAt))) {
    log("already reviewed", { repo: fullName, pr: job.prNumber, sha: job.headSha });
    return { ...base, status: "SKIPPED", note: "already reviewed" };
  }

  try {
    const pr = await deps.github.getPullRequest(job.owner, job.repo, job.prNumber);
    base.prTitle = pr.title;

    if (pr.state !== "open" && !deps.includeClosed) return await finish({ status: "SKIPPED", note: "pull request is closed" });
    if (pr.draft && settings.skipDrafts) return await finish({ status: "SKIPPED", note: "draft pull request" });
    // A newer push arrived while this job waited in the queue; that push has its own job.
    if (pr.headSha !== job.headSha) return await finish({ status: "SKIPPED", note: "superseded by a newer commit" });

    const diff = prepareDiff(await deps.github.listFiles(job.owner, job.repo, job.prNumber), settings.ignorePaths);
    if (diff.files.length === 0) return await finish({ status: "SKIPPED", note: "no reviewable files" });

    const chunks = chunkFiles(diff.files, deps.maxChunkChars ?? 40_000);
    log("reviewing", { repo: fullName, pr: job.prNumber, files: diff.files.length, chunks: chunks.length });

    const context = { title: pr.title, body: pr.body };
    const results = await mapLimit(chunks, deps.concurrency ?? 3, (files) =>
      deps.reviewer.reviewChunk(context, files, settings),
    );

    const { kept, dropped } = filterComments(
      results.flatMap((r: ChunkReview) => r.comments),
      diff.files,
      settings,
    );
    const filteredOut = Object.values(dropped).reduce((a, b) => a + b, 0);
    const summary = await deps.reviewer.mergeSummaries(
      context,
      results.map((r) => r.summary),
    );

    const posted = await deps.github.createReview(job.owner, job.repo, job.prNumber, {
      commitId: job.headSha,
      body: formatSummary({ summary, comments: kept, filesReviewed: diff.files.length, skipped: diff.skipped, filteredOut }),
      comments: kept.map((c) => ({ path: c.path, line: c.line, body: formatComment(c) })),
    });

    return await finish({
      status: "COMPLETED",
      filesReviewed: diff.files.length,
      commentsPosted: kept.length,
      filteredOut,
      reviewUrl: posted.url,
    });
  } catch (err) {
    // Record the failure (so the claim can be retried), then rethrow so SQS redelivers the job.
    await finish({ status: "FAILED", note: err instanceof Error ? err.message.slice(0, 500) : String(err) });
    throw err;
  }
}

/** Promise.all with at most `limit` tasks running at once, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}
