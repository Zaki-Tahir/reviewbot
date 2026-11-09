import picomatch from "picomatch";

/** A changed file as returned by GitHub's "list pull request files" API. */
export interface PullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  /** Unified diff hunks. Missing for binary files and very large diffs. */
  patch?: string;
}

export interface DiffLine {
  kind: "add" | "del" | "ctx";
  /** Line number in the new version of the file. Null for deleted lines. */
  newLine: number | null;
  text: string;
}

export interface FileDiff {
  path: string;
  hunks: { header: string; lines: DiffLine[] }[];
  /** Lines in the new file that GitHub will accept an inline comment on. */
  commentableLines: Set<number>;
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Parses one file's patch into hunks with new-file line numbers. */
export function parsePatch(path: string, patch: string): FileDiff {
  const hunks: FileDiff["hunks"] = [];
  const commentableLines = new Set<number>();
  let current: FileDiff["hunks"][number] | null = null;
  let newLine = 0;

  for (const raw of patch.split("\n")) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      newLine = Number(header[1]);
      current = { header: raw, lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current || raw.startsWith("\\")) continue; // "\ No newline at end of file"

    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === "+") {
      current.lines.push({ kind: "add", newLine, text });
      commentableLines.add(newLine++);
    } else if (marker === "-") {
      current.lines.push({ kind: "del", newLine: null, text });
    } else {
      current.lines.push({ kind: "ctx", newLine, text });
      commentableLines.add(newLine++);
    }
  }
  return { path, hunks, commentableLines };
}

export interface PreparedDiff {
  files: FileDiff[];
  /** Files we couldn't or chose not to review, with the reason. */
  skipped: { path: string; reason: string }[];
}

/** Turns the PR's file list into parsed diffs, dropping ignored, deleted and binary files. */
export function prepareDiff(files: PullRequestFile[], ignorePaths: string[]): PreparedDiff {
  const isIgnored = picomatch(ignorePaths, { dot: true });
  const result: PreparedDiff = { files: [], skipped: [] };

  for (const f of files) {
    if (f.status === "removed") continue;
    if (isIgnored(f.filename)) {
      result.skipped.push({ path: f.filename, reason: "ignored by settings" });
    } else if (!f.patch) {
      result.skipped.push({ path: f.filename, reason: "binary or too large to diff" });
    } else {
      result.files.push(parsePatch(f.filename, f.patch));
    }
  }
  return result;
}

/**
 * Renders a file diff for the model with new-file line numbers in a gutter, so the model can
 * point at exact lines:
 *
 *     12 + const total = items.reduce(...)
 *        - const total = 0
 *     13   return total
 */
export function renderForModel(file: FileDiff): string {
  const out = [`### ${file.path}`];
  for (const hunk of file.hunks) {
    out.push(hunk.header);
    for (const line of hunk.lines) {
      const num = line.newLine === null ? "" : String(line.newLine);
      const marker = line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
      out.push(`${num.padStart(5)} ${marker} ${line.text}`);
    }
  }
  return out.join("\n");
}

/**
 * Groups files into chunks that each fit in one model request. Large PRs become several
 * requests that run in parallel. A single file bigger than the limit is cut at hunk boundaries.
 */
export function chunkFiles(files: FileDiff[], maxChars: number): FileDiff[][] {
  const chunks: FileDiff[][] = [];
  let current: FileDiff[] = [];
  let size = 0;

  const flush = () => {
    if (current.length) chunks.push(current);
    current = [];
    size = 0;
  };

  for (const file of files) {
    for (const piece of splitFile(file, maxChars)) {
      const pieceSize = renderForModel(piece).length;
      if (size + pieceSize > maxChars) flush();
      current.push(piece);
      size += pieceSize;
    }
  }
  flush();
  return chunks;
}

function splitFile(file: FileDiff, maxChars: number): FileDiff[] {
  if (renderForModel(file).length <= maxChars) return [file];
  const pieces: FileDiff[] = [];
  let hunks: FileDiff["hunks"] = [];
  for (const hunk of file.hunks) {
    const candidate = { ...file, hunks: [...hunks, hunk] };
    if (hunks.length && renderForModel(candidate).length > maxChars) {
      pieces.push({ ...file, hunks });
      hunks = [hunk];
    } else {
      hunks.push(hunk);
    }
  }
  if (hunks.length) pieces.push({ ...file, hunks });
  return pieces;
}
