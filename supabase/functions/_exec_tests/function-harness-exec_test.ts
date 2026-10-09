/**
 * The function-mode harness, really compiled and really run.
 *
 * Why this exists (S36): the Java harness contained a quote-escaping mistake, so it never compiled. Every Java
 * coding question was rejected at generation ("FUNCTION DRAFT REJECTED" three times, then 503) and a student on
 * staging saw "couldn't load the coding problems". The other harness tests only looked at the generated text.
 *
 * For every language and every value type this builds the harness around the platform's own starter code,
 * compiles and runs it with the same commands as code-runner/server.py, and requires a valid result frame.
 * For Python, JavaScript and Java it also sends a string full of quotes, backslashes and control characters
 * through a real implementation and requires it back unchanged.
 *
 * Needs --allow-read --allow-write --allow-run --allow-env, so it is NOT in _shared/ (that step runs without
 * them). A missing toolchain is skipped, unless REQUIRE_TOOLCHAINS names it (CI does), in which case it fails.
 */
import { buildFunctionHarness, extractFunctionResult } from "../_shared/function-harness.ts";
import { FUNCTION_VALUE_TYPES, type FunctionSpec, type FunctionValueType, parseFunctionSpec } from "../_shared/function-mode.ts";
import { functionStarterCode } from "../_shared/function-starter.ts";

const TOKEN = "0123456789abcdef0123456789abcdef";
const REQUIRED = new Set((Deno.env.get("REQUIRE_TOOLCHAINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean));

type Plan = { file: string; probe: string[]; compile?: string[]; run: string[] };
// The commands of code-runner/server.py plan(), minus the memory flags.
const PLANS: Record<string, Plan> = {
  python: { file: "main.py", probe: ["python3", "--version"], run: ["python3", "main.py"] },
  javascript: { file: "main.js", probe: ["node", "--version"], run: ["node", "main.js"] },
  ruby: { file: "main.rb", probe: ["ruby", "--version"], run: ["ruby", "main.rb"] },
  php: { file: "main.php", probe: ["php", "--version"], run: ["php", "main.php"] },
  c: { file: "main.c", probe: ["gcc", "--version"], compile: ["gcc", "-O2", "-o", "main", "main.c", "-lm"], run: ["./main"] },
  cpp: { file: "main.cpp", probe: ["g++", "--version"], compile: ["g++", "-O2", "-std=c++17", "-o", "main", "main.cpp"], run: ["./main"] },
  go: { file: "main.go", probe: ["go", "version"], compile: ["go", "build", "-o", "main", "main.go"], run: ["./main"] },
  java: { file: "__ProofLabMain.java", probe: ["javac", "-version"], compile: ["javac", "__ProofLabMain.java"], run: ["java", "-cp", ".", "__ProofLabMain"] },
};
// Windows has "python", not "python3" (local runs only; CI is Linux).
if (Deno.build.os === "windows") {
  PLANS.python.probe[0] = "python";
  PLANS.python.run[0] = "python";
}

async function exec(cmd: string[], cwd?: string, stdin = ""): Promise<{ code: number; out: string; err: string }> {
  try {
    const child = new Deno.Command(cmd[0], { args: cmd.slice(1), cwd, stdin: "piped", stdout: "piped", stderr: "piped" }).spawn();
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode(stdin));
    await w.close();
    const r = await child.output();
    return { code: r.code, out: new TextDecoder().decode(r.stdout), err: new TextDecoder().decode(r.stderr) };
  } catch (e) {
    return { code: -1, out: "", err: String(e) };
  }
}

const SAMPLE: Record<string, string> = {
  integer: "7", number: "1.5", boolean: "true", string: '"hi"',
};
const sampleFor = (type: FunctionValueType) =>
  type.startsWith("array<") ? `[${SAMPLE[type.slice(6, -1)]}]` : SAMPLE[type];

function specFor(language: string, name: string, param: FunctionValueType, ret: FunctionValueType): FunctionSpec {
  const spec = parseFunctionSpec({
    function_name: name,
    ...(language === "java" ? { class_name: "Solution" } : {}),
    parameters: [{ name: "x", type: param }],
    return_type: ret,
  });
  if (!spec) throw new Error(`fixture spec invalid: ${language} ${param} -> ${ret}`);
  return spec;
}

/** Builds, compiles and runs one harness; returns the extracted result JSON or throws with the compiler's words. */
async function runHarness(language: string, code: string, spec: FunctionSpec, args: string): Promise<string> {
  const plan = PLANS[language];
  const dir = await Deno.makeTempDir({ prefix: `plh-${language}-` });
  try {
    await Deno.writeTextFile(`${dir}/${plan.file}`, buildFunctionHarness(language, code, spec, args, TOKEN));
    if (plan.compile) {
      const c = await exec(plan.compile, dir);
      if (c.code !== 0) throw new Error(`${language} ${spec.return_type}: harness does not compile:\n${c.err.slice(0, 600)}`);
    }
    const run = plan.run[0].startsWith("./") ? [`${dir}/${plan.run[0].slice(2)}`] : plan.run;
    const r = await exec(run, dir, args);
    if (r.code !== 0) throw new Error(`${language} ${spec.return_type}: harness exited ${r.code}:\n${r.err.slice(0, 600)}`);
    const got = extractFunctionResult(r.out, TOKEN, spec.return_type);
    if (got === null) throw new Error(`${language} ${spec.return_type}: no valid result frame in stdout: ${r.out.slice(0, 200)}`);
    return got;
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
}

for (const language of Object.keys(PLANS)) {
  Deno.test(`${language}: the harness compiles and runs for every value type`, async (t) => {
    if ((await exec(PLANS[language].probe)).code !== 0) {
      if (REQUIRED.has(language)) throw new Error(`${language} toolchain is required here but missing`);
      console.log(`SKIPPED ${language}: toolchain not installed`);
      return;
    }
    for (const type of FUNCTION_VALUE_TYPES) {
      await t.step(type, async () => {
        const spec = specFor(language, "solve", type, type);
        // The platform's own starter: a complete, compilable stub that returns the type's default value.
        await runHarness(language, functionStarterCode(language, spec), spec, `[${sampleFor(type)}]`);
      });
    }
  });
}

// A string that breaks any serializer with a quoting mistake.
const NASTY = 'say "hi" \\ back\\slash\ttab\nnewline \u0001 end';
const ECHO: Record<string, string> = {
  python: "def mirror(x):\n    return x\n",
  javascript: "function mirror(x) { return x; }\n",
  java: "class Solution { String mirror(String x) { return x; } }\n",
};
for (const [language, code] of Object.entries(ECHO)) {
  Deno.test(`${language}: a string with quotes, backslashes and control characters comes back unchanged`, async () => {
    if ((await exec(PLANS[language].probe)).code !== 0) {
      if (REQUIRED.has(language)) throw new Error(`${language} toolchain is required here but missing`);
      console.log(`SKIPPED ${language}: toolchain not installed`);
      return;
    }
    const got = await runHarness(language, code, specFor(language, "mirror", "string", "string"), JSON.stringify([NASTY]));
    if (JSON.parse(got) !== NASTY) throw new Error(`${language}: echoed ${got}, wanted ${JSON.stringify(NASTY)}`);
  });
}
