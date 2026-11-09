import type { ModelComment } from "./llm.js";
import type { Category } from "./settings.js";

const LABELS: Record<Category, string> = {
  bug: "🐛 Bug",
  security: "🔒 Security",
  tests: "🧪 Missing test",
  performance: "⚡ Performance",
  style: "✏️ Readability",
};

/** Markdown for one inline comment. Uses a GitHub suggestion block when the model proposed a fix. */
export function formatComment(c: ModelComment): string {
  const parts = [`**${LABELS[c.category]}** (${c.severity}): ${c.title}`, "", c.body.trim()];
  if (c.suggestion !== null) parts.push("", "```suggestion", c.suggestion, "```");
  return parts.join("\n");
}

export interface SummaryInput {
  summary: string;
  comments: ModelComment[];
  filesReviewed: number;
  skipped: { path: string; reason: string }[];
  filteredOut: number;
}

/** The top-level review body: what the PR does, and a one-line tally of what was found. */
export function formatSummary(input: SummaryInput): string {
  const counts = new Map<Category, number>();
  for (const c of input.comments) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
  const tally = [...counts.entries()].map(([cat, n]) => `${n} ${LABELS[cat].split(" ").slice(1).join(" ").toLowerCase()}`);

  const lines = ["### ReviewBot", "", input.summary.trim(), ""];
  lines.push(
    input.comments.length === 0
      ? `Reviewed ${input.filesReviewed} file${input.filesReviewed === 1 ? "" : "s"} and found nothing worth flagging.`
      : `Reviewed ${input.filesReviewed} file${input.filesReviewed === 1 ? "" : "s"}: ${tally.join(", ")}.`,
  );
  if (input.skipped.length) {
    lines.push("", "<details><summary>Skipped files</summary>", "");
    for (const s of input.skipped) lines.push(`- \`${s.path}\`: ${s.reason}`);
    lines.push("", "</details>");
  }
  if (input.filteredOut > 0) {
    lines.push("", `<sub>${input.filteredOut} lower-confidence note${input.filteredOut === 1 ? " was" : "s were"} left out.</sub>`);
  }
  return lines.join("\n");
}
