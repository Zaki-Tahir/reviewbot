import type { ReactNode } from "react";

export function Card({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
      {title && (
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = "green" | "gray" | "amber" | "red" | "blue";
const tones: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  gray: "bg-gray-100 text-gray-600 ring-gray-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
};

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Spinner() {
  return <div className="px-5 py-10 text-center text-sm text-gray-400">Loading…</div>;
}

export function ErrorBox({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="m-5 rounded-lg bg-red-50 p-4 text-sm text-red-700">
      {error.message}
      {onRetry && (
        <button onClick={onRetry} className="ml-3 font-medium underline">
          Try again
        </button>
      )}
    </div>
  );
}
