// Targeted tests for _shared/voiceScore.ts (G1 review fixes).
// Run: npx deno test --allow-env supabase/functions/_shared/voiceScore_test.ts
//
// FakeDb mirrors migration 45 as applied to production by Step 6DD
// (step6dd-migration-45-production-execution.sql): claim refuses scored rows
// and live claims (TTL 120 s) and mints a new lease; complete and fail are
// fenced on the lease AND refuse a scored row. Each RPC body runs with no
// await inside, so it is atomic the way the row-locked UPDATE is.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { parseAiScore, parseContentMatch, scoreRecording, transcriptQuality, type VoiceRec } from "./voiceScore.ts";

type Row = {
  id: string; status: string; communication_score: number | null; communication_notes: string | null;
  scoring_claimed_at: number | null; scoring_lease_token: string | null;
};

class FakeDb {
  now = 1_000_000; // seconds
  rows = new Map<string, Row>();
  fail: Record<string, boolean> = {}; // rpc/table name -> return an error
  streaks = 0;
  updates: Record<string, unknown>[] = [];
  submission: Record<string, unknown> | null = null;
  constructor(row: Partial<Row> & { id: string }) {
    this.rows.set(row.id, {
      status: 'recorded', communication_score: null, communication_notes: null,
      scoring_claimed_at: null, scoring_lease_token: null, ...row,
    });
  }
  // deno-lint-ignore no-explicit-any
  async rpc(name: string, a: any) {
    await Promise.resolve();
    if (this.fail[name]) return { data: null, error: { message: `${name} boom` } };
    const r = this.rows.get(a._id ?? '');
    if (name === 'claim_voice_scoring') {
      if (r && r.status !== 'scored' && (r.scoring_claimed_at === null || r.scoring_claimed_at < this.now - 120)) {
        const lease = crypto.randomUUID();
        r.scoring_claimed_at = this.now; r.scoring_lease_token = lease;
        return { data: [{ claimed: true, lease_token: lease }], error: null };
      }
      return { data: [{ claimed: false, lease_token: null }], error: null };
    }
    if (name === 'complete_voice_scoring') {
      if (r && r.scoring_lease_token === a._lease_token && r.status !== 'scored') {
        r.communication_score = a._score; r.communication_notes = a._notes; r.status = 'scored';
        return { data: true, error: null };
      }
      return { data: false, error: null };
    }
    if (name === 'fail_voice_scoring') {
      if (r && r.scoring_lease_token === a._lease_token && r.status !== 'scored') {
        r.status = 'failed'; r.communication_notes = a._notes ?? r.communication_notes;
        r.scoring_claimed_at = null; r.scoring_lease_token = null;
        return { data: true, error: null };
      }
      return { data: false, error: null };
    }
    if (name === 'touch_streak') { this.streaks++; return { data: null, error: null }; }
    throw new Error(`unexpected rpc ${name}`);
  }
  from(table: string) {
    let id = '';
    const q = {
      select: () => q,
      update: (v: Record<string, unknown>) => { this.updates.push(v); return q; },
      eq: (_c: string, v: string) => { id = v; return q; },
      maybeSingle: async () => {
        await Promise.resolve();
        if (this.fail[`read:${table}`]) return { data: null, error: { message: 'read boom' } };
        if (table === 'tasks') return { data: null, error: null };
        if (table === 'task_submissions') return { data: this.submission, error: null };
        const r = this.rows.get(id);
        return { data: r ? { ...r } : null, error: null };
      },
    };
    return q;
  }
}

const ID = '00000000-0000-0000-0000-000000000001';
const longRec = (over: Partial<VoiceRec> = {}): VoiceRec => ({
  id: ID, student_id: 's1', transcript: 'one two three four five six seven eight nine ten eleven twelve thirteen',
  duration_seconds: 20, word_count: 13, task_id: null, communication_score: null, communication_notes: null, ...over,
});
const shortRec = () => longRec({ transcript: 'too short', word_count: 2 });
const ai = (text: string, calls: { n: number } = { n: 0 }, delay = 0) =>
  async () => { calls.n++; if (delay) await new Promise((r) => setTimeout(r, delay)); return { text }; };

