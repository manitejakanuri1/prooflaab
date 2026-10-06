/**
 * Function-mode generation: the prompt schema and the parser that turns a
 * model reply into a function evaluator (spec + canonical JSON tests).
 *
 * The validators are passed in (auto-config.ts passes function-mode.ts's
 * parseFunctionSpec / canonicalFunctionArgumentsJson / canonicalFunctionValueJson),
 * so the same contract that grades a student also accepts or refuses a draft.
 * The model never supplies starter code, class names or a harness: the server
 * builds the starter from the frozen spec (function-starter.ts).
 */
import { functionClassNameFor, functionStarterCode, FUNCTION_LANGUAGES, type StarterSpec } from "./function-starter.ts";

export interface FunctionValidators<Spec extends StarterSpec = StarterSpec> {
  /** function-mode.ts parseFunctionSpec: the frozen spec, or null. */
  parseSpec(raw: unknown): Spec | null;
  /** function-mode.ts canonicalFunctionArgumentsJson: canonical args JSON, or null. */
  canonicalArgs(json: string, spec: Spec): string | null;
  /** function-mode.ts canonicalFunctionValueJson: canonical return JSON, or null. */
  canonicalValue(json: string, returnType: Spec["return_type"]): string | null;
}

export interface FunctionTestCase {
  id: string;
  stdin: string;            // canonical JSON array of arguments
  expected_output: string;  // canonical JSON return value
  visible: boolean;
  weight: number;
  kind?: "normal" | "boundary" | "edge";
  checker: "exact" | "numeric_tolerance";
  numeric_tolerance?: number;
}

export interface FunctionAttempt<Spec extends StarterSpec = StarterSpec> {
  kind: "function";
  language: string;
  function_spec: Spec;
  starter_code: string;
  constraints_text: string | null;
  reference_solution: string;
  buggy_solution: string;
  test_cases: FunctionTestCase[];
}

export const FUNCTION_SCHEMA = `"language": one of "python","javascript","java","cpp","c","go","ruby","php" - pick the one this task is written in/for,
"function_spec": {"function_name": string, "parameters": [{"name": string, "type": T}], "return_type": T}
  where T is one of "integer","number","boolean","string","array<integer>","array<number>","array<boolean>","array<string>".
  Names: start with a lowercase letter, then letters and digits only (camelCase, no underscores), not a keyword of any common language. 0 to 8 parameters, all names different.
  "integer" is a 32-bit signed integer; "number" is any finite decimal number.
"constraints_text": string or null,
"reference_solution": a COMPLETE, CORRECT implementation of ONLY that function. It does not read input and does not print. No main function.
  Java: class Solution { public <type> <name>(<params>) { ... } } with no "public" before class and no main.
  C: types int, double, int (for boolean), const char * (string); arrays are structs PLIntArray/PLNumberArray/PLBoolArray/PLStringArray with fields data and len (already defined - do not redefine them); return arrays with malloc'd data.
  C++: free function using int, double, bool, string, vector<...> (std is already in scope), parameters by value.
  Go: plain func with int, float64, bool, string, []int, []float64, []bool, []string; return empty slices, never nil.
  Python, JavaScript, Ruby, PHP: a plain top-level function.
"test_cases": array of objects {"id": string, "args": JSON array with one value per parameter in order, "expected": the JSON value the function returns, "visible": boolean, "weight": integer 1-5, "kind": "normal" | "boundary" | "edge"}.
  How many: if the task has difficulty "Easy", create 4 to 5 tests; "Medium", 6 to 8; "Hard", 8 to 10. Do not pad with duplicate or meaningless tests.
  Cover: at least one normal case, one boundary case (smallest/largest allowed input, empty array, zero) and one edge case (duplicates, negatives, unusual but valid input).
  Every test has DIFFERENT args. Exactly 1 or 2 are "visible": true; the rest are hidden, and hidden tests are at least as many as visible ones.
  "expected" must be exactly what the reference implementation returns. Never use NaN or Infinity.
"buggy_solution": a plausible but WRONG implementation of the same function - the kind of mistake a student makes (off-by-one, ignores an edge case, hardcodes the example). Your hidden tests must make it fail.`;

