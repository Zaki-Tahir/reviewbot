import { createHmac, timingSafeEqual } from "node:crypto";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { env, getSecret, log } from "../config.js";
import type { ReviewJob } from "../core/review.js";

/** PR actions that mean "there's new code to look at". */
const REVIEW_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

export interface WebhookDeps {
  webhookSecret: () => Promise<string>;
  enqueue: (job: ReviewJob) => Promise<void>;
}

/** GitHub signs the raw body with HMAC-SHA256 using the webhook secret. */
export function verifySignature(secret: string, rawBody: string | Buffer, header: string | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

interface PullRequestEvent {
  action: string;
  installation?: { id: number };
  repository: { name: string; owner: { login: string } };
  pull_request: { number: number; head: { sha: string } };
}

/**
 * Receives GitHub webhooks. It only verifies and enqueues, then answers 202 within milliseconds;
 * the slow part (calling the model) happens in the queue worker. GitHub gives up on webhooks
 * that take more than 10 seconds.
 */
export function createWebhookHandler(deps: WebhookDeps) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64") : (event.body ?? "");

    if (!verifySignature(await deps.webhookSecret(), raw, headers["x-hub-signature-256"])) {
      log("warn", "rejected webhook with bad signature", { delivery: headers["x-github-delivery"] });
      return { statusCode: 401, body: "invalid signature" };
    }

    const name = headers["x-github-event"];
    const deliveryId = headers["x-github-delivery"] ?? "unknown";
    if (name === "ping") return { statusCode: 200, body: "pong" };
    if (name !== "pull_request") return { statusCode: 204 };

    const payload = JSON.parse(raw.toString()) as PullRequestEvent;
    if (!REVIEW_ACTIONS.has(payload.action) || !payload.installation) return { statusCode: 204 };

    const job: ReviewJob = {
      installationId: payload.installation.id,
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      prNumber: payload.pull_request.number,
      headSha: payload.pull_request.head.sha,
      deliveryId,
    };
    await deps.enqueue(job);
    log("info", "queued review", { ...job });
    return { statusCode: 202, body: JSON.stringify({ queued: true }) };
  };
}

const sqs = new SQSClient({});

export const handler = createWebhookHandler({
  webhookSecret: () => getSecret("GITHUB_WEBHOOK_SECRET"),
  enqueue: async (job) => {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: env("QUEUE_URL"),
        MessageBody: JSON.stringify(job),
        // FIFO queue: pushes to the same PR are processed in order, one at a time,
        // and GitHub's redelivery of the same webhook is dropped.
        MessageGroupId: `${job.owner}/${job.repo}#${job.prNumber}`,
        MessageDeduplicationId: job.deliveryId,
      }),
    );
  },
});
