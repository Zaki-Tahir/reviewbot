import { type FormEvent, useState } from "react";
import type { Category, RepoSettings, Severity } from "../api";

const CATEGORY_INFO: Record<Category, { label: string; hint: string }> = {
  bug: { label: "Bugs", hint: "Logic errors, null access, unhandled errors" },
  security: { label: "Security", hint: "Injection, missing auth, leaked secrets" },
  tests: { label: "Missing tests", hint: "New behavior with no test" },
  performance: { label: "Performance", hint: "N+1 queries, work in hot loops" },
  style: { label: "Readability", hint: "Naming and clarity (can be noisy)" },
};

interface Props {
  initial: RepoSettings;
  readOnly: boolean;
  onSave: (settings: RepoSettings) => Promise<void>;
}

const field = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-900 focus:ring-2 focus:ring-gray-200 focus:outline-none disabled:bg-gray-50";

export function SettingsForm({ initial, readOnly, onSave }: Props) {
  const [s, setS] = useState(initial);
  const [ignore, setIgnore] = useState(initial.ignorePaths.join("\n"));
  const [state, setState] = useState<{ kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string }>({ kind: "idle" });

  const update = (patch: Partial<RepoSettings>) => {
    setS((prev) => ({ ...prev, ...patch }));
    setState({ kind: "idle" });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState({ kind: "saving" });
    try {
      await onSave({
        ...s,
        ignorePaths: ignore
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
      });
      setState({ kind: "saved" });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "Could not save" });
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6 p-5">
      <fieldset disabled={readOnly} className="space-y-6">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">Review pull requests</span>
            <span className="block text-xs text-gray-500">Turn off to pause the bot on this repository.</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Review pull requests"
            checked={s.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
            className="h-5 w-5 rounded border-gray-300"
          />
        </label>

        <div>
          <p className="text-sm font-medium">What to look for</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {(Object.keys(CATEGORY_INFO) as Category[]).map((c) => (
              <label key={c} className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={s.categories[c]}
                  onChange={(e) => update({ categories: { ...s.categories, [c]: e.target.checked } })}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300"
                />
                <span>
                  <span className="block text-sm font-medium">{CATEGORY_INFO[c].label}</span>
                  <span className="block text-xs text-gray-500">{CATEGORY_INFO[c].hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium">Minimum severity</span>
            <select className={field} value={s.minSeverity} onChange={(e) => update({ minSeverity: e.target.value as Severity })}>
              <option value="low">Low: comment on anything</option>
              <option value="medium">Medium: likely problems</option>
              <option value="high">High: only serious issues</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Max comments per review</span>
            <input
              type="number"
              min={1}
              max={50}
              className={field}
              value={s.maxComments}
              onChange={(e) => update({ maxComments: Number(e.target.value) })}
            />
          </label>
        </div>

        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" checked={s.skipDrafts} onChange={(e) => update({ skipDrafts: e.target.checked })} className="h-4 w-4 rounded border-gray-300" />
          Wait until draft PRs are marked ready for review
        </label>

        <label className="block">
          <span className="text-sm font-medium">Ignore files</span>
          <span className="block text-xs text-gray-500">One glob per line, e.g. **/generated/**</span>
          <textarea className={`${field} font-mono text-xs`} rows={4} value={ignore} onChange={(e) => setIgnore(e.target.value)} />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Team guidelines</span>
          <span className="block text-xs text-gray-500">Extra context for the reviewer, like conventions your team follows.</span>
          <textarea
            className={field}
            rows={3}
            maxLength={2000}
            value={s.instructions}
            placeholder="We return Result types instead of throwing. All DB access goes through repositories."
            onChange={(e) => update({ instructions: e.target.value })}
          />
        </label>
      </fieldset>

      {readOnly ? (
        <p className="text-sm text-gray-500">You need write access to this repository to change its settings.</p>
      ) : (
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={state.kind === "saving"}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-60"
          >
            {state.kind === "saving" ? "Saving…" : "Save settings"}
          </button>
          {state.kind === "saved" && <span className="text-sm text-emerald-700">Saved. Applies to the next push.</span>}
          {state.kind === "error" && <span className="text-sm text-red-600">{state.message}</span>}
        </div>
      )}
    </form>
  );
}
