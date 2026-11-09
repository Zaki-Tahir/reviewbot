import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { parsePatch } from "./diff.js";
import { buildSystemPrompt, OpenAIReviewer } from "./llm.js";
import { DEFAULT_SETTINGS } from "./settings.js";

const files = [parsePatch("src/a.ts", "@@ -1 +1,2 @@\n line1\n+line2")];
const pr = { title: "Add discount codes", body: "" };

function fakeClient(outputText: string) {
  const create = vi.fn(async () => ({ output_text: outputText }));
  return { client: { responses: { create } } as unknown as OpenAI, create };
}

describe("buildSystemPrompt", () => {
  it("lists only enabled categories and includes team guidelines", () => {
    const prompt = buildSystemPrompt({ ...DEFAULT_SETTINGS, instructions: "We never throw; return Result types." });
    expect(prompt).toContain("- bug:");
    expect(prompt).toContain("- security:");
    expect(prompt).not.toContain("- style:");
    expect(prompt).toContain("We never throw; return Result types.");
  });
});

describe("OpenAIReviewer", () => {
  it("asks for strict structured output and validates the reply", async () => {
    const reply = {
      summary: "Adds discount codes.",
      comments: [
        {
          path: "src/a.ts",
          line: 2,
          category: "bug",
          severity: "high",
          confidence: 0.8,
          title: "t",
          body: "b",
          suggestion: null,
        },
      ],
    };
    const { client, create } = fakeClient(JSON.stringify(reply));
    const result = await new OpenAIReviewer(client, "test-model").reviewChunk(pr, files, DEFAULT_SETTINGS);

    expect(result).toEqual(reply);
    const request = (create.mock.calls[0] as unknown[])[0] as {
      model: string;
      input: string;
      text: { format: { type: string; strict: boolean } };
    };
    expect(request.model).toBe("test-model");
    expect(request.text.format).toMatchObject({ type: "json_schema", strict: true });
    expect(request.input).toContain("    2 + line2");
    expect(request.input).toContain("(no description)");
  });

  it("rejects replies that don't match the schema", async () => {
    const { client } = fakeClient(JSON.stringify({ summary: "x", comments: [{ path: "a", line: "two" }] }));
    await expect(new OpenAIReviewer(client, "m").reviewChunk(pr, files, DEFAULT_SETTINGS)).rejects.toThrow();
  });

  it("doesn't call the model to merge a single summary", async () => {
    const { client, create } = fakeClient("unused");
    await expect(new OpenAIReviewer(client, "m").mergeSummaries(pr, ["only one"])).resolves.toBe("only one");
    expect(create).not.toHaveBeenCalled();
  });
});
