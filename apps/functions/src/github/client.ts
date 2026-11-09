import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { PullRequestFile } from "../core/diff.js";

export interface PullRequestInfo {
  number: number;
  title: string;
  body: string;
  draft: boolean;
  state: string;
  headSha: string;
  htmlUrl: string;
}

export interface InlineComment {
  path: string;
  line: number;
  body: string;
}

/** What the review pipeline needs from GitHub. */
export interface GitHubClient {
  getPullRequest(owner: string, repo: string, number: number): Promise<PullRequestInfo>;
  listFiles(owner: string, repo: string, number: number): Promise<PullRequestFile[]>;
  createReview(
    owner: string,
    repo: string,
    number: number,
    review: { commitId: string; body: string; comments: InlineComment[] },
  ): Promise<{ url: string }>;
}

/** GitHub caps the files API at 3000 files; we stop well before that. */
const MAX_FILES = 300;

export class OctokitClient implements GitHubClient {
  constructor(private readonly octokit: Octokit) {}

  /** Authenticates as one installation of the GitHub App. Tokens are fetched and refreshed automatically. */
  static forInstallation(appId: string, privateKey: string, installationId: number): OctokitClient {
    return new OctokitClient(
      new Octokit({ authStrategy: createAppAuth, auth: { appId, privateKey, installationId }, userAgent: "reviewbot" }),
    );
  }

  async getPullRequest(owner: string, repo: string, number: number): Promise<PullRequestInfo> {
    const { data } = await this.octokit.pulls.get({ owner, repo, pull_number: number });
    return {
      number: data.number,
      title: data.title,
      body: data.body ?? "",
      draft: data.draft ?? false,
      state: data.state,
      headSha: data.head.sha,
      htmlUrl: data.html_url,
    };
  }

  async listFiles(owner: string, repo: string, number: number): Promise<PullRequestFile[]> {
    const files: PullRequestFile[] = [];
    for await (const page of this.octokit.paginate.iterator(this.octokit.pulls.listFiles, {
      owner,
      repo,
      pull_number: number,
      per_page: 100,
    })) {
      for (const f of page.data) {
        files.push({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch });
      }
      if (files.length >= MAX_FILES) break;
    }
    return files.slice(0, MAX_FILES);
  }

  async createReview(
    owner: string,
    repo: string,
    number: number,
    review: { commitId: string; body: string; comments: InlineComment[] },
  ) {
    const { data } = await this.octokit.pulls.createReview({
      owner,
      repo,
      pull_number: number,
      commit_id: review.commitId,
      // Always COMMENT: the bot gives feedback, it never approves or blocks a merge.
      event: "COMMENT",
      body: review.body,
      comments: review.comments.map((c) => ({ path: c.path, line: c.line, side: "RIGHT" as const, body: c.body })),
    });
    return { url: data.html_url };
  }
}
