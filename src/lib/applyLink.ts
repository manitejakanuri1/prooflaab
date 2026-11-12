// Students are never sent outside the app, except the Apply button on a job (owner, 12 Nov 2026).
// Same rule as student_jobs() in migration 310: only a plain https:// link with a real host name.
const HTTPS_LINK = /^https:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:[0-9]{1,5})?([/?#]\S*)?$/;

/** The host to name in "You're leaving ProofLab to apply on <host>", or null when the link may not be opened. */
export function applyHost(link: string | null | undefined): string | null {
  if (!link || !HTTPS_LINK.test(link)) return null;
  try {
    const url = new URL(link);
    return url.protocol === "https:" ? url.hostname : null;
  } catch {
    return null;
  }
}
