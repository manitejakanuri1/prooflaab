// S30 (copied from S29, extended): offline permission evaluator. Decides "may this synthetic identity do OP on this row?" from the policy model
// replayed out of the repository's migrations (sidhu_s30_policy_model.mjs). No database, no SQL execution.
//
// Policy expressions are parsed into AND / OR / NOT trees. Atoms that this file understands are evaluated against a
// small synthetic world; ANY atom it does not understand evaluates to UNKNOWN, and an UNKNOWN that could change the
// outcome makes the whole decision UNKNOWN (reported as NOT_VERIFIED, never as a pass).
// BEFORE triggers are emulated from their source: simple `new.col := <literal>` assignments in insert guards, the
// frozen-column lists of protect_* triggers, and keep_approval_closed. Conditional logic inside triggers beyond that
// is not emulated (noted per result).
// Postgres semantics followed: no grant -> denied; RLS off -> all rows; RLS on -> OR of permissive policies for the
// command and role (none -> denied) AND every restrictive one; INSERT uses WITH CHECK; UPDATE needs USING on the old
// row and WITH CHECK (or USING when absent) on the new row; ALL policies apply to every command.
import { buildModel } from "./sidhu_s30_policy_model.mjs";

export const T = "TRUE", F = "FALSE", U = "UNKNOWN";
const or3 = (xs) => xs.includes(T) ? T : xs.every((x) => x === F) ? F : U;
const and3 = (xs) => xs.includes(F) ? F : xs.every((x) => x === T) ? T : U;
const not3 = (x) => x === T ? F : x === F ? T : U;

