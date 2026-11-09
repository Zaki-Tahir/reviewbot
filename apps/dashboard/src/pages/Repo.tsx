import { useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api";
import { ReviewHistory } from "../components/ReviewHistory";
import { SettingsForm } from "../components/SettingsForm";
import { Card, ErrorBox, Spinner } from "../components/ui";
import { timeAgo } from "../lib/time";
import { useAsync } from "../lib/useAsync";

export function RepoPage() {
  const { owner, name } = useParams();
  const repo = `${owner}/${name}`;
  const [settings, reloadSettings] = useAsync(() => api.settings(repo), [repo]);
  const [reviews, reloadReviews] = useAsync(() => api.reviews(repo), [repo]);
  const [saved, setSaved] = useState<{ by?: string; at?: string } | null>(null);
  const changedBy = saved?.by ?? (settings.status === "ready" ? settings.data.updatedBy : undefined);
  const changedAt = saved?.at ?? (settings.status === "ready" ? settings.data.updatedAt : undefined);

  return (
    <>
      <Link to="/" className="text-sm text-gray-500 hover:text-gray-900">
        ← Repositories
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{repo}</h1>
      <p className="mt-1 mb-6 text-sm text-gray-500">
        {changedBy && changedAt ? `Settings last changed by ${changedBy} ${timeAgo(changedAt)}.` : "Using the default settings."}
      </p>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Card title="Review settings">
            {settings.status === "loading" && <Spinner />}
            {settings.status === "error" && <ErrorBox error={settings.error} onRetry={reloadSettings} />}
            {settings.status === "ready" && (
              <SettingsForm
                key={repo}
                initial={settings.data.settings}
                readOnly={!settings.data.canManage}
                onSave={async (s) => {
                  const res = await api.saveSettings(repo, s);
                  setSaved({ by: res.updatedBy, at: res.updatedAt });
                }}
              />
            )}
          </Card>
        </div>
        <div className="lg:col-span-2">
          <Card
            title="Recent reviews"
            action={
              <button onClick={reloadReviews} className="text-xs font-medium text-gray-500 hover:text-gray-900">
                Refresh
              </button>
            }
          >
            {reviews.status === "loading" && <Spinner />}
            {reviews.status === "error" && <ErrorBox error={reviews.error} onRetry={reloadReviews} />}
            {reviews.status === "ready" && <ReviewHistory reviews={reviews.data} />}
          </Card>
        </div>
      </div>
    </>
  );
}
