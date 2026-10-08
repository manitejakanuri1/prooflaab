// Real sign-in for browser checks: the site's own form -> /api/auth/login -> HttpOnly session cookie.
//
// The website no longer reads a session from browser storage (sessions live in the BFF's HttpOnly
// `__session` cookie), so a check can only be signed in the way a person is. This replaces the old
// trick of planting a minted token under localStorage `prooflab.auth.google`, which the site ignores.
//
// Credentials come from the environment and are never printed:
//   E2E_<ROLE>_EMAIL / E2E_<ROLE>_PASSWORD      ROLE = ADMIN | TPO | COMPANY | STUDENT | ESTABLISHED
// They must be dedicated TEST logins that already exist for the environment being tested. This
// helper never creates, resets or changes a login.

/** Test login for a role, or a clear error naming the variables that are missing. */
export function credentialsFor(role) {
  const key = `E2E_${String(role).toUpperCase()}`;
  const email = process.env[`${key}_EMAIL`], password = process.env[`${key}_PASSWORD`];
  if (!email || !password) throw new Error(`set ${key}_EMAIL and ${key}_PASSWORD (a dedicated test login for this environment)`);
  return { email, password };
}

/** Signs `context` in through the real form. Throws unless the browser ends up with the HttpOnly cookie. */
export async function cookieSignIn(context, base, { email, password }) {
  const page = await context.newPage();
  try {
    await page.goto(`${base}/auth`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 30000 }).catch(() => {});
    const cookie = (await context.cookies(base)).find((c) => c.name === "__session");
    if (!cookie?.value) {
      const said = (await page.locator('[role="alert"]').first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 140);
      throw new Error(`sign-in did not produce a session cookie${said ? `: ${said}` : ""}`);
    }
    if (!cookie.httpOnly || !cookie.secure) throw new Error("session cookie is not HttpOnly + Secure");
    return new URL(page.url()).pathname;
  } finally {
    await page.close();
  }
}

/** Account id of the signed-in user, read from the BFF (the browser never holds a token to decode). */
export async function signedInUserId(context, base) {
  const res = await context.request.get(`${base}/api/auth/session`);
  return (await res.json().catch(() => null))?.session?.user?.id ?? null;
}
