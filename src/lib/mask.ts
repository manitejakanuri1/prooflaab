// F14 (E2E 12 Nov): admin screens show personal details masked by default; the full value sits behind
// "Show technical details". Pure helpers, no imports, so node --test can run them.

/** vikram@gmail.com -> v***@gmail.com */
export const maskEmail = (s: string) => s.replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, "$1***@$2");

/** 203.0.113.45 -> 203.0.113.*  ;  IPv6 keeps its first 3 groups. */
export const maskIp = (s: string) =>
  s.replace(/\b(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}\b/g, "$1.*")
   .replace(/\b([0-9a-f]{1,4}:[0-9a-f]{1,4}:[0-9a-f]{1,4}):[0-9a-f:]+/gi, "$1:*");

/** Any UUID -> its first 8 characters + "…". */
export const shortIds = (s: string) => s.replace(/\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "$1…");

/** Emails, IPs and UUIDs masked in one go. */
export const maskAll = (s: string | null | undefined) => (s ? shortIds(maskIp(maskEmail(s))) : s ?? "");

/** A short plain sentence for a raw browser/server error; unknown ones are masked and cut to 80 characters. */
export const plainError = (raw: string | null | undefined) => {
  const s = raw ?? "";
  if (/Failed to fetch dynamically imported module|Loading chunk|Importing a module script failed/i.test(s))
    return "A part of the page did not load (old version open or weak network)";
  if (/Failed to fetch|NetworkError|Load failed/i.test(s)) return "Network problem: the call did not reach the server";
  if (/Cannot read properties of (undefined|null)|is not a function|is undefined/i.test(s)) return "Page code error";
  if (/^HTTP (\d+)/.test(s)) {
    const code = Number(s.slice(5, 8));
    if (code === 401 || code === 403) return `Not allowed (HTTP ${code})`;
    if (code === 404) return "Not found (HTTP 404)";
    if (code === 429) return "Too many requests (HTTP 429)";
    if (code >= 500) return `Server error (HTTP ${code})`;
  }
  const m = maskAll(s);
  return m.length > 80 ? `${m.slice(0, 79)}…` : m;
};
