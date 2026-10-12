// S41: the contract drift check must catch each kind of broken connection. OFFLINE.
//   node --test scripts/dev-tools/sidhu_s41_contract_drift.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { sqlState, judge, scan, bodyReferences, argTypes, KNOWN } from "./sidhu_s41_contract_drift.mjs";

const replay = (...files) => sqlState(files.map((_, i) => `m${i}`), (f) => files[Number(f.slice(1))]);
const env = (sql) => ({ ...replay(...sql), slugs: new Set(["level-open"]), api: [{ match: "/api/db", prefix: true }, { match: "/api/auth/login", prefix: false }], buckets: new Set(["resumes"]) });

test("grant replay: a new function is browser-callable; revoke closes it; a later grant reopens it", () => {
  const s = env([
    "create function public.a() returns void as $$ $$;",
    "revoke all on function public.a() from public, anon, authenticated; create or replace function public.b() returns int as $$ select 1 $$;",
    "revoke execute on function public.b() from public; grant execute on function public.b() to authenticated;",
  ]);
  assert.equal(judge({ kind: "rpc", name: "a" }, s), "BROWSER_FORBIDDEN");
  assert.equal(judge({ kind: "rpc", name: "b" }, s), "OK");
});

test("create or replace keeps a revoke; drop then create starts from the default again", () => {
  const s = env([
    "create function public.c() returns void as $$ $$; revoke all on function public.c() from public, authenticated;",
    "create or replace function public.c() returns void as $$ select 1 $$;",
    "drop function if exists public.d(); create function public.d() returns void as $$ $$; revoke all on function public.d() from authenticated; drop function public.d(); create function public.d() returns void as $$ $$;",
  ]);
  assert.equal(judge({ kind: "rpc", name: "c" }, s), "BROWSER_FORBIDDEN");
  assert.equal(judge({ kind: "rpc", name: "d" }, s), "OK");
});

test("missing, dropped and renamed objects; server callers need existence only", () => {
  const s = env([
    "create table public.t1 (id int); create table public.old (id int); alter table public.old rename to new_name;",
    "create function public.gone() returns void as $$ $$; drop function public.gone(); create function public.srv() returns void as $$ $$; revoke all on function public.srv() from public, authenticated;",
  ]);
  assert.equal(judge({ kind: "rpc", name: "never_made" }, s), "ENDPOINT_NOT_FOUND");
  assert.equal(judge({ kind: "rpc", name: "gone" }, s), "ENDPOINT_DROPPED");
  assert.equal(judge({ kind: "table", name: "old" }, s), "ENDPOINT_DROPPED");
  assert.equal(judge({ kind: "table", name: "new_name" }, s), "OK");
  assert.equal(judge({ kind: "server-rpc", name: "srv" }, s), "OK");
  assert.equal(judge({ kind: "server-rpc", name: "gone" }, s), "ENDPOINT_DROPPED");
});

test("a table in another schema (auth.users) is not read as a public table called auth", () => {
  const s = env(["create table auth.users (id uuid); create table if not exists auth.sessions (id uuid); create table public.real_one (id int); create table plain (id int);"]);
  assert.equal(s.table.has("if"), false, "'create table if not exists auth.x' is not a table called 'if'");
  assert.equal(s.table.has("auth"), false);
  assert.deepEqual([...s.table.keys()].filter((k) => "auth.users".startsWith(k) || "users".startsWith(k)), [], "not even a prefix (the regex used to backtrack to 'aut')");
  assert.equal(judge({ kind: "table", name: "real_one" }, s), "OK");
  assert.equal(judge({ kind: "table", name: "plain" }, s), "OK");
});

test("overloads: dropping the old signature after creating the new one keeps the function (stage 37 generate_round_robin)", () => {
  assert.equal(argTypes("_season_id uuid, _force boolean default false, _from_round integer default 1"), "uuid,boolean,integer");
  assert.equal(argTypes("uuid, boolean"), "uuid,boolean");
  assert.equal(argTypes("_at timestamp with time zone, _n int"), "timestamp with time zone,integer");
  const s = env([
    "create function public.rr(_s uuid, _f boolean default false) returns int as $$ select 1 $$;",
    "create or replace function public.rr(_s uuid, _f boolean default false, _r integer default 1) returns int as $$ select 1 $$; drop function if exists public.rr(uuid, boolean);",
    "create function public.gone_all(_a int) returns int as $$ select 1 $$; drop function public.gone_all;",
  ]);
  assert.equal(judge({ kind: "server-rpc", name: "rr" }, s), "OK");
  assert.equal(judge({ kind: "server-rpc", name: "gone_all" }, s), "ENDPOINT_DROPPED");
});

test("a renamed function exists under its new name only; a type is not a missing table", () => {
  const s = env([
    "create type public.app_role as enum ('student'); create function public.old_name(_u uuid) returns int as $$ select 1 $$;",
    "alter function public.old_name(uuid) rename to new_name; create function public.uses(_u uuid) returns int as $$ select public.new_name(_u) + ('student'::public.app_role = 'student')::int $$;",
  ]);
  assert.equal(judge({ kind: "server-rpc", name: "old_name" }, s), "ENDPOINT_DROPPED");
  assert.equal(judge({ kind: "server-rpc", name: "new_name" }, s), "OK");
  assert.deepEqual(bodyReferences(s), []);
});

test("a function body that calls a dropped function or reads a dropped table is found", () => {
  const s = env(["create table public.t (id int); create function public.f() returns int as $$ select 1 $$;",
    "create function public.uses_both() returns int as $$ begin perform public.f(); return (select count(*) from public.t); end $$ language plpgsql;",
    "drop function public.f(); drop table public.t;"]);
  assert.deepEqual(bodyReferences(s).map((r) => `${r.status} ${r.name}`).sort(), ["ENDPOINT_DROPPED f", "ENDPOINT_DROPPED t"]);
});

test("the real repository: no function body references a missing object, except the two reviewed ones", () => {
  const refs = bodyReferences(sqlState()).filter((r) => !KNOWN[`${r.in}->${r.name}`]);
  assert.deepEqual([...new Set(refs.map((r) => `${r.status} ${r.in} -> ${r.name}`))], []);
});

test("functions, buckets and gateway routes", () => {
  const s = env([""]);
  assert.equal(judge({ kind: "function", name: "level-open" }, s), "OK");
  assert.equal(judge({ kind: "function", name: "no-such-fn" }, s), "FUNCTION_NOT_ROUTED");
  assert.equal(judge({ kind: "storage", name: "proofs" }, s), "BUCKET_NOT_SERVED");
  assert.equal(judge({ kind: "api", name: "/api/db/x" }, s), "OK");
  assert.equal(judge({ kind: "api", name: "/api/auth/login/x" }, s), "API_NOT_ROUTED");
});

test("the real repository: every frontend and server call is connected (regression for S41 migration 111)", () => {
  const { endpoints } = scan();
  const broken = endpoints.filter((e) => !["OK", "DYNAMIC"].includes(e.status));
  assert.deepEqual(broken.map((e) => `${e.status} ${e.kind}:${e.name}`), []);
  assert.ok(endpoints.some((e) => e.name === "complete_own_wizard" && e.status === "OK"));
  assert.ok(endpoints.filter((e) => e.kind === "server-rpc").length >= 30, "server-side callers are scanned too");
});
