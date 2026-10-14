/**
 * Accept only normal web URLs for links that come from database/user content.
 * javascript:, data:, file:, blob: and malformed values are refused.
 */
export function safeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Open an untrusted external URL without giving the new page access to
 * window.opener.
 */
export function openExternal(value: string | null | undefined): boolean {
  const url = safeExternalUrl(value);
  if (!url) return false;

  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

/**
 * Notification links are app navigation, not arbitrary web destinations.
 * Only same-origin absolute paths are accepted.
 */
export function safeInternalPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;

  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
