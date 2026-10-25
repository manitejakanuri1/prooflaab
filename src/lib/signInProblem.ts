// Sign-in problems in plain words (UX copy rules: no "failed", "wrong" or "invalid").

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String((error as { message?: unknown } | null)?.message ?? "");

/** One plain sentence per kind of problem. The server says "Invalid login credentials" for
 *  both a wrong password and an unknown email on purpose, so we cannot (and must not) tell them apart. */
export function signInProblem(error: unknown): string {
  const reason = messageOf(error);
  const lower = reason.toLowerCase();
  if (lower.includes("invalid login credentials")) return "That email and password do not match. Try again, or reset your password.";
  if (lower.includes("email not confirmed") || lower.includes("confirm your email")) return "Confirm your email first. The link is in your inbox.";
  if (lower.includes("too many") || lower.includes("rate limit")) return "Too many tries. Wait a minute, then try again.";
  if (error instanceof TypeError || lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("network")) {
    return "No connection. Check your internet and try again.";
  }
  return reason || "Sign-in did not go through. Try again in a moment.";
}
