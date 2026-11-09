import { z } from "zod";

export const CATEGORIES = ["bug", "security", "tests", "performance", "style"] as const;
export type Category = (typeof CATEGORIES)[number];

export const SEVERITIES = ["low", "medium", "high"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const severityRank: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

/** Per-repository review settings, edited in the dashboard. */
export const repoSettingsSchema = z.object({
  enabled: z.boolean(),
  /** Don't review draft PRs until they're marked ready. */
  skipDrafts: z.boolean(),
  minSeverity: z.enum(SEVERITIES),
  categories: z.object({
    bug: z.boolean(),
    security: z.boolean(),
    tests: z.boolean(),
    performance: z.boolean(),
    style: z.boolean(),
  }),
  /** Glob patterns for files to skip, e.g. "**\/*.lock". */
  ignorePaths: z.array(z.string().min(1).max(200)).max(50),
  /** Extra guidance passed to the model, e.g. "We use Result types instead of exceptions." */
  instructions: z.string().max(2000),
  maxComments: z.number().int().min(1).max(50),
});

export type RepoSettings = z.infer<typeof repoSettingsSchema>;

export const DEFAULT_SETTINGS: RepoSettings = {
  enabled: true,
  skipDrafts: true,
  minSeverity: "medium",
  categories: { bug: true, security: true, tests: true, performance: false, style: false },
  ignorePaths: ["**/*.lock", "**/package-lock.json", "**/pnpm-lock.yaml", "**/dist/**", "**/*.min.js", "**/*.snap"],
  instructions: "",
  maxComments: 15,
};

/** Fills in anything missing from stored settings, so adding a new setting never breaks old rows. */
export function withDefaults(stored: unknown): RepoSettings {
  const partial = (stored ?? {}) as Partial<RepoSettings>;
  return repoSettingsSchema.parse({
    ...DEFAULT_SETTINGS,
    ...partial,
    categories: { ...DEFAULT_SETTINGS.categories, ...partial.categories },
  });
}
