import { assert, assertEquals } from "jsr:@std/assert@1";
import { afterCheck, checkRefusal } from "./lotChecks.ts";

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
