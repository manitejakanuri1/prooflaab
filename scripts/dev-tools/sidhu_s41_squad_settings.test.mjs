// S41: college write actions that had no test: section (cohort) assignment from the imported file (tpo_set_cohorts,
// stage 52), squad settings (tpo_squad_update, stage 24) and the two resets (stage 40 / 41). OFFLINE on PostgreSQL 16
// (PGlite) with the DEPLOYED bodies; migration 113 (if present) is applied on top for the "after" tests.
//   PGLITE_MODULE=file:///.../pglite/dist/index.js node --test scripts/dev-tools/sidhu_s41_squad_settings.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { ID, FIXTURE, M108, read, students, squad } from "./sidhu_s39_squad_fixture.mjs";

let PGlite = null;
try { ({ PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite")); } catch { /* skipped */ }
const skip = PGlite ? false : "PGlite not installed (set PGLITE_MODULE)";

const cut = (file, start, end) => { const t = read(file); const a = t.indexOf(start); const b = t.indexOf(end, a); if (a < 0 || b < 0) throw new Error(`${start} not in ${file}`); return t.slice(a, b + end.length); };
const S24 = "supabase/migrations/20260823000000_stage24_fill_the_four_sections.sql";
const DEPLOYED = [
  cut("supabase/migrations/20260924000000_stage52_cohorts_from_the_csv.sql", "create or replace function public.tpo_set_cohorts(", "end $function$;"),
  cut(S24, "create or replace function public.tpo_squad_update(", "end $fn$;"),
  cut("supabase/migrations/20260912000000_stage40_scoring_weights_configurable.sql", "create function public.tpo_reset_scoring_weight(", "end $$;"),
  cut("supabase/migrations/20260913000000_stage41_naming_themes_and_branch_picker.sql", "create function public.tpo_reset_naming_theme(", "end $$;"),
].join("\n");
const M113 = (() => { try { return read("migration/113-squad-settings-validation.sql"); } catch { return ""; } })();
const no113 = !M113 && "migration 113 not written yet";

const EXTRA = `
create table public.student_contact (student_id uuid primary key references public.student_profiles(id), email text);
create table public.squad_scoring_rules (metric text, points integer, college_id uuid);
grant execute on function public.write_audit(text, text, uuid, jsonb, jsonb, uuid) to authenticated;`;

async function database({ with113 = false } = {}) {
  const d = new PGlite();
  await d.exec(FIXTURE); await d.exec(M108); await d.exec(EXTRA); await d.exec(DEPLOYED);
  if (with113) await d.exec(M113);
  return d;
}
async function as(d, user, sql) {
  await d.exec(`set role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ sub: user ?? "" })}', false);`);
  try { return await d.query(sql); } finally { await d.exec("reset role; select set_config('request.jwt.claims', '', false);"); }
}
const one = async (d, sql) => Object.values((await d.query(sql)).rows[0] ?? { v: null })[0];
const seed = async (d, ...p) => { for (const x of p) if (x.sql) await d.exec(x.sql); };
const update = (id, args) => `select public.tpo_squad_update('${id}', ${args}) as r`;

// ---------------------------------------------------------------- import: sections from the file
test("set cohorts: matched by email (any case), own college only, blank ignored, audited", { skip }, async () => {
  const d = await database();
  const a = students(ID.A, "CSE", 2); const b = students(ID.B, "CSE", 1);
  await seed(d, a, b);
  await d.exec(`insert into public.student_contact values ('${a.ids[0]}', 'One@College.test'), ('${a.ids[1]}', 'two@college.test'), ('${b.ids[0]}', 'other@college.test');`);
  const out = (await as(d, ID.TPO_A, `select public.tpo_set_cohorts('[{"email":" one@college.TEST ","cohort":"CSE-A"},{"email":"two@college.test","cohort":"  "},{"email":"other@college.test","cohort":"CSE-Z"}]'::jsonb) as r`)).rows[0].r;
  assert.equal(out.students, 1, "only the own-college student with a real section");
  assert.equal(await one(d, `select cohort from public.student_profiles where id = '${a.ids[0]}'`), "CSE-A");
  assert.equal(await one(d, `select cohort from public.student_profiles where id = '${a.ids[1]}'`), "CSE", "a blank section changes nothing");
  assert.equal(await one(d, `select cohort from public.student_profiles where id = '${b.ids[0]}'`), "CSE", "another college's student is untouched");
  assert.equal(await one(d, `select count(*)::int from public.audit_log where action = 'COHORTS_SET'`), 1);
  await assert.rejects(as(d, null, `select public.tpo_set_cohorts('[]'::jsonb)`), /only a college/);
});

// ---------------------------------------------------------------- squad settings
test("squad update: rename, lock, archive and back, seat limit; audited; another college refused", { skip }, async () => {
  const d = await database();
  const m = students(ID.A, "CSE-A", 3); const s = squad(ID.A, ID.SA, "CSE-A", m.ids, { name: "Titans 1" });
  await seed(d, m, s);
  assert.deepEqual((await as(d, ID.TPO_A, update(s.id, "_name => 'Kings', _max_members => 11, _is_locked => true"))).rows[0].r,
    { ok: true, name: "Kings", max_members: 11, is_locked: true, archived: false });
  assert.equal((await as(d, ID.TPO_A, update(s.id, "_archived => true"))).rows[0].r.archived, true);
  assert.equal((await as(d, ID.TPO_A, update(s.id, "_archived => false"))).rows[0].r.archived, false);
  await assert.rejects(as(d, ID.TPO_A, update(s.id, "_max_members => 2")), /already has 3 members/);
  await assert.rejects(as(d, ID.TPO_B, update(s.id, "_name => 'Mine now'")), /belongs to another college/);
  assert.equal(await one(d, `select name from public.squads where id = '${s.id}'`), "Kings");
  assert.equal(await one(d, `select count(*)::int from public.audit_log where action = 'SQUAD_UPDATED'`), 3);
});

test("DEPLOYED gaps: an empty squad can be set to 0 seats, and renamed to another squad's name in the same season", { skip }, async () => {
  const d = await database();
  const a = squad(ID.A, ID.SA, "CSE-A", [], { name: "Titans 1" }); const b = squad(ID.A, ID.SA, "CSE-A", [], { name: "Titans 2" });
  await seed(d, a, b);
  assert.equal((await as(d, ID.TPO_A, update(a.id, "_max_members => 0"))).rows[0].r.max_members, 0, "a squad nobody can ever join");
  assert.equal((await as(d, ID.TPO_A, update(b.id, "_name => 'titans 1'"))).rows[0].r.name, "titans 1", "two squads named alike");
});

test("FIXED (113): at least one seat, and a squad name stays unique in its season (as create already requires)", { skip: skip || no113 }, async () => {
  const d = await database({ with113: true });
  const a = squad(ID.A, ID.SA, "CSE-A", [], { name: "Titans 1" }); const b = squad(ID.A, ID.SA, "CSE-A", [], { name: "Titans 2" });
  const old = squad(ID.A, ID.OLD, "CSE-A", [], { name: "Legends" });
  await seed(d, a, b, old);
  for (const seats of [0, -3]) await assert.rejects(as(d, ID.TPO_A, update(a.id, `_max_members => ${seats}`)), /at least one seat/);
  await assert.rejects(as(d, ID.TPO_A, update(b.id, "_name => ' TITANS 1 '")), /already a squad called/);
  assert.equal((await as(d, ID.TPO_A, update(b.id, "_name => 'Legends'"))).rows[0].r.name, "Legends", "a name used in an OLD season is free");
  assert.equal((await as(d, ID.TPO_A, update(a.id, "_name => 'Titans 1', _max_members => 12"))).rows[0].r.max_members, 12, "keeping its own name is fine");
  await assert.rejects(as(d, ID.TPO_B, update(a.id, "_name => 'X'")), /belongs to another college/);
});

// ---------------------------------------------------------------- resets
test("resets remove only the caller college's override, never the defaults or another college's", { skip }, async () => {
  const d = await database();
  await d.exec(`insert into public.squad_name_themes (branch, theme, college_id) values ('CSE', 'Titans', null), ('CSE', 'Lions', '${ID.A}'), ('CSE', 'Bears', '${ID.B}');
    insert into public.squad_scoring_rules values ('lot_passed', 10, null), ('lot_passed', 25, '${ID.A}'), ('lot_passed', 30, '${ID.B}');`);
  await as(d, ID.TPO_A, `select public.tpo_reset_naming_theme('CSE')`);
  await as(d, ID.TPO_A, `select public.tpo_reset_scoring_weight('lot_passed')`);
  assert.deepEqual((await d.query(`select theme from public.squad_name_themes order by theme`)).rows.map((r) => r.theme), ["Bears", "Titans"]);
  assert.deepEqual((await d.query(`select points from public.squad_scoring_rules order by points`)).rows.map((r) => r.points), [10, 30]);
  await assert.rejects(as(d, null, `select public.tpo_reset_naming_theme('CSE')`), /Only a college/);
  await assert.rejects(as(d, null, `select public.tpo_reset_scoring_weight('lot_passed')`), /Only a college/);
});
