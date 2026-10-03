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
export function structuralProblems(tests: SandboxTest[]): string[] {
  const problems: string[] = [];
  const visible = tests.filter((t) => t.visible).length;
  const hidden = tests.length - visible;
  if (tests.length < 3) problems.push(`Only ${tests.length} test(s); write at least 3.`);
  if (visible < 1) problems.push('No visible test; mark one example as visible.');
  if (hidden < 1) problems.push('No hidden test; at least one test must be hidden.');
  if (hidden < visible) problems.push('More visible than hidden tests; hidden tests must be at least as many.');
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
): Promise<QualityResult> {
  const problems = structuralProblems(tests);
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
