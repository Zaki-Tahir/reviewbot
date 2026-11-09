import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import OpenAI from "openai";
import { env, getSecret, log } from "../config.js";
import { OpenAIReviewer } from "../core/llm.js";
import { type ReviewDeps, type ReviewJob, reviewPullRequest } from "../core/review.js";
import { OctokitClient } from "../github/client.js";
import { DynamoStore } from "../store/dynamo.js";

export type DepsForJob = (job: ReviewJob) => Promise<ReviewDeps>;

/**
 * Processes review jobs from SQS. Failed messages are reported individually so the rest of the
 * batch isn't retried; after the queue's max receive count they move to the dead-letter queue.
 */
export function createWorkerHandler(depsFor: DepsForJob) {
  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const failures: SQSBatchResponse["batchItemFailures"] = [];
    for (const record of event.Records) {
      const job = JSON.parse(record.body) as ReviewJob;
      try {
        const result = await reviewPullRequest(await depsFor(job), job);
        log("info", "job done", { repo: `${job.owner}/${job.repo}`, pr: job.prNumber, status: result.status });
      } catch (err) {
        log("error", "review failed", {
          repo: `${job.owner}/${job.repo}`,
          pr: job.prNumber,
          attempt: Number(record.attributes.ApproximateReceiveCount),
          error: err instanceof Error ? err.message : String(err),
        });
        failures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures: failures };
  };
}

let shared: Pick<ReviewDeps, "reviewer" | "store"> | undefined;

export const handler = createWorkerHandler(async (job) => {
  shared ??= {
    reviewer: new OpenAIReviewer(new OpenAI({ apiKey: await getSecret("OPENAI_API_KEY") }), env("OPENAI_MODEL", "gpt-4.1")),
    store: new DynamoStore(env("TABLE_NAME")),
  };
  return {
    ...shared,
    github: OctokitClient.forInstallation(await getSecret("GITHUB_APP_ID"), await getSecret("GITHUB_PRIVATE_KEY"), job.installationId),
    log: (msg, data) => log("info", msg, data),
  };
});
