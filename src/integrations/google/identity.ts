/**
 * Supabase-auth-shaped compatibility adapter backed entirely by
 * the same-origin ProofLab web BFF.
 *
 * Browser JavaScript owns no Google ID token, refresh credential,
 * application bearer credential or provider secret.
 *
 * The BFF stores the real credentials server-side and the browser
 * receives only safe user/session data plus an opaque HttpOnly cookie.
 */

import {
  endBffSession,
  readBffSession,
  requestBffPasswordReset,
  resendBffVerification,
  signupBffSession,
  startBffSession,
  updateBffUser,
  type BffSession,
  type BffSessionUser,
} from "./bffSession";

export interface GoogleUser {
  id: string;
  aud: string;
  role: string;
  email: string;
  email_confirmed_at: string | null;
  phone: string;
  created_at: string;
  updated_at: string;
  last_sign_in_at: string | null;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  identities: unknown[];
}

export interface GoogleSession {
  expires_at: number;
  user: GoogleUser;
}

type AuthEvent =
  | "INITIAL_SESSION"
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "TOKEN_REFRESHED"
  | "USER_UPDATED";

type Listener =
  (
    event: AuthEvent,
    session: GoogleSession | null,
  ) => void;

interface Result<T> {
  data: T;
  error:
    | {
        message: string;
        status?: number;
      }
    | null;
}

let current: GoogleSession | null = null;
let bootstrapPromise:
  Promise<GoogleSession | null> | null = null;

const listeners =
  new Set<Listener>();

function safeUser(
  user: BffSessionUser,
): GoogleUser {
  const now =
    new Date().toISOString();

  return {
    id: user.id,
    aud: "authenticated",
    role:
      user.role ||
      "authenticated",
    email: user.email,
    email_confirmed_at:
      user.email_confirmed_at,
    phone: "",
    created_at: now,
    updated_at: now,
    last_sign_in_at: null,
    app_metadata: {
      provider: "email",
      providers: ["email"],
    },
    user_metadata:
      user.user_metadata ?? {},
    identities: [],
  };
}

function safeSession(
  session: BffSession,
): GoogleSession {
  return {
    expires_at:
      session.expires_at,
    user:
      safeUser(session.user),
  };
}

function emit(
  event: AuthEvent,
  session: GoogleSession | null,
): void {
  for (const fn of listeners) {
    try {
      fn(event, session);
    } catch (error) {
      console.error(
        "auth listener failed",
        error,
      );
    }
  }
}

function adopt(
  session: GoogleSession | null,
  event?: AuthEvent,
): GoogleSession | null {
  current = session;
  bootstrapPromise =
    Promise.resolve(session);

  if (event) {
    emit(event, session);
  }

  return session;
}

async function bootstrap():
  Promise<GoogleSession | null> {
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  bootstrapPromise =
    readBffSession()
      .then((session) => {
        current =
          session
            ? safeSession(session)
            : null;

        return current;
      })
      .catch(() => {
        current = null;
        return null;
      });

  return bootstrapPromise;
}

function ok<T>(
  data: T,
): Result<T> {
  return {
    data,
    error: null,
  };
}

function fail<T>(
  empty: T,
  error: unknown,
): Result<T> {
  return {
    data: empty,
    error: {
      message:
        error instanceof Error
          ? error.message
          : "Something went wrong",
      status:
        (
          error as {
            status?: number;
          }
        )?.status,
    },
  };
}

