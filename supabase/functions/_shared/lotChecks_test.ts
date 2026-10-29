import { assert, assertEquals } from "jsr:@std/assert@1";
import { afterCheck, checkRefusal, hiddenHint } from "./lotChecks.ts";

Deno.test("checkRefusal: only Daily Lots are limited", () => {
  assertEquals(checkRefusal(null), null);
  assertEquals(checkRefusal({ daily: false }), null);
  assertEquals(checkRefusal({ daily: true, submitted: false, checks_left: 1 }), null);
  assert(checkRefusal({ daily: true, submitted: false, checks_left: 0 })?.includes("No checks left"));
  assert(checkRefusal({ daily: true, submitted: true, checks_left: 2 })?.includes("already submitted"));
});

Deno.test("afterCheck: the last check submits the best one; earlier checks do not", async () => {
  const calls: string[] = [];
  let left = 1;
  const db = {
    rpc: (fn: string) => {
      calls.push(fn);
      if (fn === "lot_state") return Promise.resolve({ data: { daily: true, submitted: false, checks_left: left }, error: null });
      return Promise.resolve({ data: { daily: true, submitted: true, checks_left: 0 }, error: null });
    },
  };
  assertEquals((await afterCheck(db, "s", "t"))?.submitted, false);
  assertEquals(calls, ["lot_state"]);
  left = 0;
  assertEquals((await afterCheck(db, "s", "t"))?.submitted, true);
  assertEquals(calls, ["lot_state", "lot_state", "lot_submit"]);
});

Deno.test("strict coding Lot (week 2 on): unlimited checks, never auto-submitted", async () => {
  const strict = { daily: true, mode: "strict", kind: "coding", submitted: false, checks_left: null };
  assertEquals(checkRefusal(strict as never), null);
  const calls: string[] = [];
  const db = { rpc: (fn: string) => { calls.push(fn); return Promise.resolve({ data: strict, error: null }); } };
  await afterCheck(db, "s", "t");
  assertEquals(calls, ["lot_state"]);
});

Deno.test("hiddenHint: from the 2nd failed strict check, one failed hidden test per check, in turn", () => {
  const rows = [
    { visible: true, passed: false, stdin: "v", expected: "1", actual: "2", stderr: "" },
    { visible: false, passed: true, stdin: "h1", expected: "a", actual: "a", stderr: "" },
    { visible: false, passed: false, stdin: "h2", expected: "b", actual: "x", stderr: "" },
    { visible: false, passed: false, stdin: "h3", expected: "c", actual: "y", stderr: "" },
  ];
  const lot = (used: number, extra = {}) => ({ daily: true, mode: "strict", kind: "coding", submitted: false, checks_used: used, ...extra });
  assertEquals(hiddenHint(rows, lot(1)), null);
  assertEquals(hiddenHint(rows, lot(2))?.input, "h2");
  assertEquals(hiddenHint(rows, lot(3))?.input, "h3");
  assertEquals(hiddenHint(rows, lot(4))?.input, "h2");
  assertEquals(hiddenHint(rows, lot(2, { mode: "graded" })), null);
  assertEquals(hiddenHint(rows, lot(2, { submitted: true })), null);
  assertEquals(hiddenHint(rows.slice(0, 2), lot(2)), null);
});
