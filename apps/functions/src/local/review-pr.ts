/**
 * Reviews any pull request from the command line and prints what the bot would post.
 * Nothing is written to GitHub unless you pass --post.
 *
 *   npm run review -w apps/functions -- https://github.com/owner/repo/pull/123
 *
 * Needs OPENAI_API_KEY, and GITHUB_TOKEN for private repos (or to avoid rate limits):
 *   GITHUB_TOKEN=$(gh auth token) npm run review -w apps/functions -- <url>
 */
import { Octokit } from "@octokit/rest";
import OpenAI from "openai";
import { OpenAIReviewer } from "../core/llm.js";
import { reviewPullRequest } from "../core/review.js";
import { DEFAULT_SETTINGS } from "../core/settings.js";
import { type GitHubClient, OctokitClient } from "../github/client.js";
import { MemoryStore } from "../store/memory.js";

const [url] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const post = process.argv.includes("--post");
const match = url?.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
if (!match) {
  console.error("Usage: npm run review -- https://github.com/owner/repo/pull/123 [--post]");
  process.exit(1);
}
const [, owner, repo, num] = match as unknown as [string, string, string, string];

const real = new OctokitClient(new Octokit({ auth: process.env.GITHUB_TOKEN, userAgent: "reviewbot-cli" }));

/** Same client, but printing the review instead of posting it. */
const dryRun: GitHubClient = {
  getPullRequest: (...a) => real.getPullRequest(...a),
  listFiles: (...a) => real.listFiles(...a),
  createReview: async (_o, _r, _n, review) => {
    console.log(`\n${review.body}\n`);
    for (const c of review.comments) console.log(`--- ${c.path}:${c.line}\n${c.body}\n`);
    return { url: "(dry run, nothing posted)" };
  },
};

const pr = await real.getPullRequest(owner, repo, Number(num));
const store = new MemoryStore();
// Review drafts too when run by hand.
await store.putSettings(`${owner}/${repo}`, { ...DEFAULT_SETTINGS, skipDrafts: false }, "cli");

const result = await reviewPullRequest(
  {
    github: post ? real : dryRun,
    reviewer: new OpenAIReviewer(new OpenAI(), process.env.OPENAI_MODEL ?? "gpt-4.1"),
    store,
    includeClosed: !post,
    log: (msg, data) => console.error(`[${msg}]`, JSON.stringify(data)),
  },
  { installationId: 0, owner, repo, prNumber: Number(num), headSha: pr.headSha, deliveryId: "cli" },
);
console.error(
  `\n${result.status}: ${result.commentsPosted ?? 0} comments posted, ${result.filteredOut ?? 0} filtered out. ${result.reviewUrl ?? result.note ?? ""}`,
);
