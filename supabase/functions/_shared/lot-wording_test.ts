import { asksForProgram, lotWordingProblems } from './lot-wording.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
const has = (p: string[], word: string) => p.some((x) => x.toLowerCase().includes(word));

// Real production Lots (3 Oct 2026), verbatim scenario text.
const FILE = 'You are an engineering student preparing for Microsoft\'s fresher hiring process. A senior has asked you to create a one-page study plan that maps out the six rounds Microsoft typically conducts. Submit your plan as a plain text or markdown file.';
const ATTACHED = 'You are helping a friend who is applying to LTIMindtree\'s 2025 campus drive. Your job is to create a one-page reference sheet that lists each round. Use only the information from the attached PrepInsta article on Mindtree Interview Experience 2025.';
const FABRICATED = 'You recently attended a Capgemini on-campus drive and want to document your experience to help juniors. Write a short report describing what each section covered. Submit a plain text file with your report.';
const VOICE = 'You are a final-year engineering student shortlisted for Wipro\'s NTH drive. You need a crisp self-introduction. Draft it, then record yourself delivering it in under a minute.';

Deno.test('the real bad production Lots are rejected for the right reasons', () => {
  assert(has(lotWordingProblems({ title: 'Study plan', scenario: FILE }, 'rubric'), 'file'), 'file deliverable not caught');
  assert(has(lotWordingProblems({ title: 'Rounds', scenario: ATTACHED }, 'rubric'), 'not included'), 'unseen article not caught');
  assert(has(lotWordingProblems({ title: 'Report', scenario: FABRICATED }, 'rubric'), 'already did'), 'fabricated premise not caught');
  assert(has(lotWordingProblems({ title: 'Intro', scenario: VOICE }, 'rubric'), 'recording'), 'voice-in-task not caught');
});

const GOOD_CODING = `A shop wants to know how many different products a customer bought.
Your task: Read one line of product names and print how many distinct names it has, ignoring case.
Input: one line of words separated by spaces (may be empty).
Output: one integer.
Constraints: at most 1000 words.
Example: Input "Pen pen Book" -> Output 2
Why: "Pen" and "pen" are the same product, so the distinct names are pen and book.`;

const GOOD_WRITTEN = `Your college placement cell sends juniors a short guide before each campus drive. A typical IT services drive has an aptitude test, a coding round and an HR interview.
Your task: Write a 7-day preparation plan a junior can follow on their own for such a drive.
What to write: in the answer box, one short paragraph per day (what to practise and for how long), about 200-300 words.`;

Deno.test('well-formed coding and written Lots pass', () => {
  const a = lotWordingProblems({ title: 'Count distinct products', scenario: GOOD_CODING }, 'sandbox');
  assert(a.length === 0, JSON.stringify(a));
  const b = lotWordingProblems({ title: 'A 7-day drive preparation plan', scenario: GOOD_WRITTEN }, 'rubric');
  assert(b.length === 0, JSON.stringify(b));
});

Deno.test('coding Lots need Input/Output/Example/Why; "code below" needs the code', () => {
  const p = lotWordingProblems({ title: 'Fix it', scenario: 'Your task: fix the function below so it works for negative numbers and prints the right total every time it runs.' }, 'sandbox');
  assert(has(p, 'input') && has(p, 'output') && has(p, 'example'), 'missing coding sections not flagged');
  assert(has(p, 'not included'), '"below" without code_sample not flagged');
  const q = lotWordingProblems({ title: 'Fix it', scenario: 'Your task: fix the function below so it works for negative numbers and prints the right total every time it runs.', code_sample: 'def f(x):\n  return x' }, 'sandbox');
  assert(!has(q, 'not included'), '"below" flagged even though code_sample is present');
});

