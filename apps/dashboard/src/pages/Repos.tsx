import { Link } from "react-router";
import { api, type Me } from "../api";
import { Badge, Card, ErrorBox, Spinner } from "../components/ui";
import { useAsync } from "../lib/useAsync";

export function ReposPage({ me }: { me: Me }) {
  const [repos, reload] = useAsync(api.repos, []);

  const installLink = (
    <a href={me.installUrl} className="text-sm font-medium text-gray-900 hover:underline">
      + Add repositories
    </a>
  );

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Repositories</h1>
      <p className="mt-1 mb-6 text-sm text-gray-500">Repos where ReviewBot is installed and you have access.</p>
      <Card title="Your repositories" action={installLink}>
        {repos.status === "loading" && <Spinner />}
        {repos.status === "error" && <ErrorBox error={repos.error} onRetry={reload} />}
        {repos.status === "ready" &&
          (repos.data.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-500">
              ReviewBot isn't installed on any of your repositories yet.{" "}
              <a href={me.installUrl} className="font-medium text-gray-900 underline">
                Install it
              </a>
              .
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {repos.data.map((r) => (
                <li key={r.fullName}>
                  <Link to={`/repos/${r.fullName}`} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-gray-50">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {r.fullName}
                      {r.private && <Badge tone="gray">Private</Badge>}
                    </span>
                    <span className="flex items-center gap-2">
                      {!r.canManage && <span className="text-xs text-gray-400">read only</span>}
                      <Badge tone={r.enabled ? "green" : "gray"}>{r.enabled ? "Reviewing" : "Paused"}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ))}
      </Card>
    </>
  );
}
