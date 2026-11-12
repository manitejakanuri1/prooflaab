/**
 * Browser-facing authentication calls.
 *
 * Browser JavaScript never receives application credentials.
 * Authentication is represented only by the secure HttpOnly
 * session cookie owned by the BFF.
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

export interface BffSignupInput {
  email: string;
  password: string;
  full_name: string;
  account_type: string;
}

export interface BffUpdateUserInput {
  password?: string;
  /** Required by the server whenever `password` is set. */
  current_password?: string;
  email?: string;
  data?: Record<string, unknown>;
}

async function errorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body =
      (await response.json()) as {
        error?: unknown;
        retry_after_seconds?: unknown;
      };

    // E2E-27: a lockout says how long it lasts; keep that number for the student.
    if (
      typeof body.retry_after_seconds === "number" &&
      body.retry_after_seconds > 0
    ) {
      const minutes = Math.ceil(body.retry_after_seconds / 60);
      return `Too many tries. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
    }

    if (
      typeof body.error === "string" &&
      body.error.trim()
    ) {
      return body.error;
    }
  } catch {
    // Use fallback.
  }

  return fallback;
}

/**
 * 17b (owner retest 12 Nov): Google's hosting edge sometimes answers a fast HTML 502/503 page without
 * passing the request on (TEST web-bff logged no 5xx for /api/auth/* that day). Our BFF always answers
 * JSON, so an HTML 5xx that came back within 3 s never reached it and is safe to send once more - even a
 * sign-in, because no password was checked. Anything else (a JSON error, a slow failure, a network
 * error) is never repeated.
 */
const isEdgeFault = (res: Response, ms: number) =>
  res.status >= 500 && ms < 3000 && (res.headers.get("content-type") ?? "").includes("text/html");

async function sendOnceMoreIfEdge(send: () => Promise<Response>): Promise<Response> {
  const started = Date.now();
  const res = await send();
  if (!isEdgeFault(res, Date.now() - started)) return res;
  await new Promise((r) => setTimeout(r, 300));
  return send();
}

async function jsonPost(
  path: string,
  body: unknown,
  fallback: string,
): Promise<Response> {
  const response = await sendOnceMoreIfEdge(() => fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }));

  if (!response.ok) {
    throw Object.assign(new Error(await errorMessage(response, fallback)), { status: response.status });
  }

  return response;
}

// Overnight TEST 12 Nov item 11 / 17b: a sign-in that hit a release or an edge fault is sent once more by
// jsonPost, only when the request provably never reached the server (no password checked twice).
export async function startBffSession(
  email: string,
  password: string,
): Promise<BffSession> {
  return startBffSessionOnce(email, password);
}

async function startBffSessionOnce(
  email: string,
  password: string,
): Promise<BffSession> {
  const response = await jsonPost(
    "/api/auth/login",
    { email, password },
    "Could not start your secure session. Please try again.",
  );

  const body =
    (await response.json()) as {
      session?: BffSession;
    };

  if (!body.session?.user?.id) {
    throw new Error(
      "Could not start your secure session. Please try again.",
    );
  }

  return body.session;
}

export async function signupBffSession(
  input: BffSignupInput,
): Promise<BffSession> {
  const response = await jsonPost(
    "/api/auth/signup",
    input,
    "Could not create your account.",
  );

  const body =
    (await response.json()) as {
      session?: BffSession;
    };

  if (!body.session?.user?.id) {
    throw new Error(
      "Could not start your secure session. Please sign in to continue.",
    );
  }

  return body.session;
}

export async function readBffSession():
  Promise<BffSession | null> {
  // R8: a read changes nothing, so an edge fault is repeated here too (else a reload looked signed out).
  const response = await sendOnceMoreIfEdge(() => fetch(
    "/api/auth/session",
    {
      method: "GET",
      credentials: "same-origin",
    },
  ));

  if (!response.ok) {
    throw new Error(
      "Could not check your secure session.",
    );
  }

  const body =
    (await response.json()) as {
      session?: BffSession | null;
    };

  return body.session ?? null;
}

export async function endBffSession():
  Promise<void> {
  const response = await fetch(
    "/api/auth/logout",
    {
      method: "POST",
      credentials: "same-origin",
    },
  );

  if (!response.ok) {
    throw new Error(
      await errorMessage(
        response,
        "Could not complete logout.",
      ),
    );
  }
}

export async function updateBffUser(
  input: BffUpdateUserInput,
): Promise<BffSessionUser> {
  const response = await jsonPost(
    "/api/auth/update",
    input,
    "Could not update your account.",
  );

  const body =
    (await response.json()) as {
      user?: BffSessionUser;
    };

  if (!body.user?.id) {
    throw new Error(
      "Could not update your account.",
    );
  }

  return body.user;
}

export async function requestBffPasswordReset(
  email: string,
): Promise<void> {
  await jsonPost(
    "/api/auth/password-reset/request",
    { email },
    "Could not request a password reset.",
  );
}

export async function verifyBffPasswordReset(
  oobCode: string,
): Promise<void> {
  await jsonPost(
    "/api/auth/password-reset/verify",
    {
      oob_code: oobCode,
    },
    "That reset link is invalid or has expired.",
  );
}

export async function completeBffPasswordReset(
  oobCode: string,
  newPassword: string,
): Promise<void> {
  await jsonPost(
    "/api/auth/password-reset/complete",
    {
      oob_code: oobCode,
      new_password: newPassword,
    },
    "Could not update your password.",
  );
}

export async function verifyBffEmail(
  oobCode: string,
): Promise<void> {
  await jsonPost(
    "/api/auth/verify-email",
    {
      oob_code: oobCode,
    },
    "That verification link is invalid or has expired.",
  );
}

export async function resendBffVerification(
  accountType: string,
): Promise<void> {
  await jsonPost(
    "/api/auth/resend-verification",
    {
      account_type: accountType,
    },
    "Could not resend verification email.",
  );
}