// QA week 8 on REAL (Nov 2026): each of these reached students with nothing to work from.
Deno.test('named notes, sheets, articles and PDFs without the material are rejected', () => {
  const ctx = 'A manager needs a one-page summary for the client call tomorrow. The call is short, so it must be clear.\n';
  const cases: [string, string][] = [
    [ctx + 'Your task: Write the summary from the raw notes.\nWhat to write: 150 words in the answer box.', 'not included'],
    [ctx + 'Your task: Fix three wrong answers on the five-question sheet.\nWhat to write: the fixed answers, 100 words.', 'not included'],
    [ctx + 'Your task: Using the Infosys Interview Experience 2023 article, list talking points.\nWhat to write: 200 words.', 'not included'],
    [ctx + 'Your task: Write the talking points and submit them as a PDF.\nWhat to write: 200 words.', 'pdf'],
    [ctx + 'Your task: Write a script for the time-and-work sum and include its output log.\nWhat to write: the script and the output.', 'pdf'],
  ];
  for (const [scenario, word] of cases) {
    const p = lotWordingProblems({ title: 'Summary', scenario }, 'rubric');
    assert(has(p, word), `not caught (${word}): ${scenario.slice(ctx.length, ctx.length + 60)} -> ${JSON.stringify(p)}`);
  }
  const withSheet = lotWordingProblems({ title: 'Sheet', scenario: cases[1][0], code_sample: 'Q1 ...' }, 'rubric');
  assert(!has(withSheet, 'not included'), 'flagged even though the sheet is in code_sample');
});

// QA round 2 (11 Nov 2026), REAL: written Lots that asked for a program, and Lots pointing at material not shown.
Deno.test('a written Lot that asks for a program is spotted (it must be a coding Lot)', () => {
  assert(asksForProgram({ title: 'Time and Work Solver', scenario: 'Your task: work out the days.' }), 'solver title');
  assert(asksForProgram({ title: 'Build a timed aptitude mock test', scenario: 'Context.\nYour task: Write a Python program that asks 10 questions and times them.\nWhat to write: the code.' }), 'program in task line');
  assert(!asksForProgram({ title: 'Write a JOIN query to combine orders', scenario: 'Your task: write the SQL query and explain each join in 100 to 150 words.' }), 'a SQL query is not a program');
  assert(!asksForProgram({ title: 'Choose Low-Code vs Pro-Code', scenario: 'A team builds a program for clients.\nYour task: recommend one approach in 150 words.' }), 'context words do not count');
});

Deno.test('material the student is not shown is caught', () => {
  const base = 'A friend is preparing for placements and asked for help with aptitude.\nYour task: ';
  const end = '\nWhat to write: 100 to 200 words in the answer box.';
  for (const s of ['pick five from your practice set and explain each.', 'rank the list given by difficulty.', 'review the repo excerpt and list three risks.']) {
    assert(has(lotWordingProblems({ title: 'T', scenario: base + s + end }, 'rubric'), 'not shown'), s);
  }
  assert(!has(lotWordingProblems({ title: 'T', scenario: base + 'rank the list given by difficulty.' + end, code_sample: '1. a\n2. b' }, 'rubric'), 'not shown'), 'shown in code_sample');
});

// QA round 2 item 20: tests feed stdin, the given script uses inline data, the steps never say "read input".
const SPLIT = 'Your task: move the parsing helpers of this growing script into a module and import them. Input: see the script. Output: the same totals as before. Example: totals print as before. Why: modules keep code reusable.';
const stdinTests = [{ id: 't1', stdin: 'id,value\n1,10', expected_output: '1,10' }];
Deno.test('a coding Lot whose tests feed input it never reads is rejected (item 20)', () => {
  const bad = lotWordingProblems({ title: 'Split a growing script into an importable module', scenario: SPLIT,
    code_sample: 'rows = [(1, 10), (2, 20)]\nprint(sum(v for _, v in rows))', starter_code: '', test_cases: stdinTests }, 'sandbox');
  assert(has(bad, 'stdin'), 'unread stdin not caught');
  const saysIt = lotWordingProblems({ title: 'Split', scenario: SPLIT + ' Read the input lines from stdin.', test_cases: stdinTests }, 'sandbox');
  assert(!has(saysIt, 'stdin'), 'task that says read stdin was rejected');
  const reads = lotWordingProblems({ title: 'Split', scenario: SPLIT, starter_code: 'import sys\ndata = sys.stdin.read()', test_cases: stdinTests }, 'sandbox');
  assert(!has(reads, 'stdin'), 'starter that reads stdin was rejected');
});

Deno.test('sweep S15: third-person "the student must" is sent back for a rewrite', () => {
  const text = 'You help a team.\nYour task: The student must explain why the query works.\nWhat to write: 100-200 words in the answer box explaining it.';
  const p = lotWordingProblems({ title: 'Explain a query', scenario: text + ' '.repeat(10) + 'Extra context so the task is long enough to read well.' }, 'rubric');
  if (!p.some((x) => x.includes('third person'))) throw new Error(JSON.stringify(p));
});
