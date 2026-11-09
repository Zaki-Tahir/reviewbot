import { Octokit } from "@octokit/rest";

export interface AccessibleRepo {
  fullName: string;
  private: boolean;
  /** Can this user change settings? Requires write access to the repo. */
  canManage: boolean;
}

/** GitHub calls made with a signed-in user's token, for the dashboard. */
export interface UserGitHub {
  exchangeCode(code: string, redirectUri: string): Promise<string>;
  getUser(token: string): Promise<{ login: string; avatarUrl: string }>;
  /** Repos where this GitHub App is installed and the user has access. */
  listRepos(token: string): Promise<AccessibleRepo[]>;
}

export class GitHubUserApi implements UserGitHub {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  async exchangeCode(code: string, redirectUri: string): Promise<string> {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: this.clientId, client_secret: this.clientSecret, code, redirect_uri: redirectUri }),
    });
    const data = (await res.json()) as { access_token?: string; error_description?: string };
    if (!data.access_token) throw new Error(`GitHub sign-in failed: ${data.error_description ?? res.status}`);
    return data.access_token;
  }

  async getUser(token: string) {
    const { data } = await new Octokit({ auth: token }).users.getAuthenticated();
    return { login: data.login, avatarUrl: data.avatar_url };
  }

  async listRepos(token: string): Promise<AccessibleRepo[]> {
    const octokit = new Octokit({ auth: token });
    // With a GitHub App user token, this only returns installations of *this* app.
    const installations = await octokit.paginate(octokit.apps.listInstallationsForAuthenticatedUser, { per_page: 100 });
    const repos = await Promise.all(
      installations.map((i) =>
        octokit.paginate(octokit.apps.listInstallationReposForAuthenticatedUser, { installation_id: i.id, per_page: 100 }),
      ),
    );
    return repos.flat().map((r) => ({
      fullName: r.full_name,
      private: r.private,
      canManage: Boolean(r.permissions?.admin || r.permissions?.maintain || r.permissions?.push),
    }));
  }
}
