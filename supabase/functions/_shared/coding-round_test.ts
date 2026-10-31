import { assertEquals } from "jsr:@std/assert@1";
import { sameProblem, scoreWithoutFreeTests } from "./coding-round.ts";

Deno.test("same title, prompt or function name is the same problem", () => {
  assertEquals(sameProblem({ title: "Count Vowels" }, { title: "count  vowels!" }), true);
  assertEquals(sameProblem({ prompt: "Return the sum." }, { prompt: "return the SUM" }), true);
  assertEquals(sameProblem({ function_name: "sum_list" }, { function_name: "sumList" }), true);
  assertEquals(sameProblem({ function_name: "sum_list" }, { function_name: "sum_list" }), true);
  assertEquals(sameProblem({ title: "Count Vowels", function_name: "a" }, { title: "Reverse Words", function_name: "b" }), false);
  assertEquals(sameProblem({}, {}), false);
});

Deno.test("tests the starter passes are not scored", () => {
  const results = [
    { id: "t1", passed: true }, { id: "t2", passed: true },
    { id: "t3", passed: false }, { id: "t4", passed: false }, { id: "t5", passed: false },
  ];
  // Starter code submitted unchanged: it passes t1, t2 and nothing else -> 0 of 3.
  assertEquals(scoreWithoutFreeTests(results, 5, new Set(["t1", "t2"])), { pass_count: 0, total: 3, free: 2 });
  // A real answer passing everything still scores full marks.
  const all = results.map((r) => ({ ...r, passed: true }));
  assertEquals(scoreWithoutFreeTests(all, 5, new Set(["t1", "t2"])), { pass_count: 3, total: 3, free: 2 });
  // Starter unknown or passing nothing: unchanged.
  assertEquals(scoreWithoutFreeTests(results, 5, null), { pass_count: 2, total: 5, free: 0 });
  assertEquals(scoreWithoutFreeTests(results, 5, new Set()), { pass_count: 2, total: 5, free: 0 });
});

Deno.test('brokenProblem: a full statement naming the function passes', async () => {
  const { brokenProblem } = await import('./coding-round.ts');
  const ok = { prompt: 'Write count_vowels(s) that returns how many vowels s has. Example: count_vowels("apple") returns 2.',
               starter_code: 'def count_vowels(s):\n    return 0', kind: 'function', function_spec: { function_name: 'count_vowels' } };
  if (brokenProblem(ok) !== null) throw new Error('good problem flagged: ' + brokenProblem(ok));
});

Deno.test('brokenProblem: empty, no starter, function not named', async () => {
  const { brokenProblem } = await import('./coding-round.ts');
  const base = { starter_code: 'def f(x):\n    return 0', kind: 'function', function_spec: { function_name: 'f_total' } };
  const cases: [Record<string, unknown>, string][] = [
    [{ ...base, prompt: 'Sum' }, 'statement too short'],
    [{ ...base, prompt: 'Write f_total(nums) that returns the sum of all numbers in the list nums.', starter_code: '' }, 'no starter code'],
    [{ ...base, prompt: 'Write a function that returns the sum of all numbers in the given list.' }, 'function name not shown'],
  ];
  for (const [q, want] of cases) {
    const got = brokenProblem(q);
    if (got !== want) throw new Error(`expected ${want}, got ${got}`);
  }
});

Deno.test('brokenProblem: the function name shown only in the starter code is fine', async () => {
  const { brokenProblem } = await import('./coding-round.ts');
  const q = { prompt: 'Given a string s, return the number of vowels in s. Input: "Hello". Output: 2.',
              starter_code: 'def count_vowels(s):\n    return 0', kind: 'function', function_spec: { function_name: 'count_vowels' } };
  if (brokenProblem(q) !== null) throw new Error('flagged: ' + brokenProblem(q));
});
