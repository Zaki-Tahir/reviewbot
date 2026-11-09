import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

export interface Secrets {
  GITHUB_APP_ID: string;
  /** PEM private key of the GitHub App. */
  GITHUB_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
  /** OAuth credentials of the same GitHub App, used for dashboard sign-in. */
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  OPENAI_API_KEY: string;
  /** 32+ random bytes, base64. Encrypts dashboard session cookies. */
  SESSION_SECRET: string;
}

let cached: Promise<Partial<Secrets>> | undefined;

/**
 * In AWS, secrets come from one Secrets Manager JSON secret (SECRET_ARN) and are cached for the
 * life of the Lambda container. Locally they come from environment variables.
 */
export function loadSecrets(): Promise<Partial<Secrets>> {
  cached ??= (async () => {
    const arn = process.env.SECRET_ARN;
    if (!arn) return process.env as Partial<Secrets>;
    const res = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: arn }));
    return JSON.parse(res.SecretString ?? "{}") as Partial<Secrets>;
  })();
  return cached;
}

export async function getSecret(key: keyof Secrets): Promise<string> {
  const value = (await loadSecrets())[key];
  if (!value) throw new Error(`Missing secret ${key}`);
  // Private keys pasted into env files often have literal "\n".
  return key === "GITHUB_PRIVATE_KEY" ? value.replace(/\\n/g, "\n") : value;
}

export function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/** Structured logs for CloudWatch Logs Insights. */
export function log(level: "info" | "warn" | "error", msg: string, data: object = {}) {
  console[level === "info" ? "log" : level](JSON.stringify({ level, msg, ...data }));
}