// ---------- 1. too-short decision is protected by the claim ----------
Deno.test("1a too-short never touches an already-scored recording", async () => {
  const db = new FakeDb({ id: ID, status: 'scored', communication_score: 70, communication_notes: 'good' });
  const r = await scoreRecording(db, shortRec(), ai('{}'));
  assertEquals(r.outcome, 'already');
  assertEquals(db.rows.get(ID)!.status, 'scored');
  assertEquals(db.rows.get(ID)!.communication_notes, 'good');
});
Deno.test("1b too-short never interferes with another live claim", async () => {
  const db = new FakeDb({ id: ID, scoring_claimed_at: 1_000_000, scoring_lease_token: 'other' });
  const r = await scoreRecording(db, shortRec(), ai('{}'));
  assertEquals(r.outcome, 'pending');
  assertEquals(db.rows.get(ID)!.status, 'recorded');
  assertEquals(db.rows.get(ID)!.scoring_lease_token, 'other');
});
Deno.test("1c too-short, unclaimed row: marked failed under this call's claim, no AI call", async () => {
  const db = new FakeDb({ id: ID });
  const calls = { n: 0 };
  const r = await scoreRecording(db, shortRec(), ai('{}', calls));
  assertEquals(r.outcome, 'too_short');
  assertEquals(calls.n, 0);
  assertEquals(db.rows.get(ID)!.status, 'failed');
  assertEquals(db.rows.get(ID)!.communication_notes, 'Too little speech to score.');
  assertEquals(db.rows.get(ID)!.scoring_lease_token, null);
});
Deno.test("1d too-short, 10 concurrent calls: exactly one writes, the rest do not", async () => {
  const db = new FakeDb({ id: ID });
  const rs = await Promise.all(Array.from({ length: 10 }, () => scoreRecording(db, shortRec(), ai('{}'))));
  assertEquals(rs.filter((r) => r.outcome === 'too_short').length, 1);
  assert(rs.every((r) => r.outcome === 'too_short' || r.outcome === 'pending'));
});

// ---------- 2. database errors are reported as errors ----------
for (const [label, fail, aiText] of [
  ['claim', 'claim_voice_scoring', '{"communication_score":70}'],
  ['complete', 'complete_voice_scoring', '{"communication_score":70}'],
  ['fail (after AI failure)', 'fail_voice_scoring', 'not json'],
  ['fail (too short)', 'fail_voice_scoring', ''],
  ['read after unclaimed', 'read:voice_explanations', ''],
] as const) {
  Deno.test(`2 ${label} error -> 'error' 503, never 'already'/'lost_race'`, async () => {
    const db = new FakeDb(label === 'read after unclaimed'
      ? { id: ID, scoring_claimed_at: 1_000_000, scoring_lease_token: 'other' } : { id: ID });
    db.fail[fail] = true;
    const rec = label === 'fail (too short)' ? shortRec() : longRec();
    const r = await scoreRecording(db, rec, ai(aiText));
    assertEquals(r.outcome, 'error');
    assertEquals(r.status, 503);
    assert(db.rows.get(ID)!.status !== 'scored');
  });
}

// ---------- 3. AI answers are validated, never silently 0 ----------
for (const bad of [
  '{"notes":"no score"}', '{"communication_score":"abc"}', '{"communication_score":null}',
  '{"communication_score":""}', '{"communication_score":"NaN"}', '{"communication_score":150}',
  '{"communication_score":-5}', '{"communication_score":true}', 'not json at all', '',
]) {
  Deno.test(`3 unusable AI answer ${JSON.stringify(bad)} -> failed, score stays null`, async () => {
    const db = new FakeDb({ id: ID });
    const r = await scoreRecording(db, longRec(), ai(bad));
    assertEquals(r.outcome, 'failed');
    assertEquals(r.status, 502);
    assertEquals(db.rows.get(ID)!.communication_score, null);
    assertEquals(db.rows.get(ID)!.status, 'failed');
  });
}
Deno.test("3 AI call throwing -> failed", async () => {
  const db = new FakeDb({ id: ID });
  const r = await scoreRecording(db, longRec(), () => Promise.reject(new Error('deepseek down')));
  assertEquals(r.outcome, 'failed');
  assertEquals(db.rows.get(ID)!.communication_score, null);
});
Deno.test("3 valid answers: 0, 100, numeric string, rounding", () => {
  assertEquals(parseAiScore('{"communication_score":0}')?.score, 0);
  assertEquals(parseAiScore('{"communication_score":100}')?.score, 100);
  assertEquals(parseAiScore('{"communication_score":"72"}')?.score, 72);
  assertEquals(parseAiScore('Sure! {"communication_score":64.6,"notes":"x"}')?.score, 65);
});

