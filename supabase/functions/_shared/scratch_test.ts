// Run: deno test supabase/functions/_shared/scratch_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { applyScratchLanguage, scratchLanguageFor } from "./scratch.ts";

Deno.test("only a written technical Lot with an allowlisted value gets a language", () => {
  assertEquals(scratchLanguageFor("rubric", "technical", "python"), "python");
  assertEquals(scratchLanguageFor("rubric", "technical", "java"), "java");
  assertEquals(scratchLanguageFor("rubric", "business", "python"), null);   // business stays NULL
  assertEquals(scratchLanguageFor("rubric", "pitch", "python"), null);
  assertEquals(scratchLanguageFor("sandbox", "technical", "python"), null); // coding Lots have their own editor
  for (const bad of [null, undefined, "", "Python", "sql", "bash", "python3", 1, ["python"], { v: "python" }]) {
    assertEquals(scratchLanguageFor("rubric", "technical", bad), null, JSON.stringify(bad));
  }
});

type Row = Record<string, unknown>;
function fakeDb(rows: Row[]) {
  const log: string[] = [];
  const db = {
    from: (_t: string) => {
      const filters: [string, unknown][] = [];
      let op: "select" | "update" | "insert" = "select";
      let payload: Row = {};
      const match = (r: Row) => filters.every(([k, v]) => r[k] === v);
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return q; },
        update: (p: Row) => { op = "update"; payload = p; return q; },
        insert: (p: Row) => { op = "insert"; payload = p; return q; },
        maybeSingle: () => Promise.resolve({ data: rows.find(match) ?? null, error: null }),
        single: () => {
          const row = { id: `new-${rows.length}`, ...payload };
          rows.push(row); log.push(`insert ${row.id}`);
          return Promise.resolve({ data: row, error: null });
        },
        then: (res: (v: unknown) => unknown) => {
          if (op === "update") { rows.filter(match).forEach((r) => { Object.assign(r, payload); log.push(`update ${r.id}`); }); }
          return Promise.resolve({ error: null }).then(res);
        },
      };
      return q;
    },
  };
  return { db, log };
}

const base = { prompt_text: "p", criteria: [{ id: "a" }, { id: "b" }], min_words: 60, max_words: 800, pass_threshold: 70, reference_answer: "r", created_by: null };

Deno.test("own config: that row gets the language, id unchanged", async () => {
  const rows: Row[] = [{ id: "own", is_generic_fallback: false, scratch_language: null, ...base }];
  const { db, log } = fakeDb(rows);
  assertEquals(await applyScratchLanguage(db, "own", "python"), "own");
  assertEquals(rows[0].scratch_language, "python");
  assertEquals(log, ["update own"]);
});

Deno.test("generic fallback is never changed: a dedicated copy gets the language", async () => {
  const rows: Row[] = [{ id: "fallback", is_generic_fallback: true, scratch_language: null, ...base }];
  const { db, log } = fakeDb(rows);
  const id = await applyScratchLanguage(db, "fallback", "java");
  assertEquals(rows[0].scratch_language, null);                 // fallback untouched
  assertEquals(log, ["insert new-1"]);
  const copy = rows.find((r) => r.id === id)!;
  assertEquals([copy.scratch_language, copy.is_generic_fallback, copy.origin], ["java", false, "auto_fallback"]);
  for (const k of ["prompt_text", "criteria", "min_words", "max_words", "pass_threshold", "reference_answer"]) {
    assertEquals(copy[k], (base as Row)[k], k);                  // same checklist, same pass mark
  }
});

Deno.test("no language: nothing written, same config", async () => {
  const rows: Row[] = [{ id: "fallback", is_generic_fallback: true, ...base }];
  const { db, log } = fakeDb(rows);
  assertEquals(await applyScratchLanguage(db, "fallback", null), "fallback");
  assertEquals(await applyScratchLanguage(db, null, "python"), null);
  assertEquals(log, []);
});
