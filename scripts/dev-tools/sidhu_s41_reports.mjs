// S41: writes FULL_FUNCTIONALITY_MATRIX.csv and FULL_ENDPOINT_COVERAGE.json from the real inventory, the contract
// drift check and the recorded live results. Every row says how it was (or was not) tested; nothing signed-in is
// PASS until a signed-in run has produced it.
//
//   node scripts/dev-tools/sidhu_s41_reports.mjs --out docs/sidhu-qa/s41 [--live <matrix.json of a live run>]
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildInventory } from "./sidhu_s32_inventory.mjs";
import { planMatrix, RECIPES } from "./sidhu_s32_live_e2e.mjs";
import { scan } from "./sidhu_s41_contract_drift.mjs";
import { probes } from "./sidhu_s40_anon_api.mjs";

const SERVICE = (api) => /function\//.test(api) ? "prooflab-functions" : /storage\/|files\//.test(api) ? "prooflab-files"
  : /rpc\/|db\//.test(api) ? "PostgREST (prooflab-api)" : /accounts/.test(api) ? "prooflab-accounts" : api ? "web-bff" : "browser only";

/** One honest status per row. live: optional rows of a signed-in run keyed by role|control. */
export function statusOf(row, live) {
  const hit = live?.get(`${row.role}|${row.control}`);
  if (hit) return { result: hit.status.startsWith("PASS") ? "PASS" : hit.status, evidence: `live run: ${hit.liveResult ?? ""}`.slice(0, 160) };
  if (row.class === "DEAD") return { result: "NOT_IMPLEMENTED", evidence: "inventory: visible control with no handler (reviewed S41: deliberately disabled)" };
  const recipe = RECIPES.find((r) => r.role.includes(row.role) && r.matches?.test?.(row.control));
  const signedOut = row.class === "SCREEN" ? "signed-out redirect PASS on deployed staging 59235dd (S40 baseline); " : "";
  return { result: "BLOCKED", evidence: `${signedOut}signed-in run needs GitHub environment staging-e2e${recipe ? ` + fixtures for recipe ${recipe.id}` : ""}` };
}

export function matrixCsv(rows, endpoints, live = null) {
  const access = new Map(endpoints.map((e) => [`${e.kind === "rpc" ? "rpc" : e.kind === "table" ? "db" : e.kind}/${e.name}`, e.status]));
  const head = ["FEATURE", "ROLE", "UI_ACTION", "CLASS", "API", "AUTHORIZATION", "SERVICE", "DATABASE_OR_EXTERNAL", "EXPECTED_SIDE_EFFECT",
    "AUTOMATED_TEST", "EVIDENCE", "RESULT"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [head.join(",")];
  for (const r of rows) {
    const apis = String(r.api ?? "").split(/;\s*/).filter(Boolean);
    const auth = apis.length ? apis.map((a) => `${a}: ${access.get(a) === "OK" ? "source OK" : access.get(a) ?? "see coverage json"}`).join(" | ") : "n/a";
    const s = statusOf(r, live);
    const test = r.class === "SCREEN" ? "sidhu_s32_live_e2e.mjs (screen pass) + --anon baseline" : RECIPES.find((x) => x.role.includes(r.role) && x.matches?.test?.(r.control))
      ? `recipe ${RECIPES.find((x) => x.role.includes(r.role) && x.matches.test(r.control)).id}` : r.class === "SAFE" || r.class === "READ" ? "sidhu_s32_live_e2e.mjs auto-click" : "none yet (write without a recipe)";
    lines.push([r.page, r.role, r.control, r.class, r.api, auth, SERVICE(r.api), r.dbEffect, r.class === "WRITE" ? "row written / changed (see recipe)" : r.dbEffect === "read" ? "data shown" : "none",
      test, s.evidence, s.result].map(q).join(","));
  }
  return lines.join("\n");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const a = process.argv.slice(2); const val = (f) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
  const out = val("--out") ?? "docs/sidhu-qa/s41"; mkdirSync(out, { recursive: true });
  const livePath = val("--live");
  const live = livePath && existsSync(livePath) ? new Map(JSON.parse(readFileSync(livePath, "utf8")).rows.map((r) => [`${r.role}|${r.control}`, r])) : null;
  const inv = buildInventory();
  const rows = planMatrix(inv);
  const { endpoints } = scan();
  writeFileSync(join(out, "FULL_FUNCTIONALITY_MATRIX.csv"), matrixCsv(rows, endpoints, live));
  const counts = {}; for (const r of rows) { const s = statusOf(r, live).result; counts[s] = (counts[s] ?? 0) + 1; }
  writeFileSync(join(out, "FULL_ENDPOINT_COVERAGE.json"), JSON.stringify({
    generated: new Date().toISOString(),
    note: "STATIC = source check only. LIVE = really called on deployed staging. Nothing signed-in has run yet.",
    frontend_and_server_calls: { kind: "STATIC (sidhu_s41_contract_drift.mjs)", endpoints },
    gateway_routes_live: { kind: "LIVE signed-out (sidhu_s40_anon_api.mjs, staging 59235dd, 13 Oct 2026: 68 PASS, 0 FAIL)", probes: probes() },
    scheduled_jobs: { kind: "LIVE production job logs (read-only, 13 Oct 2026)", jobs: {
      "nightly-squads": "form_all_colleges ok", "extend-fixtures": "extend_all_fixtures ok", "daily-lots": "assign_todays_lots ok (20 lots)",
      "weekly-seasons": "run_all_seasons ok", "weekly-progress": "notify_weekly_progress ok", "weekly-plan": "plan_all_weeks ok",
      "prune-events": "prune_app_events ok", "accounts-sync": "accounts /sync (not checked by log here)",
      staging: "BLOCKED: staging has only transcription-reap; no squad, Lot, season or account-sync job exists there" } },
    matrix_counts: counts,
  }, null, 1));
  console.log(`matrix rows ${rows.length} ${JSON.stringify(counts)}; endpoints ${endpoints.length} -> ${out}`);
}
