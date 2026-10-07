/**
 * Private browser file traffic goes only through the same-origin web BFF.
 *
 * The browser never sends an application bearer token. Authentication comes
 * from the opaque HttpOnly session cookie that JavaScript cannot read.
 */

function validBucket(bucket: string): boolean {
  return Boolean(bucket) &&
    bucket !== "." &&
    bucket !== ".." &&
    !bucket.includes("/") &&
    !bucket.includes("\\");
}

function validObjectPath(path: string): boolean {
  if (!path || path.includes("\\")) return false;

  return !path
    .split("/")
    .some((part) => part === "." || part === "..");
}

export function bffFileUrl(
  bucket: string,
  path: string,
): string {
  if (!validBucket(bucket)) {
    throw new Error("Invalid storage bucket");
  }

  if (!validObjectPath(path)) {
    throw new Error("Invalid storage path");
  }

  const encodedPath = path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");

  return `/api/files/${encodeURIComponent(bucket)}/${encodedPath}`;
}

export async function bffFileFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!url.startsWith("/api/files/")) {
    throw new Error("Private file request must use the BFF");
  }

  const headers = new Headers(init.headers);

  // Never allow browser-managed credentials to be manually forwarded.
  headers.delete("authorization");
  headers.delete("apikey");
  headers.delete("cookie");

  return fetch(url, {
    ...init,
    headers,
    credentials: "same-origin",
  });
}
