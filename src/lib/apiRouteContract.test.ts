import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/*
 * The website side of web-bff/routes.contract.json.
 *
 * The site reaches every backend through same-origin /api/** and nowhere else.
 * This reads the source: every /api address written in it must be one the
 * gateway routes, and no backend address may be read into the build.
 */
const SRC = fileURLToPath(new URL("..", import.meta.url));

const contract = JSON.parse(
  readFileSync(new URL("../../web-bff/routes.contract.json", import.meta.url), "utf8"),
) as { routes: Array<{ match: string; prefix?: boolean }> };

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) return sources(path);

    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = sources(SRC).map((path) => ({ path, text: readFileSync(path, "utf8") }));

test("every /api address in the website is routed by the gateway", () => {
  const routed = (address: string) =>
    contract.routes.some((route) =>
      route.prefix
        ? address === route.match || address.startsWith(route.match.replace(/\/?$/, "/")) ||
          address === route.match.replace(/\/$/, "")
        : address === route.match
    );

  const seen = new Set<string>();

  for (const { path, text } of files) {
    for (const [, address] of text.matchAll(/["'`](\/api\/[A-Za-z0-9_\/.-]*)/g)) {
      seen.add(address);
      assert.ok(routed(address), `${path} calls ${address}, which the gateway does not route`);
    }
  }

  // The scan must really have found the calls, or this test proves nothing.
  for (const expected of ["/api/auth/login", "/api/auth/session", "/api/db", "/api/functions/", "/api/files/"]) {
    assert.ok(seen.has(expected), `expected to find ${expected} in the website source`);
  }
});

test("the website reads no backend address at build time", () => {
  for (const { path, text } of files) {
    assert.equal(
      /import\.meta\.env\.VITE_[A-Z_]*_URL/.test(text),
      false,
      `${path} reads a backend address: the site must go through /api only`,
    );
    assert.equal(
      /https:\/\/[a-z0-9.-]+\.run\.app/.test(text),
      false,
      `${path} names a Cloud Run address`,
    );
  }
});
