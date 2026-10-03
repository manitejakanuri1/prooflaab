import { lotWordingProblems } from './lot-wording.ts';

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