// ---------- 4. pending is distinguishable ----------
Deno.test("4 live claim elsewhere, no saved score -> 'pending' 202, not 'already'", async () => {
  const db = new FakeDb({ id: ID, scoring_claimed_at: 1_000_000 - 30, scoring_lease_token: 'other' });
  const r = await scoreRecording(db, longRec(), ai('{"communication_score":70}'));
  assertEquals(r.outcome, 'pending');
  assertEquals(r.status, 202);
  assertEquals(r.body.pending, true);
});
Deno.test("4 already scored -> 'already' with the saved score", async () => {
  const db = new FakeDb({ id: ID, status: 'scored', communication_score: 61 });
  const r = await scoreRecording(db, longRec(), ai('{"communication_score":1}'));
  assertEquals(r.outcome, 'already');
  assertEquals(r.body.communication_score, 61);
});

// ---------- 5. concurrency ----------
Deno.test("5 20 concurrent requests -> exactly one AI call, one save", async () => {
  const db = new FakeDb({ id: ID });
  const calls = { n: 0 };
  const rs = await Promise.all(Array.from({ length: 20 },
    () => scoreRecording(db, longRec(), ai('{"communication_score":77,"notes":"n"}', calls, 20))));
  assertEquals(calls.n, 1);
  assertEquals(rs.filter((r) => r.outcome === 'scored').length, 1);
  assert(rs.every((r) => r.outcome === 'scored' || r.outcome === 'pending'));
  assertEquals(db.rows.get(ID)!.communication_score, 77);
  assertEquals(db.streaks, 1);
  const again = await scoreRecording(db, longRec(), ai('{"communication_score":5}', calls));
  assertEquals(again.outcome, 'already');
  assertEquals(calls.n, 1);
});

// ---------- 6. AI call outlasting the 120 s lease ----------
Deno.test("6a slow A outlives its lease; B re-claims and saves; A's late result is rejected", async () => {
  const db = new FakeDb({ id: ID });
  const calls = { n: 0 };
  let releaseA!: () => void;
  const aGate = new Promise<void>((res) => releaseA = res);
  const slowA = async () => { calls.n++; await aGate; return { text: '{"communication_score":20,"notes":"A"}' }; };
  const aP = scoreRecording(db, longRec(), slowA);
  await new Promise((r) => setTimeout(r, 5));       // A has claimed, AI in flight
  db.now += 121;                                     // A's lease is now stale
  const b = await scoreRecording(db, longRec(), ai('{"communication_score":80,"notes":"B"}', calls));
  assertEquals(b.outcome, 'scored');
  releaseA();
  const a = await aP;
  assertEquals(a.outcome, 'lost_race');
  assertEquals(db.rows.get(ID)!.communication_score, 80);   // saved result protected
  assertEquals(db.rows.get(ID)!.communication_notes, 'B');
  assertEquals(calls.n, 2);   // HONEST: two AI calls did happen
});
Deno.test("6b slow A fails after B took over: A's failure does not touch B's claim", async () => {
  const db = new FakeDb({ id: ID });
  let releaseA!: () => void;
  const aGate = new Promise<void>((res) => releaseA = res);
  const aP = scoreRecording(db, longRec(), async () => { await aGate; return { text: 'garbage' }; });
  await new Promise((r) => setTimeout(r, 5));
  db.now += 121;
  let releaseB!: () => void;
  const bGate = new Promise<void>((res) => releaseB = res);
  const bP = scoreRecording(db, longRec(), async () => { await bGate; return { text: '{"communication_score":66}' }; });
  await new Promise((r) => setTimeout(r, 5));        // B holds the live claim
  releaseA();
  const a = await aP;
  assertEquals(a.outcome, 'lost_race');
  assertEquals(db.rows.get(ID)!.status, 'recorded');  // not marked failed
  releaseB();
  assertEquals((await bP).outcome, 'scored');
  assertEquals(db.rows.get(ID)!.communication_score, 66);
});
Deno.test("6c after the save, a third late caller cannot overwrite or re-grade", async () => {
  const db = new FakeDb({ id: ID });
  const calls = { n: 0 };
  await scoreRecording(db, longRec(), ai('{"communication_score":80}', calls));
  db.now += 10_000;                                   // long after every lease
  const c = await scoreRecording(db, longRec(), ai('{"communication_score":1}', calls));
  assertEquals(c.outcome, 'already');
  assertEquals(calls.n, 1);
  assertEquals(db.rows.get(ID)!.communication_score, 80);
});

