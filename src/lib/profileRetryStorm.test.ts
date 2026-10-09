import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { QueryClient, QueryObserver } from "@tanstack/react-query";

/*
 * Student profile retry storm (Sidhu S28: 34 requests in 15 s on Floor, 33 on
 * Squad, during a backend outage).
 *
 * The dashboard shows a spinner while the profile loads, which unmounts every
 * screen under it. When the profile fetch failed, the screens mounted again;
 * each mount retried the failed query; the query went back to "loading"; the
 * spinner unmounted them; round again, for as long as the backend was down.
 *
 * This models exactly that with the query library the app uses and no browser:
 * one observer for the dashboard, and child observers that are mounted while
 * it is not loading and unmounted while it is.
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function dashboard(
  options: { retryOnMount?: boolean },
  queryFn: () => Promise<unknown>,
  ms = 250,
) {
  // The app's defaults (App.tsx), with the retry delay shortened so 250 ms
  // here stands for a long outage.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: 1, retryDelay: 1, staleTime: 60_000 } },
  });
  const query = { queryKey: ["student-profile"], queryFn, ...options };

  const page = new QueryObserver(client, query);
  let children: Array<() => void> = [];

  const render = (loading: boolean) => {
    if (loading) {
      children.forEach((unmount) => unmount());
      children = [];
    } else if (children.length === 0) {
      // Floor mounts three components that read the profile.
      children = [1, 2, 3].map(() => new QueryObserver(client, query).subscribe(() => {}));
    }
  };

  const unmountPage = page.subscribe((result) => render(result.isLoading));
  render(page.getCurrentResult().isLoading);

  await sleep(ms);

  const result = page.getCurrentResult();
  const stop = () => {
    children.forEach((unmount) => unmount());
    unmountPage();
    client.clear();
  };

  return { client, page, result, stop };
}

const failures: Array<[string, unknown]> = [
  ["401", Object.assign(new Error("not authenticated"), { status: 401 })],
  ["403", Object.assign(new Error("permission denied"), { code: "42501", status: 403 })],
  ["500", Object.assign(new Error("server error"), { status: 500 })],
  ["network", new TypeError("Failed to fetch")],
];

test("reproduction: without the fix a failing profile is fetched in a loop", async () => {
  let calls = 0;
  const run = await dashboard({}, async () => {
    calls++;
    throw new Error("server error");
  });
  run.stop();

  assert.ok(calls > 10, `expected a storm, saw ${calls} requests`);
});

for (const [name, error] of failures) {
  test(`a ${name} failure is tried once, retried once, and then left alone`, async () => {
    let calls = 0;
    const run = await dashboard({ retryOnMount: false }, async () => {
      calls++;
      throw error;
    });

    assert.equal(calls, 2, "one request and the one configured retry");
    assert.equal(run.result.isLoading, false, "the spinner must end");
    assert.equal(run.result.isError, true, "the failure must be reported, not hidden");
    assert.equal(run.result.error, error);
    assert.equal(run.result.data, undefined, "no profile is invented");
    run.stop();
  });
}

test("a successful load is one request and the profile is shared", async () => {
  let calls = 0;
  const run = await dashboard({ retryOnMount: false }, async () => {
    calls++;
    return { id: "p1", full_name: "Asha K" };
  });

  assert.equal(calls, 1);
  assert.equal(run.result.isSuccess, true);
  assert.deepEqual(run.result.data, { id: "p1", full_name: "Asha K" });
  run.stop();
});

test("Try again recovers once the backend is back", async () => {
  let calls = 0;
  let down = true;
  const run = await dashboard({ retryOnMount: false }, async () => {
    calls++;
    if (down) throw new Error("server error");
    return { id: "p1" };
  });

  assert.equal(run.result.isError, true);

  // refreshProfile() in useStudentProfile.tsx does exactly this.
  down = false;
  await run.client.invalidateQueries({ queryKey: ["student-profile"] });

  assert.equal(calls, 3, "one more request, not a loop");
  assert.deepEqual(run.page.getCurrentResult().data, { id: "p1" });
  run.stop();
});

test("Try again during the outage is one more attempt, then stops again", async () => {
  let calls = 0;
  const run = await dashboard({ retryOnMount: false }, async () => {
    calls++;
    throw new Error("server error");
  });

  await run.client.invalidateQueries({ queryKey: ["student-profile"] }).catch(() => {});
  await sleep(150);

  assert.equal(calls, 4, "the second attempt and its one retry");
  assert.equal(run.page.getCurrentResult().isError, true);
  run.stop();
});

test("the app is wired this way", () => {
  const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const hook = source("hooks/useStudentProfile.tsx");
  const page = source("pages/StudentDashboard.tsx");

  assert.match(hook, /queryFn: fetchProfile,[\s\S]*?retryOnMount: false,/, "the profile query must not retry on mount");
  assert.match(hook, /error: profileQuery\.error \?/, "the hook reports the failure");
  // The dashboard shows the failure with a way to retry, instead of rendering
  // Floor / Build-log / Squad / Profile with no profile.
  assert.match(page, /if \(profileError && !profile\) \{[\s\S]*?role="alert"[\s\S]*?onClick=\{refreshProfile\}/);
  assert.ok(
    page.indexOf("if (profileError && !profile)") < page.indexOf("<StudentDashboardContent"),
    "the failure is checked before any destination renders",
  );
});
