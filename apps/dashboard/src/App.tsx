import { BrowserRouter, Route, Routes } from "react-router";
import { ApiError, api } from "./api";
import { ErrorBox, Spinner } from "./components/ui";
import { useAsync } from "./lib/useAsync";
import { RepoPage } from "./pages/Repo";
import { ReposPage } from "./pages/Repos";

function SignIn() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gray-900 text-xl font-bold text-white">R</div>
        <h1 className="text-xl font-semibold">ReviewBot</h1>
        <p className="mt-2 text-sm text-gray-500">AI code review on every pull request. Sign in to manage your repositories.</p>
        <a
          href="/api/auth/login"
          className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-700"
        >
          Sign in with GitHub
        </a>
      </div>
    </div>
  );
}

export function App() {
  const [me, reload] = useAsync(api.me, []);

  if (me.status === "loading") return <Spinner />;
  if (me.status === "error") {
    if (me.error instanceof ApiError && me.error.status === 401) return <SignIn />;
    return <ErrorBox error={me.error} onRetry={reload} />;
  }

  return (
    <BrowserRouter>
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <a href="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-900 text-sm text-white">R</span>
            ReviewBot
          </a>
          <div className="flex items-center gap-3 text-sm">
            <img src={me.data.avatarUrl} alt="" className="h-7 w-7 rounded-full bg-gray-200" />
            <span className="hidden sm:inline">{me.data.login}</span>
            <button onClick={() => api.logout().then(() => window.location.assign("/"))} className="text-gray-500 hover:text-gray-900">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Routes>
          <Route path="/" element={<ReposPage me={me.data} />} />
          <Route path="/repos/:owner/:name" element={<RepoPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