// ---------- Wave 6: quality checks and content-linked scoring ----------
Deno.test("6a quality: silence, one word, repetition are caught; a short specific answer is not", () => {
  assertEquals(transcriptQuality(null, 0).flags, ['silence']);
  assertEquals(transcriptQuality('   ', 0).flags, ['silence']);
  assertEquals(transcriptQuality('hello', 1).flags, ['too_few_words']);
  assertEquals(transcriptQuality(Array(30).fill('testing testing').join(' '), 60).flags, ['repetitive']);
  assertEquals(transcriptQuality('I used a dictionary keyed by user and added one for every failed line then sorted it', 17).flags, []);
});
Deno.test("6b content_match is parsed strictly", () => {
  assertEquals(parseContentMatch('{"communication_score": 70, "content_match": 85, "notes": "x"}'), 85);
  assertEquals(parseContentMatch('{"communication_score": 70, "content_match": "40"}'), 40);
  assertEquals(parseContentMatch('{"communication_score": 70}'), null);
  assertEquals(parseContentMatch('{"content_match": 400}'), null);
  assertEquals(parseContentMatch('not json'), null);
});
Deno.test("6c the prompt carries the submitted work, and the evaluation is saved with a version", async () => {
  const db = new FakeDb({ id: ID });
  db.submission = { code: 'counts = {}  # UNIQUE_MARKER', language: 'python', status: 'passed', passed_count: 6, total_count: 6 };
  let seen = '';
  const gen = async (prompt: string) => { seen = prompt; return { text: '{"communication_score": 80, "content_match": 90, "notes": "ok"}' }; };
  const r = await scoreRecording(db, longRec({ submission_id: 'sub1' }), gen);
  assertEquals(r.outcome, 'scored');
  assert(seen.includes('UNIQUE_MARKER') && seen.includes('6 of 6 tests'));
  assertEquals(db.rows.get(ID)!.communication_score, 80);
  assertEquals((db.updates[0].evaluation as Record<string, unknown>).evaluator_version, 'voice-eval-3');
  assertEquals((db.updates[0].evaluation as Record<string, unknown>).content_match, 90);
});
Deno.test("6d an off-topic explanation cannot keep a high score", async () => {
  const db = new FakeDb({ id: ID });
  const r = await scoreRecording(db, longRec({ submission_id: 'sub1' }),
    ai('{"communication_score": 88, "content_match": 10, "notes": "fluent but about something else"}'));
  assertEquals(r.outcome, 'scored');
  assertEquals(db.rows.get(ID)!.communication_score, 30);
  assertEquals((db.updates[0].evaluation as Record<string, unknown>).flags, ['off_topic']);
});

Deno.test("6e a recording the language gate closed is never graded and costs no AI call", async () => {
  const db = new FakeDb({ id: ID });
  const calls = { n: 0 };
  const r = await scoreRecording(db, longRec({ transcription_error: 'non_english' }), ai('{"communication_score": 90}', calls));
  assertEquals(r.status, 409);
  assertEquals(calls.n, 0);
  assertEquals(db.rows.get(ID)!.status, 'recorded');
});
Deno.test("6f scoring keeps the language metadata the transcriber stored", async () => {
  const db = new FakeDb({ id: ID });
  await scoreRecording(db, longRec({ evaluation: { transcription: { language: 'en', gate: 'english' } } }),
    ai('{"communication_score": 70, "content_match": 80, "notes": "ok"}'));
  const saved = db.updates[0].evaluation as Record<string, unknown>;
  assertEquals((saved.transcription as Record<string, unknown>).language, 'en');
  assertEquals(saved.evaluator_version, 'voice-eval-3');
});
