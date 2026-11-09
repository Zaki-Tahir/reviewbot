import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { type RepoSettings, withDefaults } from "../core/settings.js";
import { type ReviewRecord, STALE_CLAIM_MS, type Store, type StoredSettings } from "./types.js";

/** Reviews are kept for 90 days, then DynamoDB's TTL deletes them. */
const REVIEW_TTL_SECONDS = 90 * 24 * 3600;

/**
 * Single-table design:
 *
 *   PK               SK                               item
 *   REPO#owner/name  SETTINGS                         settings, updatedAt, updatedBy
 *   REPO#owner/name  REVIEW#<started at>#<pr>#<sha>   one review run (newest first when queried descending)
 *   RUN#owner/name#<pr>#<sha>  RUN                    idempotency claim for one commit
 */
export class DynamoStore implements Store {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly table: string,
    client: DynamoDBClient = new DynamoDBClient({}),
  ) {
    this.doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  async getSettings(repo: string): Promise<StoredSettings> {
    const { Item } = await this.doc.send(new GetCommand({ TableName: this.table, Key: { PK: `REPO#${repo}`, SK: "SETTINGS" } }));
    return { settings: withDefaults(Item?.settings), updatedAt: Item?.updatedAt, updatedBy: Item?.updatedBy };
  }

  async putSettings(repo: string, settings: RepoSettings, updatedBy: string) {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: { PK: `REPO#${repo}`, SK: "SETTINGS", settings, updatedBy, updatedAt: new Date().toISOString() },
      }),
    );
  }

  async claimReview(repo: string, prNumber: number, headSha: string, now = new Date()) {
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: {
            PK: runKey(repo, prNumber, headSha),
            SK: "RUN",
            status: "IN_PROGRESS",
            startedAt: now.toISOString(),
            expiresAt: ttl(now),
          },
          ConditionExpression: "attribute_not_exists(PK) OR #s = :failed OR (#s = :running AND startedAt < :stale)",
          ExpressionAttributeNames: { "#s": "status" },
          ExpressionAttributeValues: {
            ":failed": "FAILED",
            ":running": "IN_PROGRESS",
            ":stale": new Date(now.getTime() - STALE_CLAIM_MS).toISOString(),
          },
        }),
      );
      return true;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return false;
      throw err;
    }
  }

  async finishReview(record: ReviewRecord) {
    const expiresAt = ttl(new Date(record.startedAt));
    await Promise.all([
      this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: { PK: runKey(record.repo, record.prNumber, record.headSha), SK: "RUN", ...record, expiresAt },
        }),
      ),
      this.doc.send(
        new PutCommand({
          TableName: this.table,
          Item: {
            PK: `REPO#${record.repo}`,
            SK: `REVIEW#${record.startedAt}#${record.prNumber}#${record.headSha}`,
            ...record,
            expiresAt,
          },
        }),
      ),
    ]);
  }

  async listReviews(repo: string, limit: number): Promise<ReviewRecord[]> {
    const { Items = [] } = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: { ":pk": `REPO#${repo}`, ":prefix": "REVIEW#" },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return Items.map(({ PK: _pk, SK: _sk, expiresAt: _ttl, ...record }) => record as ReviewRecord);
  }
}

const runKey = (repo: string, pr: number, sha: string) => `RUN#${repo}#${pr}#${sha}`;
const ttl = (from: Date) => Math.floor(from.getTime() / 1000) + REVIEW_TTL_SECONDS;
