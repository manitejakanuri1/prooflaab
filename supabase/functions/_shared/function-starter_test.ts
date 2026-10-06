import { FUNCTION_LANGUAGES, functionClassNameFor, functionStarterCode, signatureLine, type StarterSpec } from "./function-starter.ts";
import { signatureLine as browserSignatureLine } from "../../../src/lib/functionSignature.ts";

function assert(cond: boolean, msg = "assertion failed") {
  if (!cond) throw new Error(msg);
}
function assertEquals(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
}
function assertThrows(fn: () => unknown) {
  try { fn(); } catch { return; }
  throw new Error("expected an exception");
}

const twoArgs: StarterSpec = {
  function_name: "pairSum",
  parameters: [{ name: "nums", type: "array<integer>" }, { name: "target", type: "integer" }],
  return_type: "array<integer>",
};
const noArgs: StarterSpec = { function_name: "answer", parameters: [], return_type: "string" };
const allTypes: StarterSpec = {
  function_name: "mix",
  parameters: [
    { name: "a", type: "integer" }, { name: "b", type: "number" }, { name: "c", type: "boolean" }, { name: "d", type: "string" },
    { name: "e", type: "array<number>" }, { name: "f", type: "array<boolean>" }, { name: "g", type: "array<string>" },
  ],
  return_type: "boolean",
};

Deno.test("signatures per language", () => {
  assertEquals(signatureLine("python", twoArgs), "def pairSum(nums: list[int], target: int) -> list[int]:");
  assertEquals(signatureLine("javascript", twoArgs), "function pairSum(nums, target)");
  assertEquals(signatureLine("java", twoArgs), "public int[] pairSum(int[] nums, int target)");
  assertEquals(signatureLine("c", twoArgs), "PLIntArray pairSum(PLIntArray nums, int target)");
  assertEquals(signatureLine("cpp", twoArgs), "std::vector<int> pairSum(std::vector<int> nums, int target)");
  assertEquals(signatureLine("go", twoArgs), "func pairSum(nums []int, target int) []int");
  assertEquals(signatureLine("ruby", twoArgs), "def pairSum(nums, target)");
  assertEquals(signatureLine("php", twoArgs), "function pairSum($nums, $target)");
  assertEquals(signatureLine("c", noArgs), "const char * answer(void)");
  assertThrows(() => signatureLine("rust", twoArgs));
});

Deno.test("starter code: built from the spec, compiles to the empty value, keeps the signature", () => {
  for (const language of FUNCTION_LANGUAGES) {
    for (const spec of [twoArgs, noArgs, allTypes]) {
      const code = functionStarterCode(language, { ...spec, ...(functionClassNameFor(language) ? { class_name: "Solution" } : {}) });
      assert(code.includes(signatureLine(language, spec)), `${language}: starter must contain the exact signature`);
      assert(!/\binput\(|readline|stdin|scanf|Scanner|fmt\.Scan|gets\b/.test(code), `${language}: starter must not read input`);
    }
  }
  assert(functionStarterCode("java", { ...twoArgs, class_name: "Solution" }).startsWith("class Solution {"));
  assert(!functionStarterCode("java", { ...twoArgs, class_name: "Solution" }).includes("public class"));
  assert(functionStarterCode("go", twoArgs).includes("return []int{}"), "go must return an empty slice, never nil");
  assert(functionStarterCode("python", twoArgs).includes("return []"));
  assert(functionStarterCode("c", twoArgs).includes("(PLIntArray){ NULL, 0 }"));
  assert(functionStarterCode("php", twoArgs).startsWith("<?php"));
});

Deno.test("only Java gets a class, chosen by the server", () => {
  assertEquals(functionClassNameFor("java"), "Solution");
  for (const l of ["python", "javascript", "c", "cpp", "go", "ruby", "php"]) assertEquals(functionClassNameFor(l), undefined);
});

Deno.test("the browser's signature is the server's signature", () => {
  for (const language of FUNCTION_LANGUAGES) {
    for (const spec of [twoArgs, noArgs, allTypes]) {
      assertEquals(browserSignatureLine(language, spec), signatureLine(language, spec), language);
    }
  }
});

import { functionSourceProblem } from "./function-generation.ts";

const withClass = (language: string, spec: StarterSpec): StarterSpec =>
  functionClassNameFor(language) ? { ...spec, class_name: functionClassNameFor(language) } : spec;

Deno.test("B2-A ABI: C keeps PL* arrays by value, const char * strings, int booleans, (void), no main", () => {
  const c = functionStarterCode("c", allTypes);
  assert(c.includes("int mix(int a, double b, int c, const char * d, PLNumberArray e, PLBoolArray f, PLStringArray g)"), c);
  assertEquals(signatureLine("c", noArgs), "const char * answer(void)");
  assert(!/\bmain\s*\(|typedef|#include|scanf|stdin/.test(c), "C starter is the function only");
});

Deno.test("B2-A ABI: C++ is a free function with std:: types exactly as the harness prototype", () => {
  assertEquals(signatureLine("cpp", allTypes),
    "bool mix(int a, double b, bool c, std::string d, std::vector<double> e, std::vector<bool> f, std::vector<std::string> g)");
  assertEquals(signatureLine("cpp", twoArgs), "std::vector<int> pairSum(std::vector<int> nums, int target)");
  // Even if a spec carried a class name, the C++ starter never makes a class.
  const cpp = functionStarterCode("cpp", { ...twoArgs, class_name: "Solution" });
  assert(!/\bclass\b|\bstruct\b|\bmain\s*\(|#include|using namespace|cin/.test(cpp), cpp);
});

Deno.test("B2-A ABI: Go has no package line and no main; typed slices", () => {
  const go = functionStarterCode("go", allTypes);
  assert(!/^\s*package\b/m.test(go) && !/\bfunc\s+main\b/.test(go) && !/\bimport\b/.test(go), go);
  assertEquals(signatureLine("go", allTypes), "func mix(a int, b float64, c bool, d string, e []float64, f []bool, g []string) bool");
});

Deno.test("B2-A ABI: Java is class Solution with a public instance method, no main, no package, no __ProofLabMain", () => {
  const java = functionStarterCode("java", withClass("java", twoArgs));
  assert(java.startsWith("class Solution {\n    public int[] pairSum(int[] nums, int target) {"), java);
  assert(!/\bstatic\b|\bmain\s*\(|^\s*package\b|__ProofLabMain|public\s+class/m.test(java), java);
});

Deno.test("B2-A ABI: Python/JS/Ruby/PHP starters are a single top-level function, no I/O, no class", () => {
  for (const language of ["python", "javascript", "ruby", "php"]) {
    const code = functionStarterCode(language, twoArgs);
    assert(!/\bclass\b|input\(|readline|STDIN|\$stdin|gets\b|process\.stdin|print\(|console\.log|puts |echo /.test(code), `${language}: ${code}`);
  }
});

Deno.test("no starter carries harness names or a result marker", () => {
  for (const language of FUNCTION_LANGUAGES) {
    for (const spec of [twoArgs, noArgs, allTypes]) {
      assert(!/__prooflab|__PL|PROOFLAB_FUNCTION_RESULT/i.test(functionStarterCode(language, withClass(language, spec))), language);
    }
  }
});

Deno.test("every server starter passes the same function-only source rules applied to AI drafts", () => {
  for (const language of FUNCTION_LANGUAGES) {
    for (const spec of [twoArgs, noArgs, allTypes]) {
      assertEquals(functionSourceProblem(language, functionStarterCode(language, withClass(language, spec))), null, language);
    }
  }
});
