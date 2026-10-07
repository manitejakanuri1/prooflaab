const COOKIE_NAME = "__Host-prooflab_session";
const VERSION = 1;
const AAD = new TextEncoder().encode("prooflab-session-v1");

export interface SessionUser {
  id: string;
  email: string;
  email_confirmed_at: string | null;
  role: string;
  user_metadata: Record<string, unknown>;
}

export interface PrivateSession {
  v: 1;

  // Never returned to browser JavaScript.
  googleRefreshToken: string;
  appAccessToken: string;
  appAccessExpiresAt: number;

  // Safe identity information the UI may receive from /api/auth/session.
  user: SessionUser;

  // Absolute session lifetime, independent of token refresh.
  expiresAt: number;
}

function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64urlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (value.length % 4)) % 4);

  const binary = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(binary.length));

  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }

  return out;
}

async function sessionKey(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error("SESSION_KEY is missing");

  const raw = b64urlDecode(secret);

  if (raw.length !== 32) {
    throw new Error("SESSION_KEY must decode to exactly 32 bytes");
  }

  return await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealSession(
  session: PrivateSession,
  secret: string,
): Promise<string> {
  const key = await sessionKey(secret);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(session));

  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: AAD,
      },
      key,
      plaintext,
    ),
  );

  return `v1.${b64urlEncode(iv)}.${b64urlEncode(encrypted)}`;
}

export async function unsealSession(
  value: string,
  secret: string,
  nowMs = Date.now(),
): Promise<PrivateSession | null> {
  try {
    const [version, ivPart, encryptedPart, extra] = value.split(".");

    if (
      version !== "v1" ||
      !ivPart ||
      !encryptedPart ||
      extra !== undefined
    ) {
      return null;
    }

    const key = await sessionKey(secret);
    const iv = b64urlDecode(ivPart);
    const encrypted = b64urlDecode(encryptedPart);

    if (iv.length !== 12) return null;

    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: AAD,
      },
      key,
      encrypted,
    );

    const parsed = JSON.parse(
      new TextDecoder().decode(plaintext),
    ) as Partial<PrivateSession>;

    if (parsed.v !== VERSION) return null;
    if (typeof parsed.googleRefreshToken !== "string") return null;
    if (typeof parsed.appAccessToken !== "string") return null;
    if (typeof parsed.appAccessExpiresAt !== "number") return null;
    if (typeof parsed.expiresAt !== "number") return null;
    if (parsed.expiresAt <= nowMs) return null;

    if (
      !parsed.user ||
      typeof parsed.user.id !== "string" ||
      typeof parsed.user.email !== "string"
    ) {
      return null;
    }

    return parsed as PrivateSession;
  } catch {
    // Forged, damaged, expired or encrypted with another key = signed out.
    return null;
  }
}

export function readSessionCookie(req: Request): string | null {
  const raw = req.headers.get("Cookie");
  if (!raw) return null;

  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const prefix = `${COOKIE_NAME}=`;

    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length);
    }
  }

  return null;
}

export function makeSessionCookie(
  sealed: string,
  maxAgeSeconds: number,
): string {
  return [
    `${COOKIE_NAME}=${sealed}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ].join("; ");
}

export function clearSessionCookie(): string {
  return [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Max-Age=0",
  ].join("; ");
}

export { COOKIE_NAME };
