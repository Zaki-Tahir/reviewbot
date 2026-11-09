export type Category = "bug" | "security" | "tests" | "performance" | "style";
export type Severity = "low" | "medium" | "high";

export interface RepoSettings {
  enabled: boolean;
  skipDrafts: boolean;
  minSeverity: Severity;
  categories: Record<Category, boolean>;
  ignorePaths: string[];
  instructions: string;
  maxComments: number;
}

export interface Me {
  login: string;
  avatarUrl: string;
  installUrl: string;
}

export interface Repo {
  fullName: string;
  private: boolean;
  canManage: boolean;
  enabled: boolean;
}

export interface SettingsResponse {
  settings: RepoSettings;
  updatedAt?: string;
  updatedBy?: string;
  canManage: boolean;
}

export interface Review {
  repo: string;
  prNumber: number;
  headSha: string;
  prTitle?: string;
  status: "IN_PROGRESS" | "COMPLETED" | "SKIPPED" | "FAILED";
  startedAt: string;
  filesReviewed?: number;
  commentsPosted?: number;
  filteredOut?: number;
  reviewUrl?: string;
  note?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? res.statusText);
  return body as T;
}

export const api = {
  me: () => request<Me>("/me"),
  repos: () => request<Repo[]>("/repos"),
  settings: (repo: string) => request<SettingsResponse>(`/repos/${repo}/settings`),
  saveSettings: (repo: string, settings: RepoSettings) =>
    request<SettingsResponse>(`/repos/${repo}/settings`, { method: "PUT", body: JSON.stringify(settings) }),
  reviews: (repo: string) => request<Review[]>(`/repos/${repo}/reviews`),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
};
