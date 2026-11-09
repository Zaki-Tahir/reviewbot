import { EncryptJWT, jwtDecrypt } from "jose";

export interface Session {
  login: string;
  avatarUrl: string;
  /** The user's GitHub token, used to check which repos they can manage. Never sent to the browser in readable form. */
  token: string;
}

export const SESSION_COOKIE = "rb_session";
export const STATE_COOKIE = "rb_oauth_state";
const SESSION_HOURS = 8;

function keyFrom(secret: string): Uint8Array {
  const key = Buffer.from(secret, "base64");
  if (key.length !== 32) throw new Error("SESSION_SECRET must be 32 bytes, base64-encoded (openssl rand -base64 32)");
  return key;
}

/**
 * Sessions are encrypted (JWE, AES-256-GCM), not just signed, because they carry the user's
 * GitHub token. No session table needed: the cookie is the session.
 */
export async function sealSession(session: Session, secret: string, now = new Date()): Promise<string> {
  return new EncryptJWT({ ...session })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(now.getTime() / 1000) + SESSION_HOURS * 3600)
    .encrypt(keyFrom(secret));
}

export async function openSession(cookie: string | undefined, secret: string, now = new Date()): Promise<Session | null> {
  if (!cookie) return null;
  try {
    const { payload } = await jwtDecrypt(cookie, keyFrom(secret), { currentDate: now });
    const { login, avatarUrl, token } = payload as Partial<Session>;
    return login && token ? { login, avatarUrl: avatarUrl ?? "", token } : null;
  } catch {
    return null; // expired, tampered with, or encrypted with an old key
  }
}

export function cookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function readCookies(cookies: string[] | undefined, header?: string): Record<string, string> {
  const pairs = [...(cookies ?? []), ...(header ? header.split(";") : [])];
  return Object.fromEntries(
    pairs
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        const i = c.indexOf("=");
        return [c.slice(0, i), c.slice(i + 1)];
      }),
  );
}
