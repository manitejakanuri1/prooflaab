// Security gate 14 Oct: field clamp and target-list validation for assign_tasks (pure parts of assign-scope.ts).
import { clampTask, MAX_TARGETS, targetIds } from "./assign-scope.ts";

function assert(ok: unknown, why: string): asserts ok {
  if (!ok) throw new Error(why);
}
const ID = "00000000-0000-4000-8000-000000000001";

Deno.test("clampTask: a college cannot choose XP, visibility or approval", () => {
  const out = clampTask({ admin: false, collegeId: "c1" }, { xp_reward: 100000, visibility: "public", approved_by_admin: true });
  assert(out.xp_reward === 0 && out.visibility === "private" && out.approved_by_admin === false, JSON.stringify(out));
});

Deno.test("clampTask control: an admin's fields are kept as sent", () => {
  const sent = { xp_reward: 150, visibility: "public" };
  assert(clampTask({ admin: true, collegeId: null }, sent) === sent, "admin fields changed");
});

Deno.test("targetIds: de-duplicates (case-insensitive) and accepts empty / missing", () => {
  assert(targetIds([ID, ID.toUpperCase()]).length === 1, "duplicate kept");
  assert(targetIds(undefined).length === 0 && targetIds([]).length === 0, "empty refused");
});

Deno.test("targetIds: refuses a non-list, a non-uuid and an oversized list", () => {
  for (const bad of ["x", [1], ["x'; drop table"], Array(MAX_TARGETS + 1).fill(ID)]) {
    let threw = false;
    try { targetIds(bad); } catch (e) { threw = /required/.test(String(e)); }
    assert(threw, `accepted ${JSON.stringify(bad).slice(0, 60)}`);
  }
});