export const googleAuth = {
  async signInWithPassword(
    {
      email,
      password,
    }: {
      email: string;
      password: string;
    },
  ) {
    try {
      const session =
        safeSession(
          await startBffSession(
            email,
            password,
          ),
        );

      adopt(
        session,
        "SIGNED_IN",
      );

      return ok({
        user: session.user,
        session,
      });
    } catch (error) {
      return fail(
        {
          user: null,
          session: null,
        },
        error,
      );
    }
  },

  async signUp(
    {
      email,
      password,
      options,
    }: {
      email: string;
      password: string;
      options?: {
        data?: Record<
          string,
          unknown
        >;
        emailRedirectTo?: string;
      };
    },
  ) {
    try {
      const data =
        options?.data ?? {};

      const fullName =
        typeof data.full_name ===
            "string" &&
          data.full_name.trim()
          ? data.full_name.trim()
          : email.split("@")[0];

      const requestedType =
        typeof data.account_type ===
          "string"
          ? data.account_type
          : "student";

      const accountType =
        [
          "student",
          "college_admin",
          "startup",
        ].includes(requestedType)
          ? requestedType
          : "student";

      const session =
        safeSession(
          await signupBffSession({
            email,
            password,
            full_name: fullName,
            account_type:
              accountType,
          }),
        );

      adopt(
        session,
        "SIGNED_IN",
      );

      return ok({
        user: session.user,
        session,
      });
    } catch (error) {
      return fail(
        {
          user: null,
          session: null,
        },
        error,
      );
    }
  },

  async signOut(
    _options?: {
      scope?: string;
    },
  ) {
    let logoutError:
      unknown = null;

    try {
      await endBffSession();
    } catch (error) {
      logoutError = error;
    }

    adopt(
      null,
      "SIGNED_OUT",
    );

    return logoutError
      ? {
          error: {
            message:
              logoutError instanceof Error
                ? logoutError.message
                : "Could not complete logout",
          },
        }
      : {
          error: null,
        };
  },

  async getSession() {
    try {
      const session =
        current ??
        await bootstrap();

      return ok({
        session,
      });
    } catch (error) {
      return fail(
        {
          session: null,
        },
        error,
      );
    }
  },

  async getUser() {
    try {
      const session =
        current ??
        await bootstrap();

      return ok({
        user:
          session?.user ??
          null,
      });
    } catch (error) {
      return fail(
        {
          user: null,
        },
        error,
      );
    }
  },

  async refreshSession() {
    try {
      const serverSession =
        await readBffSession();

      if (!serverSession) {
        adopt(
          null,
          "TOKEN_REFRESHED",
        );

        return fail(
          {
            user: null,
            session: null,
          },
          new Error(
            "Your session has expired",
          ),
        );
      }

      const session =
        safeSession(
          serverSession,
        );

      adopt(
        session,
        "TOKEN_REFRESHED",
      );

      return ok({
        user: session.user,
        session,
      });
    } catch (error) {
      adopt(
        null,
        "TOKEN_REFRESHED",
      );

      return fail(
        {
          user: null,
          session: null,
        },
        error,
      );
    }
  },

  async setSession(
    _legacySession: unknown,
  ) {
    return fail(
      {
        user: null,
        session: null,
      },
      new Error(
        "Browser token sessions are no longer supported",
      ),
    );
  },

  async updateUser(
    {
      password,
      email,
      data,
    }: {
      password?: string;
      email?: string;
      data?: Record<
        string,
        unknown
      >;
    },
  ) {
    try {
      const existing =
        current ??
        await bootstrap();

      if (!existing) {
        throw new Error(
          "You need to be signed in to do that",
        );
      }

      const updated =
        await updateBffUser({
          ...(password
            ? { password }
            : {}),
          ...(email
            ? { email }
            : {}),
          ...(data
            ? { data }
            : {}),
        });

      const next: GoogleSession = {
        ...existing,
        user:
          safeUser(updated),
      };

      adopt(
        next,
        "USER_UPDATED",
      );

      return ok({
        user: next.user,
      });
    } catch (error) {
      return fail(
        {
          user: null,
        },
        error,
      );
    }
  },

  async resetPasswordForEmail(
    email: string,
    _options?: {
      redirectTo?: string;
    },
  ) {
    try {
      await requestBffPasswordReset(
        email,
      );

      return ok({});
    } catch (error) {
      return fail(
        {},
        error,
      );
    }
  },

  async resend(
    {
      type,
      options,
    }: {
      email: string;
      type: string;
      options?: {
        emailRedirectTo?: string;
      };
    },
  ) {
    try {
      if (type !== "signup") {
        throw new Error(
          "Unsupported email action",
        );
      }

      const session =
        current ??
        await bootstrap();

      const role =
        typeof session
          ?.user
          .user_metadata
          ?.account_type ===
            "string"
          ? String(
              session
                .user
                .user_metadata
                .account_type,
            )
          : "student";

      await resendBffVerification(
        role,
      );

      return ok({});
    } catch (error) {
      return fail(
        {},
        error,
      );
    }
  },

  async signInWithOtp(
    _args: {
      email: string;
      options?: {
        emailRedirectTo?: string;
      };
    },
  ) {
    return fail(
      {
        user: null,
        session: null,
      },
      new Error(
        "Email-link sign-in is not enabled. Please use your email and password",
      ),
    );
  },

  async signInWithOAuth(
    args: {
      provider: string;
      options?: {
        redirectTo?: string;
      };
    },
  ) {
    return fail(
      {
        provider:
          args.provider,
        url: null,
      },
      new Error(
        "Google sign-in is not switched on yet. Please use your email and password",
      ),
    );
  },

  onAuthStateChange(
    callback: Listener,
  ) {
    listeners.add(callback);

    void bootstrap()
      .then((session) => {
        if (
          listeners.has(
            callback,
          )
        ) {
          callback(
            "INITIAL_SESSION",
            session,
          );
        }
      });

    return {
      data: {
        subscription: {
          id:
            "prooflab-bff-session",
          callback,
          unsubscribe: () => {
            listeners.delete(
              callback,
            );
          },
        },
      },
    };
  },
};

/**
 * Dev-only browser harness seam.
 * Production authentication never calls this.
 */
export function __setSessionForTests(
  session: GoogleSession | null,
): void {
  if (!import.meta.env.DEV) {
    return;
  }

  adopt(
    session,
    session
      ? "SIGNED_IN"
      : "SIGNED_OUT",
  );
}
