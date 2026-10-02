/**
 * Constant-time comparison of a presented shared secret with the expected one.
 *
 * `!==` stops at the first differing character, so response timing leaks how
 * much of a guess was right. Used wherever a shared secret still guards an
 * endpoint (scheduler webhooks) until those move to OIDC.
 */
export function secretMatches(given: string | null | undefined, expected: string | null | undefined): boolean {
  if (!given || !expected) return false;
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  // Length is compared at the end so the loop runs the same for every guess of the same length.
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i % (a.length || 1)] ?? 0) ^ b[i];
  return diff === 0;
}
