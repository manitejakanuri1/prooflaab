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
  assertEquals(signatureLine("cpp", twoArgs), "vector<int> pairSum(vector<int> nums, int target)");
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
