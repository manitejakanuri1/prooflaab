// Test-set quality gate for generated coding evaluators.
//
// "The reference solution passes" proves the tests are CONSISTENT, not that they
// are any good: on 3 Oct 2026 a live config had every test with empty stdin and
// the same expected output, so a program that printed one constant string passed
// every hidden test. A test set is accepted only if obviously wrong programs FAIL
// it - real execution on ProofLab's own runner, never an AI's opinion.
//
// The idea of normal / boundary / edge cases and of scaling the number of tests
// to the problem is borrowed (concept only, no code) from the AutoTestCase
// repository reviewed on 3 Oct. Its AI-simulated pass/fail is deliberately NOT
// used: every verdict here comes from running the code.

import { gradeTests, type SandboxTest } from './sandbox.ts';

export interface QualityResult {
  ok: boolean;
  /** One plain sentence per problem, fed back to the generator on a retry. */
  problems: string[];
}

/** A program that prints `text` and ignores its input. */
export function constantProgram(language: string, text: string): string | null {
  // A JSON string literal is also a valid double-quoted literal in Python, JS,
  // C, C++, Go and Java. Ruby would interpolate "#{", and PHP "$", so those two
  // get their own escaping.
  const lit = JSON.stringify(text);
  switch (language) {
    case 'python': return `import sys\nsys.stdout.write(${lit})`;
    case 'javascript': return `process.stdout.write(${lit})`;
    case 'ruby': return `$stdout.write(${lit.replace(/#/g, '\\#')})`;
    case 'php': return `<?php echo '${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}';`;
    case 'c': return `#include <stdio.h>\nint main(){fputs(${lit}, stdout);return 0;}`;
    case 'cpp': return `#include <iostream>\nint main(){std::cout<<${lit};return 0;}`;
    case 'go': return `package main\nimport "fmt"\nfunc main(){fmt.Print(${lit})}`;
    case 'java': return `class Main{public static void main(String[] a){System.out.print(${lit});}}`;
    default: return null;
  }
}

/** A program that copies stdin to stdout. */
export function echoProgram(language: string): string | null {
  switch (language) {
    case 'python': return 'import sys\nsys.stdout.write(sys.stdin.read())';
    case 'javascript': return "process.stdout.write(require('fs').readFileSync(0,'utf-8'))";
    case 'ruby': return '$stdout.write($stdin.read)';
    case 'php': return '<?php echo stream_get_contents(STDIN);';
    case 'c': return '#include <stdio.h>\nint main(){int c;while((c=getchar())!=EOF)putchar(c);return 0;}';
    case 'cpp': return '#include <iostream>\nint main(){std::cout<<std::cin.rdbuf();return 0;}';
    case 'go': return 'package main\nimport ("io";"os")\nfunc main(){io.Copy(os.Stdout, os.Stdin)}';
    case 'java': return 'class Main{public static void main(String[] a)throws Exception{System.in.transferTo(System.out);}}';
    default: return null;
  }
}

/** Shape checks that need no runner. Exported for unit tests. */
export function structuralProblems(tests: SandboxTest[], difficulty?: string): string[] {
  const problems: string[] = [];
  const visible = tests.filter((t) => t.visible).length;
  const hidden = tests.length - visible;
  if (tests.length < 3) problems.push(`Only ${tests.length} test(s); write at least 3.`);
  if (visible < 1) problems.push('No visible test; mark one example as visible.');
  if (hidden < 1) problems.push('No hidden test; at least one test must be hidden.');
  if (hidden < visible) problems.push('More visible than hidden tests; hidden tests must be at least as many.');

  // Until the runner batches tests in one sandbox, keep the evaluator bounded
  // while still scaling test depth with the declared problem difficulty.
  const countRanges: Record<string, [number, number]> = {
    Easy: [4, 5],
    Medium: [6, 8],
    Hard: [8, 10],
  };
  const countRange = difficulty ? countRanges[difficulty] : undefined;
  if (countRange) {
    const [minTests, maxTests] = countRange;
    if (tests.length < minTests || tests.length > maxTests) {
      problems.push(
        `${difficulty} coding tasks require ${minTests}-${maxTests} tests; received ${tests.length}.`,
      );
    }
  }

  // Every generated coding evaluator must deliberately cover the basic
  // semantic test taxonomy. Merely having several distinct inputs does not
  // prove that boundary or edge behaviour is tested.
  const kinds = new Set(
    tests
      .map((t) => t.kind)
      .filter((k): k is string => typeof k === 'string'),
  );
  for (const required of ['normal', 'boundary', 'edge']) {
    if (!kinds.has(required)) {
      problems.push(`Missing ${required} test; generated coding evaluators must include normal, boundary and edge coverage.`);
    }
  }

  const inputs = new Set(tests.map((t) => t.stdin.trim()));
  if (tests.length >= 2 && inputs.size < Math.min(3, tests.length)) {
    problems.push(`Only ${inputs.size} distinct input(s) across ${tests.length} tests; each test needs a different input.`);
  }
  const outputs = new Set(tests.map((t) => t.expected_output.trim()));
  if (tests.length >= 2 && outputs.size === 1) {
    problems.push('Every test expects the same output, so printing that one value passes everything.');
  }
  return problems;
}

