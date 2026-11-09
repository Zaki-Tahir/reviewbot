import type OpenAI from "openai";
import { z } from "zod";
import { type FileDiff, renderForModel } from "./diff.js";
import { CATEGORIES, type Category, type RepoSettings, SEVERITIES } from "./settings.js";

export interface ModelComment {
  path: string;
  line: number;
  category: Category;
  severity: (typeof SEVERITIES)[number];
  /** 0-1, how sure the model is this is a real problem. Used to filter noise. */
  confidence: number;
  title: string;
  body: string;
  /** Replacement code for the commented line, if the fix is small. */
  suggestion: string | null;
}

export interface ChunkReview {
  summary: string;
  comments: ModelComment[];
}

export interface PullRequestContext {
  title: string;
  body: string;
}

/** The model boundary. The OpenAI implementation is below; tests use a fake. */
export interface Reviewer {
  reviewChunk(pr: PullRequestContext, files: FileDiff[], settings: RepoSettings): Promise<ChunkReview>;
  mergeSummaries(pr: PullRequestContext, summaries: string[]): Promise<string>;
}

const chunkReviewSchema = z.object({
  summary: z.string(),
  comments: z.array(
    z.object({
      path: z.string(),
      line: z.number().int(),
      category: z.enum(CATEGORIES),
      severity: z.enum(SEVERITIES),
      confidence: z.number().min(0).max(1),
      title: z.string(),
      body: z.string(),
      suggestion: z.string().nullable(),
    }),
  ),
});

/** JSON Schema for structured outputs. Strict mode needs every property listed in `required`. */
const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "comments"],
  properties: {
    summary: { type: "string", description: "2-4 sentences: what this change does, in plain English" },
    comments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "line", "category", "severity", "confidence", "title", "body", "suggestion"],
        properties: {
          path: { type: "string" },
          line: { type: "integer", description: "New-file line number from the gutter" },
          category: { type: "string", enum: [...CATEGORIES] },
          severity: { type: "string", enum: [...SEVERITIES] },
          confidence: { type: "number", description: "0 to 1" },
          title: { type: "string", description: "One short sentence" },
          body: { type: "string", description: "Why it's a problem and how to fix it. Markdown, under 80 words." },
          suggestion: {
            type: ["string", "null"],
            description: "Exact replacement for that single line, or null",
          },
        },
      },
    },
  },
} as const;

const CATEGORY_GUIDE: Record<Category, string> = {
  bug: "bug: logic errors, wrong conditions, off-by-one, null/undefined access, unhandled errors, race conditions",
  security: "security: injection, missing auth checks, secrets in code, unsafe deserialization, SSRF, XSS",
  tests: "tests: new behavior or a bug fix with no test covering it (comment on the changed code, not the test file)",
  performance: "performance: N+1 queries, work inside hot loops, unbounded memory, missing pagination",
  style: "style: naming, readability, dead code (only when it genuinely hurts understanding)",
};

export function buildSystemPrompt(settings: RepoSettings): string {
  const enabled = (Object.keys(settings.categories) as Category[]).filter((c) => settings.categories[c]);
  return `You are a senior engineer reviewing a pull request. Find real problems a careful human reviewer would flag.

Only comment on these categories:
${enabled.map((c) => `- ${CATEGORY_GUIDE[c]}`).join("\n")}

Rules:
- Comment only on lines that have a number in the gutter. Use that number for "line".
- Prefer added lines (+). Don't comment on deleted lines.
- Be specific: say what breaks and when. No generic advice, no praise, no restating the code.
- If you're not sure something is wrong, lower the confidence instead of hedging in the text.
- Return an empty comments array if the change looks fine. That is a good outcome.
- "suggestion" must be a drop-in replacement for that one line, keeping its indentation, or null.
${settings.instructions ? `\nTeam guidelines from the repository owner:\n${settings.instructions}\n` : ""}`;
}

export function buildUserPrompt(pr: PullRequestContext, files: FileDiff[]): string {
  const description = pr.body.trim() ? pr.body.trim().slice(0, 2000) : "(no description)";
  return `Pull request: ${pr.title}\n\nDescription:\n${description}\n\nDiff:\n\n${files.map(renderForModel).join("\n\n")}`;
}

export class OpenAIReviewer implements Reviewer {
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
  ) {}

  async reviewChunk(pr: PullRequestContext, files: FileDiff[], settings: RepoSettings): Promise<ChunkReview> {
    const res = await this.client.responses.create({
      model: this.model,
      instructions: buildSystemPrompt(settings),
      input: buildUserPrompt(pr, files),
      text: { format: { type: "json_schema", name: "pull_request_review", schema: responseJsonSchema, strict: true } },
    });
    return chunkReviewSchema.parse(JSON.parse(res.output_text));
  }

  async mergeSummaries(pr: PullRequestContext, summaries: string[]): Promise<string> {
    if (summaries.length <= 1) return summaries[0] ?? "";
    const res = await this.client.responses.create({
      model: this.model,
      instructions:
        "Combine these partial summaries of one pull request into a single summary of 2-4 sentences. Plain English, no preamble.",
      input: `Pull request: ${pr.title}\n\n${summaries.map((s, i) => `Part ${i + 1}: ${s}`).join("\n")}`,
    });
    return res.output_text.trim();
  }
}
