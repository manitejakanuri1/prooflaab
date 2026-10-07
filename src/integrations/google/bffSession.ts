/**
 * Browser-facing session calls for the web BFF.
 *
 * The BFF owns the real application access token and Google refresh token.
 * The browser receives only an opaque HttpOnly cookie, which JavaScript cannot
 * read. These helpers intentionally never accept or return bearer tokens.
 */

export interface BffSessionUser {
  id: string;
  email: string;
  email_confirmed_at: string | null;
  role: string;
  user_metadata: Record<string, unknown>;
}

export interface BffSession {
  user: BffSessionUser;
  expires_at: number;
}

async function errorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) {
      return body.error;
    }
  } catch {
    // Use the safe fallback below.
  }

  return fallback;
}

export async function startBffSession(
  email: string,
  password: string,
): Promise<BffSession> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new Error(
      await errorMessage(
        response,
        "Could not start your secure session. Please try again.",
      ),
    );
  }

  const body = (await response.json()) as {
    session?: BffSession;
  };

  if (!body.session?.user?.id) {
    throw new Error(
      "Could not start your secure session. Please try again.",
    );
  }

  return body.session;
}

export async function readBffSession(): Promise<BffSession | null> {
  const response = await fetch("/api/auth/session", {
    method: "GET",
    credentials: "same-origin",
  });

  if (!response.ok) {
    throw new Error("Could not check your secure session.");
  }

  const body = (await response.json()) as {
    session?: BffSession | null;
  };

  return body.session ?? null;
}

export async function endBffSession(): Promise<void> {
  const response = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  });

  if (!response.ok) {
    throw new Error(
      await errorMessage(
        response,
        "Could not complete logout.",
      ),
    );
  }
}