/**
 * Full gate: structure, then known-wrong programs that must each fail at least
 * one test. `buggySolution`, when the generator supplied one, must fail too.
 * Returns ok:false with reasons; an unavailable runner is reported, never
 * treated as a pass.
 */
export async function checkTestQuality(
  language: string,
  tests: SandboxTest[],
  buggySolution?: string | null,
  difficulty?: string,
): Promise<QualityResult> {
  const problems = structuralProblems(tests, difficulty);
  if (problems.length) return { ok: false, problems };

  const firstVisible = tests.find((t) => t.visible) ?? tests[0];
  const probes: Array<[string, string | null]> = [
    ['a program that always prints the first example\'s output', constantProgram(language, firstVisible.expected_output)],
    ['a program that prints nothing', constantProgram(language, '')],
    ['a program that echoes its input', echoProgram(language)],
  ];
  if (buggySolution && buggySolution.trim()) probes.push(['the deliberately buggy solution', buggySolution]);

  for (const [label, program] of probes) {
    if (!program) continue;
    const graded = await gradeTests(language, program, tests);
    if (!graded.ok) return { ok: false, problems: [`Could not check test quality: ${graded.reason}`] };
    if (graded.passedCount === tests.length) {
      problems.push(`${label} passes every test; add tests that tell a correct solution apart from it.`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/** What checkFunctionTestQuality needs back from one graded run. */
export interface ProbeGrade {
  ok: boolean;
  reason?: string;
  results?: { visible: boolean; passed: boolean }[];
}

/**
 * Quality gate for a FUNCTION-mode test set (stdio sets keep checkTestQuality).
 * Same structure rules, plus: every test has a different argument list; the
 * server-built starter (it returns the empty value) must fail a test; and the
 * model's buggy solution must fail at least one HIDDEN test - a test set that
 * only the visible samples can tell apart from a wrong answer is too weak.
 *
 * `grade` runs one program against the tests (auto-config passes the real
 * function grader); an unavailable runner is reported, never treated as a pass.
 */
export async function checkFunctionTestQuality(
  tests: SandboxTest[],
  starterCode: string,
  buggySolution: string,
  difficulty: string | undefined,
  grade: (code: string) => Promise<ProbeGrade>,
): Promise<QualityResult> {
  const problems = structuralProblems(tests, difficulty);
  if (tests.filter((t) => t.visible).length > 2) {
    problems.push('More than 2 visible tests; show exactly 1 or 2 examples and keep the rest hidden.');
  }
  if (new Set(tests.map((t) => t.stdin)).size !== tests.length) {
    problems.push('Two tests have the same arguments; every test needs different arguments.');
  }
  if (problems.length) return { ok: false, problems };

  const starter = await grade(starterCode);
  if (!starter.ok || !starter.results) {
    return { ok: false, problems: [`Could not check test quality: ${starter.reason ?? 'runner unavailable'}`] };
  }
  if (starter.results.every((r) => r.passed)) {
    problems.push('A function that only returns the empty/zero value passes every test; add tests with other answers.');
  }

  const buggy = await grade(buggySolution);
  if (!buggy.ok || !buggy.results) {
    return { ok: false, problems: [`Could not check test quality: ${buggy.reason ?? 'runner unavailable'}`] };
  }
  if (!buggy.results.some((r) => !r.visible && !r.passed)) {
    problems.push('The deliberately buggy solution passes every hidden test; add hidden tests that catch it.');
  }
  return { ok: problems.length === 0, problems };
}
