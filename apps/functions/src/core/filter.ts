import type { FileDiff } from "./diff.js";
import type { ModelComment } from "./llm.js";
import { type RepoSettings, severityRank } from "./settings.js";

/**
 * Comments below this confidence are dropped. Picked by reviewing sample PRs by hand:
 * below ~0.6 most comments were speculative ("consider handling X") rather than real problems.
 */
export const MIN_CONFIDENCE = 0.6;

export type DropReason = "category" | "severity" | "confidence" | "line" | "duplicate" | "limit";

export interface FilterResult {
  kept: ModelComment[];
  dropped: Record<DropReason, number>;
}

/**
 * Decides which model comments are worth posting. Most of the value of a review bot is in what
 * it *doesn't* say, so this is deliberately strict.
 */
export function filterComments(comments: ModelComment[], files: FileDiff[], settings: RepoSettings): FilterResult {
  const dropped: Record<DropReason, number> = { category: 0, severity: 0, confidence: 0, line: 0, duplicate: 0, limit: 0 };
  const commentable = new Map<string, Set<number>>();
  for (const f of files) {
    const lines = commentable.get(f.path) ?? new Set<number>();
    for (const l of f.commentableLines) lines.add(l);
    commentable.set(f.path, lines);
  }

  const seen = new Set<string>();
  const candidates: ModelComment[] = [];

  for (const c of comments) {
    if (!settings.categories[c.category]) {
      dropped.category++;
    } else if (severityRank[c.severity] < severityRank[settings.minSeverity]) {
      dropped.severity++;
    } else if (c.confidence < MIN_CONFIDENCE) {
      dropped.confidence++;
    } else if (!commentable.get(c.path)?.has(c.line)) {
      // The model pointed at a line that isn't in the diff. GitHub would reject the whole review.
      dropped.line++;
    } else if (seen.has(`${c.path}:${c.line}:${c.category}`)) {
      dropped.duplicate++;
    } else {
      seen.add(`${c.path}:${c.line}:${c.category}`);
      candidates.push(c);
    }
  }

  // Most important first, so the limit cuts the least useful ones.
  candidates.sort(
    (a, b) => severityRank[b.severity] - severityRank[a.severity] || b.confidence - a.confidence,
  );
  const kept = candidates.slice(0, settings.maxComments);
  dropped.limit = candidates.length - kept.length;

  // Post in file order so the review reads top to bottom.
  kept.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  return { kept, dropped };
}
