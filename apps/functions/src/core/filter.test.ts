import { describe, expect, it } from "vitest";
import { parsePatch } from "./diff.js";
import { filterComments } from "./filter.js";
import { formatComment, formatSummary } from "./format.js";
import type { ModelComment } from "./llm.js";
import { DEFAULT_SETTINGS, withDefaults } from "./settings.js";

const files = [parsePatch("src/a.ts", "@@ -1,2 +1,4 @@\n line1\n+line2\n+line3\n line4")];

const comment = (over: Partial<ModelComment> = {}): ModelComment => ({
  path: "src/a.ts",
  line: 2,
  category: "bug",
  severity: "high",
  confidence: 0.9,
  title: "Divides by zero when the cart is empty",
  body: "`count` can be 0 here.",
  suggestion: null,
  ...over,
});

describe("filterComments", () => {
  it("keeps a confident, in-diff comment in an enabled category", () => {
    const { kept } = filterComments([comment()], files, DEFAULT_SETTINGS);
    expect(kept).toHaveLength(1);
  });

  it("drops disabled categories, low severity, low confidence, lines outside the diff and duplicates", () => {
    const { kept, dropped } = filterComments(
      [
        comment({ category: "style" }), // style is off by default
        comment({ severity: "low" }), // below minSeverity "medium"
        comment({ confidence: 0.4 }),
        comment({ line: 99 }), // not in the diff
        comment({ path: "src/other.ts" }), // file not in the diff
        comment(),
        comment({ title: "same thing, said differently" }),
      ],
      files,
      DEFAULT_SETTINGS,
    );
    expect(kept).toHaveLength(1);
    expect(dropped).toEqual({ category: 1, severity: 1, confidence: 1, line: 2, duplicate: 1, limit: 0 });
  });

  it("keeps the most important comments when over the limit, then sorts by position", () => {
    const settings = { ...DEFAULT_SETTINGS, maxComments: 2 };
    const { kept, dropped } = filterComments(
      [
        comment({ line: 3, severity: "medium", confidence: 0.95 }),
        comment({ line: 4, severity: "high", confidence: 0.7, category: "security" }),
        comment({ line: 2, severity: "high", confidence: 0.9 }),
      ],
      files,
      settings,
    );
    expect(kept.map((c) => c.line)).toEqual([2, 4]);
    expect(dropped.limit).toBe(1);
  });
});

describe("formatting", () => {
  it("adds a GitHub suggestion block when there's a fix", () => {
    const text = formatComment(comment({ suggestion: "  return count === 0 ? 0 : total / count;" }));
    expect(text).toContain("**🐛 Bug** (high): Divides by zero when the cart is empty");
    expect(text).toContain("```suggestion\n  return count === 0 ? 0 : total / count;\n```");
  });

  it("summarizes findings and lists skipped files", () => {
    const text = formatSummary({
      summary: "Adds quantity support to the cart total.",
      comments: [comment(), comment({ category: "security" }), comment({ category: "bug", line: 3 })],
      filesReviewed: 1,
      skipped: [{ path: "logo.png", reason: "binary or too large to diff" }],
      filteredOut: 2,
    });
    expect(text).toContain("Reviewed 1 file: 2 bug, 1 security.");
    expect(text).toContain("- `logo.png`: binary or too large to diff");
    expect(text).toContain("2 lower-confidence notes were left out.");
  });

  it("says so when there's nothing to flag", () => {
    const text = formatSummary({ summary: "Renames a variable.", comments: [], filesReviewed: 3, skipped: [], filteredOut: 0 });
    expect(text).toContain("Reviewed 3 files and found nothing worth flagging.");
  });
});

describe("withDefaults", () => {
  it("fills in settings added after a repo was configured", () => {
    const s = withDefaults({ enabled: false, categories: { style: true } });
    expect(s.enabled).toBe(false);
    expect(s.categories).toEqual({ ...DEFAULT_SETTINGS.categories, style: true });
    expect(s.maxComments).toBe(DEFAULT_SETTINGS.maxComments);
  });
});