const KINDS = new Set(["normal", "boundary", "edge"]);

/**
 * Parse a function-mode reply. Returns null if anything is off: an unknown
 * language, a spec the contract refuses, a test whose args or expected value do
 * not match the spec, missing reference/buggy solutions, or more than 10 tests.
 */
export function parseFunctionFields<Spec extends StarterSpec>(
  parsed: Record<string, unknown>,
  v: FunctionValidators<Spec>,
): FunctionAttempt<Spec> | null {
  const language = String(parsed.language ?? "");
  if (!(FUNCTION_LANGUAGES as readonly string[]).includes(language)) return null;

  // The class is the server's choice, never the model's.
  const rawSpec = parsed.function_spec;
  if (!rawSpec || typeof rawSpec !== "object" || Array.isArray(rawSpec)) return null;
  const { class_name: _ignored, ...specWithoutClass } = rawSpec as Record<string, unknown>;
  const className = functionClassNameFor(language);
  const spec = v.parseSpec(className ? { ...specWithoutClass, class_name: className } : specWithoutClass);
  if (!spec) return null;

  const reference_solution = typeof parsed.reference_solution === "string" ? parsed.reference_solution : "";
  const buggy_solution = typeof parsed.buggy_solution === "string" ? parsed.buggy_solution : "";
  if (!reference_solution.trim() || !buggy_solution.trim()) return null;

  const rawTests = Array.isArray(parsed.test_cases) ? parsed.test_cases : [];
  if (rawTests.length < 1 || rawTests.length > 10) return null;

  const test_cases: FunctionTestCase[] = [];
  for (const t of rawTests as Record<string, unknown>[]) {
    if (typeof t?.id !== "string" || !Array.isArray(t.args) || !("expected" in t)) return null;
    const stdin = v.canonicalArgs(JSON.stringify(t.args), spec);
    const expected = t.expected === undefined ? null : v.canonicalValue(JSON.stringify(t.expected), spec.return_type);
    if (stdin === null || expected === null) return null;
    const tolerance = Number(t.numeric_tolerance);
    const useTolerance = spec.return_type === "number" && t.checker === "numeric_tolerance";
    test_cases.push({
      id: t.id,
      stdin,
      expected_output: expected,
      visible: Boolean(t.visible),
      weight: Number.isFinite(Number(t.weight)) ? Math.max(1, Math.min(5, Math.round(Number(t.weight)))) : 1,
      ...(KINDS.has(String(t.kind)) ? { kind: t.kind as FunctionTestCase["kind"] } : {}),
      checker: useTolerance ? "numeric_tolerance" : "exact",
      ...(useTolerance
        ? { numeric_tolerance: Number.isFinite(tolerance) && tolerance > 0 ? Math.min(tolerance, 0.001) : 0.000001 }
        : {}),
    });
  }
  if (!test_cases.some((t) => t.visible)) test_cases[0].visible = true;

  return {
    kind: "function",
    language,
    function_spec: spec,
    starter_code: functionStarterCode(language, spec),
    constraints_text: typeof parsed.constraints_text === "string" ? parsed.constraints_text : null,
    reference_solution,
    buggy_solution,
    test_cases,
  };
}

/**
 * The task_sandbox_config row for a generated evaluator. A stdio row is exactly
 * what it always was (no kind, no function_spec - the column defaults apply);
 * a function row adds kind and the frozen spec.
 */
export function sandboxConfigRow(
  attempt: {
    kind?: "stdio" | "function";
    language: string;
    starter_code: string;
    constraints_text: string | null;
    test_cases: unknown[];
    reference_solution: string;
    function_spec?: unknown;
  },
  createdBy: string | null | undefined,
  passThreshold: number,
  origin: string,
): Record<string, unknown> {
  return {
    language: attempt.language,
    starter_code: attempt.starter_code,
    constraints_text: attempt.constraints_text,
    test_cases: attempt.test_cases,
    reference_solution: attempt.reference_solution,
    pass_threshold: passThreshold,
    created_by: createdBy ?? null,
    origin,
    ...(attempt.kind === "function" ? { kind: "function", function_spec: attempt.function_spec } : {}),
  };
}
