import type { Review } from "../api";
import { timeAgo } from "../lib/time";
import { Badge } from "./ui";

const STATUS: Record<Review["status"], { label: string; tone: "green" | "gray" | "amber" | "red" }> = {
  COMPLETED: { label: "Reviewed", tone: "green" },
  SKIPPED: { label: "Skipped", tone: "gray" },
  IN_PROGRESS: { label: "Running", tone: "amber" },
  FAILED: { label: "Failed", tone: "red" },
};

export function ReviewHistory({ reviews }: { reviews: Review[] }) {
  if (reviews.length === 0) {
    return <p className="px-5 py-10 text-center text-sm text-gray-500">No reviews yet. Open a pull request to see one here.</p>;
  }
  return (
    <ul className="divide-y divide-gray-100">
      {reviews.map((r) => (
        <li key={`${r.prNumber}-${r.headSha}-${r.startedAt}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {r.reviewUrl ? (
                <a href={r.reviewUrl} target="_blank" rel="noreferrer" className="hover:underline">
                  #{r.prNumber} {r.prTitle}
                </a>
              ) : (
                <>
                  #{r.prNumber} {r.prTitle}
                </>
              )}
            </p>
            <p className="text-xs text-gray-500">
              <code>{r.headSha.slice(0, 7)}</code> · {timeAgo(r.startedAt)}
              {r.status === "COMPLETED"
                ? ` · ${r.filesReviewed} files · ${r.commentsPosted} comments · ${r.filteredOut} filtered`
                : r.note
                  ? ` · ${r.note}`
                  : ""}
            </p>
          </div>
          <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
        </li>
      ))}
    </ul>
  );
}
