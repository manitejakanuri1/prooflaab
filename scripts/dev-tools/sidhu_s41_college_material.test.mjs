// S41: College -> Post source material (college_submit_source_content, stage 60) had no test. OFFLINE on
// PostgreSQL 16 (PGlite) with the DEPLOYED body.
//   PGLITE_MODULE=file:///.../pglite/dist/index.js node --test scripts/dev-tools/sidhu_s41_college_material.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { read } from "./sidhu_s39_squad_fixture.mjs";

let PGlite = null;
try { ({ PGlite } = await import(process.env.PGLITE_MODULE ?? "@electric-sql/pglite")); } catch { /* skipped */ }
const skip = PGlite ? false : "PGlite not installed (set PGLITE_MODULE)";

const S60 = read("supabase/migrations/20261001000200_stage60_wire_source_content_and_college_submissions.sql").replace(/\r\n/g, "\n");
const BODY = S60.slice(S60.indexOf("create or replace function public.college_submit_source_content("), S60.indexOf("end;\n$function$;", S60.indexOf("create or replace function public.college_submit_source_content(")) + "end;\n$function$;".length);
const TPO = "00000000-0000-4000-8000-00000000a0a1", COLLEGE = "00000000-0000-4000-8000-00000000c0a1", STUDENT = "00000000-0000-4000-8000-0000000005a1";
const FIXTURE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $f$;
grant usage on schema auth, public to anon, authenticated, service_role;
create table public.colleges (id uuid primary key, user_id uuid);
create table public.source_registry (id uuid primary key default gen_random_uuid(), domain text);
create table public.source_content (id uuid primary key default gen_random_uuid(), source_id uuid, url text, canonical_url text, title text,
  markdown text, content_hash text, fetch_method text, rights_flag text, submitted_by_college_id uuid);
${BODY}
revoke all on function public.college_submit_source_content(text, text) from public, anon;
grant execute on function public.college_submit_source_content(text, text) to authenticated;
insert into public.colleges values ('${COLLEGE}', '${TPO}');
insert into public.source_registry (domain) values ('college-submitted');`;

async function db() { const d = new PGlite(); await d.exec(FIXTURE); return d; }
async function as(d, sub, sql) {
  await d.exec(`set role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ sub: sub ?? "" })}', false);`);
  try { return await d.query(sql); } finally { await d.exec("reset role; select set_config('request.jwt.claims', '', false);"); }
}
const one = async (d, sql) => Object.values((await d.query(sql)).rows[0] ?? { v: null })[0];
const TEXT = "Binary search halves the search range at every step. ".repeat(3);
const submit = (title, content = TEXT) => `select public.college_submit_source_content(${title === null ? "null" : `'${title}'`}, '${content}') as id`;

test("a college's material is stored, trimmed, hashed, marked as its own and original-only", { skip }, async () => {
  const d = await db();
  const id = (await as(d, TPO, submit("  Binary search  "))).rows[0].id;
  assert.ok(id);
  assert.deepEqual((await d.query(`select title, submitted_by_college_id::text as by, rights_flag, fetch_method, length(content_hash) as h, url like 'college-submission:%' as u from public.source_content`)).rows[0],
    { title: "Binary search", by: COLLEGE, rights_flag: "ORIGINAL_ONLY", fetch_method: "manual", h: 64, u: true });
});

test("too short / too long title or text, a student, signed out: refused, nothing stored", { skip }, async () => {
  const d = await db();
  await assert.rejects(as(d, TPO, submit("ab")), /Title must be 3-200/);
  await assert.rejects(as(d, TPO, submit("x".repeat(201))), /Title must be 3-200/);
  await assert.rejects(as(d, TPO, submit("Valid title", "too short")), /at least 80/);
  await assert.rejects(as(d, TPO, submit("Valid title", "y".repeat(5001))), /under 5000/);
  await assert.rejects(as(d, STUDENT, submit("Valid title")), /Only a signed-in college/);
  await assert.rejects(as(d, null, submit("Valid title")), /Only a signed-in college/);
  assert.equal(await one(d, `select count(*)::int from public.source_content`), 0);
});

test("KNOWN fragility: without the 'college-submitted' registry row the material is silently dropped (null, no error)", { skip }, async () => {
  // Stage 60 seeds that row and staging has it (read-only, 13 Oct 2026), and the screen only looks at `error`, so
  // this only bites a database where the seed is missing. Recorded so it is not a surprise.
  const d = await db();
  await d.exec(`delete from public.source_registry`);
  assert.equal((await as(d, TPO, submit("Binary search"))).rows[0].id, null);
  assert.equal(await one(d, `select count(*)::int from public.source_content`), 0);
});