export function normalize(e) {
  return String(e).toLowerCase().replace(/\s+/g, " ").replace(/public\./g, "").replace(/::[a-z_]+/g, "")
    .replace(/\(select (auth\.uid\(\)|is_admin\(\)|my_college_id\(\))\)/g, "$1")
    .replace(/\b(tasks|student_contact|student_profiles|audit_logs)\.(?=[a-z_]+\b)(?!\w+\s*\()/g, "")
    .trim();
}
function splitTop(e, word) {
  const parts = []; let d = 0, q = false, cur = "";
  for (let i = 0; i < e.length; i++) {
    const ch = e[i];
    if (ch === "'") q = !q;
    if (!q) { if (ch === "(") d++; else if (ch === ")") d--; }
    if (!q && d === 0 && e.startsWith(` ${word} `, i)) { parts.push(cur); cur = ""; i += word.length + 1; continue; }
    cur += ch;
  }
  parts.push(cur); return parts.map((p) => p.trim());
}
const wrapped = (e) => { if (!e.startsWith("(") || !e.endsWith(")")) return false; let d = 0; for (let i = 0; i < e.length; i++) { if (e[i] === "(") d++; else if (e[i] === ")") d--; if (d === 0 && i < e.length - 1) return false; } return true; };

/** Evaluates one normalized expression for actor `a` on row `r` in world `w`. Returns { v, unknown: [atoms] }. */
export function evalExpr(expr, a, r, w) {
  const unknown = [];
  const go = (e) => {
    e = e.trim();
    while (wrapped(e)) e = e.slice(1, -1).trim();
    const ors = splitTop(e, "or"); if (ors.length > 1) return or3(ors.map(go));
    const ands = splitTop(e, "and"); if (ands.length > 1) return and3(ands.map(go));
    if (e.startsWith("not ")) return not3(go(e.slice(4)));
    const v = atom(e, a, r, w); if (v === U) unknown.push(e); return v;
  };
  return { v: go(normalize(expr)), unknown };
}
const b = (x) => (x ? T : F);
function atom(e, a, r, w) {
  let m;
  const uid = a.uid ?? null;
  const myCollege = w.colleges.find((c) => c.user_id === uid && c.verification_status === "approved")?.id ?? null;
  const approved = w.colleges.filter((c) => c.user_id === uid && c.verification_status === "approved").map((c) => c.id);
  const isAdmin = w.user_roles.some((x) => x.user_id === uid && x.role === "admin");
  const owns = (cid) => cid != null && approved.includes(cid);
  if (e === "true") return T; if (e === "false") return F;
  if (e === "is_admin()") return b(isAdmin);
  if ((m = e.match(/^([a-z_]+) = auth\.uid\(\)$/)) || (m = e.match(/^auth\.uid\(\) = ([a-z_]+)$/))) return b(uid != null && r[m[1]] === uid);
  if ((m = e.match(/^([a-z_]+) = my_college_id\(\)$/))) return b(myCollege != null && r[m[1]] === myCollege);
  if (e === "my_college_id() is not null") return b(myCollege != null);
  if ((m = e.match(/^college_owns_student\(([a-z_]+)\)$/))) return b(owns(r[m[1]]));
  if ((m = e.match(/^([a-z_]+) in \(select my_approved_college_ids\(\)\)$/))) return b(approved.includes(r[m[1]]));
  if ((m = e.match(/^([a-z_]+) = '([^']*)'$/))) return b(r[m[1]] === m[2]);
  if ((m = e.match(/^([a-z_]+) is null$/))) return b(r[m[1]] == null);
  if ((m = e.match(/^([a-z_]+) is not null$/))) return b(r[m[1]] != null);
  if ((m = e.match(/^([a-z_]+) > now\(\)$/))) return r[m[1]] == null ? F : b(new Date(r[m[1]]) > new Date());
  if (/^[a-z_]+$/.test(e) && !e.endsWith("()")) return b(r[e] === true);   // a boolean column; absent = not true
  if ((m = e.match(/^([a-z_]+) = any \(array\[(.*)\]\)$/))) return b(m[2].split(",").map((s) => s.trim().replace(/'/g, "")).includes(r[m[1]]));
  if (/^exists \( ?select 1 from task_assignments a where a\.task_id = id and a\.student_id = auth\.uid\(\) ?\)$/.test(e))
    return b(w.task_assignments.some((x) => x.task_id === r.id && x.student_id === uid));
  if (/^exists \( ?select 1 from student_profiles s where s\.id = student_id and college_owns_student\(s\.college_id\) ?\)$/.test(e))
    return b(w.student_profiles.some((s) => s.id === r.student_id && owns(s.college_id)));
  if (/^exists \( ?select 1 from student_profiles p where p\.id = student_id and p\.college_id = my_college_id\(\) ?\)$/.test(e))
    return b(myCollege != null && w.student_profiles.some((s) => s.id === r.student_id && s.college_id === myCollege));
  if (/^student_id in \( ?select sp\.id from student_profiles sp where sp\.college_id in \(select my_approved_college_ids\(\)\) ?\)$/.test(e))
    return b(w.student_profiles.some((s) => s.id === r.student_id && approved.includes(s.college_id)));
  if (/^import_id in \(select id from student_imports where college_id = my_college_id\(\)\)$/.test(e))
    return b(myCollege != null && w.student_imports.some((i) => i.id === r.import_id && i.college_id === myCollege));
  if ((m = e.match(/^exists \( ?select 1 from user_roles r where r\.user_id = auth\.uid\(\) and r\.role in \(([^)]*)\) ?\)$/)))
    return b(w.user_roles.some((x) => x.user_id === uid && m[1].split(",").map((s) => s.trim().replace(/'/g, "")).includes(x.role)));
  // S30 (migration 103) atoms.
  if (/^exists \( ?select 1 from student_profiles p where p\.id = student_id and p\.college_id = created_by_college_id ?\)$/.test(e))
    return b(w.student_profiles.some((s) => s.id === r.student_id && s.college_id === r.created_by_college_id));
  if ((m = e.match(/^has_role\(([a-z_]+), '([a-z_]+)'\)$/))) return b(w.user_roles.some((x) => x.user_id === r[m[1]] && x.role === m[2]));
  if (/^exists \(select 1 from tasks t where t\.id = record_id and t\.created_by_college_id = college_id\)$/.test(e))
    return b((w.tasks ?? []).some((t) => t.id === r.record_id && t.created_by_college_id === r.college_id));
  return U;
}

/** Emulates BEFORE triggers for an authenticated, non-admin caller, from their source. Returns { row, notes }. */
export function emulateTriggers(model, table, op, actor, oldRow, newRow, w, setCols) {
  const t = model.tables.get(table); const notes = []; let row = { ...newRow };
  const uid = actor.uid ?? null;
  const isAdmin = w.user_roles.some((x) => x.user_id === uid && x.role === "admin");
  // Columns named in the UPDATE's SET list (PostgREST PATCH sends only the given ones). Default: those that differ.
  const set = setCols ?? Object.keys(newRow).filter((k) => newRow[k] !== oldRow[k]);
  // Postgres fires triggers of the same timing and event in ALPHABETICAL order of trigger name.
  for (const tr of [...t.triggers.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (tr.when !== "before" || !tr.events.includes(op)) continue;
    const of = tr.events.match(/update of ([a-z_, ]+)/);
    if (op === "update" && of && !of[1].split(",").map((c) => c.trim()).some((c) => set.includes(c))) continue;
    const fn = model.functions.get(tr.fn);
    // task_default_checker runs for every caller (no role test in its source): emulated from migration 74.
    if (tr.fn === "task_default_checker") {
      if (row.grading_type === "coding" && row.sandbox_config_id == null) return { row, notes, raised: "coding task needs tests" };
      if (row.sandbox_config_id == null && row.rubric_config_id == null) row.rubric_config_id = "GENERIC_FALLBACK_RUBRIC";
      row.grading_type = row.sandbox_config_id != null ? "coding" : "written";
      notes.push(`${tr.name}: rubric=${row.rubric_config_id}, grading_type=${row.grading_type}`); continue;
    }
    if (!uid || isAdmin) continue;
    if (["protect_columns", "protect_student_profile_columns"].includes(tr.fn) && op === "update") {
      let cols = tr.args;
      if (tr.fn === "protect_student_profile_columns" && w.colleges.some((c) => c.id === oldRow.college_id && c.user_id === uid && c.verification_status === "approved")) {
        cols = cols.filter((c) => c !== "status" && c !== "roll_number");
      }
      for (const c of cols) if (c in row || c in oldRow) row[c] = oldRow[c];
      notes.push(`${tr.name}: froze ${cols.join(",")}`); continue;
    }
    if (tr.fn === "keep_approval_closed") { row.verification_status = op === "insert" ? "pending" : oldRow.verification_status; notes.push(`${tr.name}: verification_status kept`); continue; }
    // Only the insert guards read in full for S29 are emulated (their assignments are unconditional for an
    // authenticated non-admin caller). Every other BEFORE INSERT trigger is reported, not guessed.
    if (op === "insert" && fn && !["tasks_clamp_student_insert", "guard_voice_explanations_insert"].includes(tr.fn)) { notes.push(`${tr.name} (${tr.fn}): not emulated`); continue; }
    if (op === "insert" && fn) {
      // Only straight-line assignments are emulated; anything conditional is reported, not guessed.
      const sets = [...fn.sql.matchAll(/new\.([a-z_]+)\s*:=\s*([^;]+);/gi)];
      if (!sets.length) continue;
      for (const [, col, expr] of sets) {
        const x = expr.trim(); let m;
        if (/^null$/i.test(x)) row[col] = null;
        else if (/^(true|false)$/i.test(x)) row[col] = x.toLowerCase() === "true";
        else if (/^-?\d+$/.test(x)) row[col] = Number(x);
        else if ((m = x.match(/^'([^']*)'$/))) row[col] = m[1];
        else if ((m = x.match(/^coalesce\(new\.([a-z_]+),\s*'([^']*)'\)$/i))) row[col] = row[m[1]] ?? m[2];
        else notes.push(`${tr.name}: ${col} := ${x.slice(0, 40)} (not emulated)`);
      }
      notes.push(`${tr.name}: insert guard applied`);
    }
  }
  return { row, notes };
}

/** Decision for one action. */
export function decide(model, w, { table, op, actor, row, newRow, set }) {
  const t = model.tables.get(table);
  if (!t) return { decision: U, why: `table ${table} not in model` };
  const role = actor.uid ? "authenticated" : "anon";
  if (!t.grants[role].has(op)) return { decision: F, why: `no ${op} grant for ${role}` };
  if (!t.rls) return { decision: T, why: "row level security is off" };
  const cmdOk = (p) => p.cmd === "all" || p.cmd === op;
  const roleOk = (p) => p.roles.includes("public") || p.roles.includes(role);
  const pols = [...t.policies.values()].filter((p) => cmdOk(p) && roleOk(p));
  const perm = pols.filter((p) => p.permissive), restr = pols.filter((p) => !p.permissive);
  if (!perm.length) return { decision: F, why: `no permissive ${op} policy for ${role}` };
  const unknown = [];
  const ev = (exprOf, r) => (ps) => ps.map((p) => { const e = exprOf(p); if (!e) return T; const x = evalExpr(e, actor, r, w); unknown.push(...x.unknown); return x.v; });
  let triggerNotes = [];
  let finalRow = newRow;
  if (op === "insert" || op === "update") { const em = emulateTriggers(model, table, op, actor, row ?? {}, newRow, w, set); finalRow = em.row; triggerNotes = em.notes; if (em.raised) return { decision: F, why: `trigger raised: ${em.raised}`, unknown: [], finalRow, triggerNotes }; }
  let v;
  if (op === "select" || op === "delete") v = and3([or3(ev((p) => p.using, row)(perm)), and3(ev((p) => p.using, row)(restr))]);
  else if (op === "insert") v = and3([or3(ev((p) => p.check ?? p.using, finalRow)(perm)), and3(ev((p) => p.check ?? p.using, finalRow)(restr))]);
  else v = and3([or3(ev((p) => p.using, row)(perm)), or3(ev((p) => p.check ?? p.using, finalRow)(perm)), and3(ev((p) => p.using, row)(restr)), and3(ev((p) => p.check ?? p.using, finalRow)(restr))]);
  return { decision: v, why: `${perm.length} permissive policy(ies): ${perm.map((p) => p.name).join(", ")}`, unknown: [...new Set(unknown)], finalRow, triggerNotes };
}

// ---------------------------------------------------------------- the synthetic world (no real people or ids)
export const ID = {
  SA: "00000000-0000-4000-8000-0000000000a1", SB: "00000000-0000-4000-8000-0000000000a2", SC: "00000000-0000-4000-8000-0000000000a3",
  TPO1: "00000000-0000-4000-8000-0000000000c1", TPO2: "00000000-0000-4000-8000-0000000000c2", TPOP: "00000000-0000-4000-8000-0000000000c3",
  CO1: "00000000-0000-4000-8000-0000000000d1", CO2: "00000000-0000-4000-8000-0000000000d2", ADM: "00000000-0000-4000-8000-0000000000e1",
  C1: "00000000-0000-4000-8000-0000000001c1", C2: "00000000-0000-4000-8000-0000000001c2", C3: "00000000-0000-4000-8000-0000000001c3",
};
export function world() {
  return {
    colleges: [{ id: ID.C1, user_id: ID.TPO1, verification_status: "approved" }, { id: ID.C2, user_id: ID.TPO2, verification_status: "approved" }, { id: ID.C3, user_id: ID.TPOP, verification_status: "pending" }],
    student_profiles: [{ id: ID.SA, user_id: ID.SA, college_id: ID.C1 }, { id: ID.SB, user_id: ID.SB, college_id: ID.C1 }, { id: ID.SC, user_id: ID.SC, college_id: ID.C2 }],
    student_imports: [{ id: "imp-1", college_id: ID.C1 }, { id: "imp-2", college_id: ID.C2 }],
    task_assignments: [{ task_id: "task-assigned-to-sb", student_id: ID.SB }],
    user_roles: [["SA", "student"], ["SB", "student"], ["SC", "student"], ["TPO1", "college_admin"], ["TPO2", "college_admin"], ["TPOP", "college_admin"], ["CO1", "startup"], ["CO2", "startup"], ["ADM", "admin"]].map(([k, role]) => ({ user_id: ID[k], role })),
  };
}
export const actor = (k) => ({ key: k, uid: k === "ANON" ? null : ID[k] });
let cached;
export const model = () => (cached ??= buildModel());
