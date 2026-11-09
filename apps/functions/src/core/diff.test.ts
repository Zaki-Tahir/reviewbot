import { describe, expect, it } from "vitest";
import { chunkFiles, parsePatch, prepareDiff, renderForModel } from "./diff.js";

const patch = [
  "@@ -10,4 +10,5 @@ export function total(items) {",
  "   let sum = 0;",
  "-  for (const i of items) sum += i.price;",
  "+  for (const i of items) {",
  "+    sum += i.price * i.qty;",
  "+  }",
  "   return sum;",
  "\\ No newline at end of file",
].join("\n");

describe("parsePatch", () => {
  it("tracks new-file line numbers and which lines can take comments", () => {
    const file = parsePatch("src/cart.ts", patch);
    const lines = file.hunks[0]!.lines;

    expect(lines.map((l) => [l.kind, l.newLine])).toEqual([
      ["ctx", 10],
      ["del", null],
      ["add", 11],
      ["add", 12],
      ["add", 13],
      ["ctx", 14],
    ]);
    expect([...file.commentableLines]).toEqual([10, 11, 12, 13, 14]);
  });

  it("handles multiple hunks and single-line hunk headers", () => {
    const file = parsePatch("a.ts", ["@@ -1 +1 @@", "-old", "+new", "@@ -50,2 +50,2 @@", " keep", "+added"].join("\n"));
    expect(file.hunks).toHaveLength(2);
    expect([...file.commentableLines]).toEqual([1, 50, 51]);
  });
});

describe("prepareDiff", () => {
  it("skips ignored, removed and binary files and says why", () => {
    const result = prepareDiff(
      [
        { filename: "src/cart.ts", status: "modified", additions: 3, deletions: 1, patch },
        { filename: "package-lock.json", status: "modified", additions: 900, deletions: 20, patch: "@@ -1 +1 @@\n-a\n+b" },
        { filename: "logo.png", status: "added", additions: 0, deletions: 0 },
        { filename: "old.ts", status: "removed", additions: 0, deletions: 40, patch: "@@ -1 +0,0 @@\n-x" },
      ],
      ["**/package-lock.json"],
    );
    expect(result.files.map((f) => f.path)).toEqual(["src/cart.ts"]);
    expect(result.skipped).toEqual([
      { path: "package-lock.json", reason: "ignored by settings" },
      { path: "logo.png", reason: "binary or too large to diff" },
    ]);
  });
});

describe("renderForModel", () => {
  it("puts new-file line numbers in a gutter", () => {
    const text = renderForModel(parsePatch("src/cart.ts", patch));
    expect(text).toContain("### src/cart.ts");
    expect(text).toContain("   11 +   for (const i of items) {");
    expect(text).toContain("      -   for (const i of items) sum += i.price;");
  });
});

describe("chunkFiles", () => {
  const file = (name: string, n: number) =>
    parsePatch(name, [`@@ -1,${n} +1,${n} @@`, ...Array.from({ length: n }, (_, i) => `+line ${i}`)].join("\n"));

  it("keeps small PRs in one chunk", () => {
    expect(chunkFiles([file("a.ts", 5), file("b.ts", 5)], 10_000)).toHaveLength(1);
  });

  it("splits large PRs across chunks without losing files", () => {
    const files = Array.from({ length: 10 }, (_, i) => file(`f${i}.ts`, 40));
    const chunks = chunkFiles(files, 1_200);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat().map((f) => f.path)).toEqual(files.map((f) => f.path));
    for (const chunk of chunks) {
      expect(chunk.map(renderForModel).join("\n").length).toBeLessThanOrEqual(1_200);
    }
  });

  it("cuts a huge file at hunk boundaries", () => {
    const hunks = Array.from({ length: 6 }, (_, h) =>
      [`@@ -${h * 100 + 1},20 +${h * 100 + 1},20 @@`, ...Array.from({ length: 20 }, (_, i) => `+h${h} line ${i}`)].join("\n"),
    ).join("\n");
    const chunks = chunkFiles([parsePatch("big.ts", hunks)], 800);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat().every((f) => f.path === "big.ts")).toBe(true);
    expect(chunks.flat().reduce((n, f) => n + f.hunks.length, 0)).toBe(6);
  });
});
