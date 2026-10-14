import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { deleteMyAccount } from "./deleteMyAccount.ts";

// Request rules only: the accounts service and the database are not called here.
const ME = "11111111-1111-1111-1111-111111111111";
const realFetch = globalThis.fetch;
let calls: [string, RequestInit][] = [];

const answerWith = (status: number, body: unknown) => {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push([String(input), init ?? {}]);
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
};

afterEach(() => { globalThis.fetch = realFetch; });

test("nothing is sent until the word is typed exactly", async () => {
  answerWith(200, { removed: 1 });
  await assert.rejects(deleteMyAccount(ME, "delete"), /Type DELETE/);
  assert.equal(calls.length, 0);
});

test("only the caller is named, with the confirmation, on the same origin", async () => {
  answerWith(200, { removed: 1 });
  assert.deepEqual(await deleteMyAccount(ME, "DELETE"), { loginDeleted: false });
  const [url, init] = calls[0];
  assert.equal(url, "/api/accounts/remove");
  assert.equal(init.method, "POST");
  assert.equal(init.credentials, "same-origin");
  assert.deepEqual(JSON.parse(String(init.body)), { student_ids: [ME], confirm: "DELETE" });
});

test("a login that is only locked, not deleted, is never reported as fully done", async () => {
  answerWith(200, { removed: 1, login_deleted: false });
  assert.deepEqual(await deleteMyAccount(ME, "DELETE"), { loginDeleted: false });
  answerWith(200, { removed: 1, login_deleted: true });
  assert.deepEqual(await deleteMyAccount(ME, "DELETE"), { loginDeleted: true });
});

test("a refusal, or an answer that removed nothing, is a failure", async () => {
  answerWith(403, { error: "Only a college or an administrator can remove students." });
  await assert.rejects(deleteMyAccount(ME, "DELETE"), /Only a college/);
  answerWith(200, { removed: 0 });
  await assert.rejects(deleteMyAccount(ME, "DELETE"), /was not deleted/);
});
