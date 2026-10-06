/**
 * Function-mode display helpers for coding tasks: the signature a student
 * implements, and visible examples shown as named arguments and a return value.
 *
 * signatureLine is a copy of the server's (supabase/functions/_shared/
 * function-starter.ts); function-starter_test.ts checks the two agree.
 */

export type ValueType =
  | "integer" | "number" | "boolean" | "string"
  | "array<integer>" | "array<number>" | "array<boolean>" | "array<string>";

export interface FunctionSpecView {
  function_name: string;
  class_name?: string;
  parameters: { name: string; type: ValueType }[];
  return_type: ValueType;
}

const TYPES: Record<"java" | "c" | "cpp" | "go" | "python", Record<ValueType, string>> = {
  java: {
    integer: "int", number: "double", boolean: "boolean", string: "String",
    "array<integer>": "int[]", "array<number>": "double[]", "array<boolean>": "boolean[]", "array<string>": "String[]",
  },
  c: {
    integer: "int", number: "double", boolean: "int", string: "const char *",
    "array<integer>": "PLIntArray", "array<number>": "PLNumberArray", "array<boolean>": "PLBoolArray", "array<string>": "PLStringArray",
  },
  // Exactly the harness prototype's types (function-harness.ts cppType).
  cpp: {
    integer: "int", number: "double", boolean: "bool", string: "std::string",
    "array<integer>": "std::vector<int>", "array<number>": "std::vector<double>",
    "array<boolean>": "std::vector<bool>", "array<string>": "std::vector<std::string>",
  },
  go: {
    integer: "int", number: "float64", boolean: "bool", string: "string",
    "array<integer>": "[]int", "array<number>": "[]float64", "array<boolean>": "[]bool", "array<string>": "[]string",
  },
  python: {
    integer: "int", number: "float", boolean: "bool", string: "str",
    "array<integer>": "list[int]", "array<number>": "list[float]", "array<boolean>": "list[bool]", "array<string>": "list[str]",
  },
};

/** The signature line in the task's language, e.g. `def twoSum(nums: list[int], k: int) -> int:`. */
export function signatureLine(language: string, spec: FunctionSpecView): string {
  const fn = spec.function_name;
  const ps = spec.parameters;
  switch (language) {
    case "python":
      return `def ${fn}(${ps.map((p) => `${p.name}: ${TYPES.python[p.type]}`).join(", ")}) -> ${TYPES.python[spec.return_type]}:`;
    case "javascript":
      return `function ${fn}(${ps.map((p) => p.name).join(", ")})`;
    case "java":
      return `public ${TYPES.java[spec.return_type]} ${fn}(${ps.map((p) => `${TYPES.java[p.type]} ${p.name}`).join(", ")})`;
    case "c":
      return `${TYPES.c[spec.return_type]} ${fn}(${ps.map((p) => `${TYPES.c[p.type]} ${p.name}`).join(", ") || "void"})`;
    case "cpp":
      return `${TYPES.cpp[spec.return_type]} ${fn}(${ps.map((p) => `${TYPES.cpp[p.type]} ${p.name}`).join(", ")})`;
    case "go":
      return `func ${fn}(${ps.map((p) => `${p.name} ${TYPES.go[p.type]}`).join(", ")}) ${TYPES.go[spec.return_type]}`;
    case "ruby":
      return `def ${fn}(${ps.map((p) => p.name).join(", ")})`;
    case "php":
      return `function ${fn}(${ps.map((p) => `$${p.name}`).join(", ")})`;
    default:
      return `${fn}(${ps.map((p) => p.name).join(", ")})`;
  }
}

/** A JSON value written for reading: `[1, 2]`, `"abc"`, `true`. */
export function formatValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`;
  return JSON.stringify(value) ?? String(value);
}

/** Canonical args JSON as named arguments: `nums = [1, 2], k = 3`. Falls back to the raw text. */
export function formatArguments(argsJson: string, spec: FunctionSpecView): string {
  try {
    const args = JSON.parse(argsJson);
    if (!Array.isArray(args) || args.length !== spec.parameters.length) return argsJson;
    if (args.length === 0) return "(no arguments)";
    return args.map((a, i) => `${spec.parameters[i].name} = ${formatValue(a)}`).join(", ");
  } catch {
    return argsJson;
  }
}

/** A canonical return value as readable text. Falls back to the raw text. */
export function formatReturn(valueJson: string): string {
  try {
    return formatValue(JSON.parse(valueJson));
  } catch {
    return valueJson;
  }
}

/** The view's spec when the task is function mode and the spec is well formed, else null (stdio). */
export function functionSpecOf(view: { kind?: string | null; function_spec?: unknown }): FunctionSpecView | null {
  if (view.kind !== "function") return null;
  const s = view.function_spec as Partial<FunctionSpecView> | null | undefined;
  if (!s || typeof s.function_name !== "string" || !Array.isArray(s.parameters) || typeof s.return_type !== "string") return null;
  return s as FunctionSpecView;
}

/** The single aggregate a Submit returns for hidden tests (no ids, inputs or outputs). */
export interface HiddenSummary {
  id: "hidden-summary";
  visible: false;
  verdict: "hidden";
  passed: boolean;
  hidden_count: number;
  hidden_passed: number;
  hidden_failed: number;
}

export function isHiddenSummary(r: unknown): r is HiddenSummary {
  const x = r as Partial<HiddenSummary> | null;
  return !!x && x.id === "hidden-summary" && typeof x.hidden_count === "number";
}

/** "3 of 4 hidden tests passed". */
export function hiddenSummaryText(s: HiddenSummary): string {
  return `${s.hidden_passed} of ${s.hidden_count} hidden test${s.hidden_count === 1 ? "" : "s"} passed`;
}

/**
 * The only rows a results list may render: every visible row, plus at most ONE
 * hidden summary with counts. A server summary is used as is; per-test hidden
 * rows (an older server) are collapsed into a computed summary, so their
 * stdin, expected, actual, stderr, id and verdict are never rendered.
 * A row is hidden only when it says `visible: false`.
 */
export function safeResultRows<T extends { visible?: boolean; passed: boolean }>(
  results: readonly (T | HiddenSummary)[] | null | undefined,
): (T | HiddenSummary)[] {
  if (!results) return [];
  const visible: T[] = [];
  let summary: HiddenSummary | null = null;
  let hiddenCount = 0;
  let hiddenPassed = 0;
  for (const r of results) {
    if (isHiddenSummary(r)) {
      summary = {
        id: "hidden-summary", visible: false, verdict: "hidden",
        passed: r.hidden_passed === r.hidden_count,
        hidden_count: r.hidden_count, hidden_passed: r.hidden_passed, hidden_failed: r.hidden_count - r.hidden_passed,
      };
    } else if ((r as T).visible === false) {
      hiddenCount++;
      if ((r as T).passed) hiddenPassed++;
    } else {
      visible.push(r as T);
    }
  }
  if (!summary && hiddenCount > 0) {
    summary = {
      id: "hidden-summary", visible: false, verdict: "hidden", passed: hiddenPassed === hiddenCount,
      hidden_count: hiddenCount, hidden_passed: hiddenPassed, hidden_failed: hiddenCount - hiddenPassed,
    };
  }
  return summary ? [...visible, summary] : visible;
}
