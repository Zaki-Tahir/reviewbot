import type { RepoSettings } from "../core/settings.js";

export type ReviewStatus = "IN_PROGRESS" | "COMPLETED" | "SKIPPED" | "FAILED";

export interface ReviewRecord {
  repo: string;
  prNumber: number;
  headSha: string;
  status: ReviewStatus;
  startedAt: string;
  finishedAt?: string;
  prTitle?: string;
  filesReviewed?: number;
  commentsPosted?: number;
  filteredOut?: number;
  reviewUrl?: string;
  /** Why a review was skipped, or the error message if it failed. */
  note?: string;
}

export interface StoredSettings {
  settings: RepoSettings;
  updatedAt?: string;
  updatedBy?: string;
}

export interface Store {
  getSettings(repo: string): Promise<StoredSettings>;
  putSettings(repo: string, settings: RepoSettings, updatedBy: string): Promise<void>;

  /**
   * Marks a review of this exact commit as started. Returns false if it's already been reviewed
   * or is being reviewed right now, so duplicate webhooks and SQS redeliveries don't double-post.
   * A FAILED review, or one stuck IN_PROGRESS for over 15 minutes, can be claimed again.
   */
  claimReview(repo: string, prNumber: number, headSha: string, now?: Date): Promise<boolean>;
  finishReview(record: ReviewRecord): Promise<void>;
  listReviews(repo: string, limit: number): Promise<ReviewRecord[]>;
}

export const STALE_CLAIM_MS = 15 * 60 * 1000;
