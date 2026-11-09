import { DEFAULT_SETTINGS, type RepoSettings } from "../core/settings.js";
import { type ReviewRecord, STALE_CLAIM_MS, type Store, type StoredSettings } from "./types.js";

/** In-memory store for unit tests and the local dev server. Mirrors the DynamoDB rules. */
export class MemoryStore implements Store {
  readonly settings = new Map<string, StoredSettings>();
  readonly reviews = new Map<string, ReviewRecord>();

  async getSettings(repo: string): Promise<StoredSettings> {
    return this.settings.get(repo) ?? { settings: DEFAULT_SETTINGS };
  }

  async putSettings(repo: string, settings: RepoSettings, updatedBy: string) {
    this.settings.set(repo, { settings, updatedBy, updatedAt: new Date().toISOString() });
  }

  async claimReview(repo: string, prNumber: number, headSha: string, now = new Date()) {
    const key = `${repo}#${prNumber}#${headSha}`;
    const existing = this.reviews.get(key);
    const stale = existing?.status === "IN_PROGRESS" && now.getTime() - Date.parse(existing.startedAt) > STALE_CLAIM_MS;
    if (existing && existing.status !== "FAILED" && !stale) return false;
    this.reviews.set(key, { repo, prNumber, headSha, status: "IN_PROGRESS", startedAt: now.toISOString() });
    return true;
  }

  async finishReview(record: ReviewRecord) {
    this.reviews.set(`${record.repo}#${record.prNumber}#${record.headSha}`, record);
  }

  async listReviews(repo: string, limit: number) {
    return [...this.reviews.values()]
      .filter((r) => r.repo === repo)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit);
  }
}
