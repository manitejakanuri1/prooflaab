/**
 * Deterministic starter code and display signature for a function-mode task,
 * built by the server from the frozen function_spec - never taken from AI text.
 *
 * The shapes match the function harness: Java uses an instance method on the
 * spec's class (Solution); C uses the PLIntArray/PLNumberArray/PLBoolArray/
 * PLStringArray structs the harness defines; C++ takes and returns std types by
 * value; every other language uses a plain top-level function.
 *
 * The browser has its own copy of signatureLine (src/lib/functionSignature.ts);
 * function-starter_test.ts checks the two agree.
 */

export type ValueType =
  | "integer" | "number" | "boolean" | "string"
  | "array<integer>" | "array<number>" | "array<boolean>" | "array<string>";

export interface StarterSpec {
  function_name: string;
  class_name?: string;
  parameters: { name: string; type: ValueType }[];
  return_type: ValueType;
}

export const FUNCTION_LANGUAGES = ["python", "javascript", "java", "c", "cpp", "go", "ruby", "php"] as const;

/** The class the generator gives each language: Java needs one, the others use a plain function. */
export function functionClassNameFor(language: string): string | undefined {
  return language === "java" ? "Solution" : undefined;
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
  cpp: {
    integer: "int", number: "double", boolean: "bool", string: "string",
    "array<integer>": "vector<int>", "array<number>": "vector<double>", "array<boolean>": "vector<bool>", "array<string>": "vector<string>",
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

const DEFAULTS: Record<string, Record<ValueType, string>> = {
  python: {
    integer: "0", number: "0.0", boolean: "False", string: '""',
    "array<integer>": "[]", "array<number>": "[]", "array<boolean>": "[]", "array<string>": "[]",
  },
  javascript: {
    integer: "0", number: "0", boolean: "false", string: '""',
    "array<integer>": "[]", "array<number>": "[]", "array<boolean>": "[]", "array<string>": "[]",
  },
  java: {
    integer: "0", number: "0.0", boolean: "false", string: '""',
    "array<integer>": "new int[0]", "array<number>": "new double[0]", "array<boolean>": "new boolean[0]", "array<string>": "new String[0]",
  },
  c: {
    integer: "0", number: "0.0", boolean: "0", string: '""',
    "array<integer>": "(PLIntArray){ NULL, 0 }", "array<number>": "(PLNumberArray){ NULL, 0 }",
    "array<boolean>": "(PLBoolArray){ NULL, 0 }", "array<string>": "(PLStringArray){ NULL, 0 }",
  },
  cpp: {
    integer: "0", number: "0.0", boolean: "false", string: '""',
    "array<integer>": "{}", "array<number>": "{}", "array<boolean>": "{}", "array<string>": "{}",
  },
  go: {
    // An empty slice, never nil: nil would encode as null and fail the type check.
    integer: "0", number: "0", boolean: "false", string: '""',
    "array<integer>": "[]int{}", "array<number>": "[]float64{}", "array<boolean>": "[]bool{}", "array<string>": "[]string{}",
  },
  ruby: {
    integer: "0", number: "0.0", boolean: "false", string: '""',
    "array<integer>": "[]", "array<number>": "[]", "array<boolean>": "[]", "array<string>": "[]",
  },
  php: {
    integer: "0", number: "0.0", boolean: "false", string: '""',
    "array<integer>": "[]", "array<number>": "[]", "array<boolean>": "[]", "array<string>": "[]",
  },
};

/** Comment-friendly type names for the untyped languages. */
const PLAIN: Record<ValueType, string> = {
  integer: "integer", number: "number", boolean: "boolean", string: "string",
  "array<integer>": "integer[]", "array<number>": "number[]", "array<boolean>": "boolean[]", "array<string>": "string[]",
};

/** The one-line signature shown to the student (and the first line of the starter). */
export function signatureLine(language: string, spec: StarterSpec): string {
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
      throw new Error(`unsupported function language: ${language}`);
  }
}

function typeComment(spec: StarterSpec): string {
  const params = spec.parameters.map((p) => `${p.name}: ${PLAIN[p.type]}`).join(", ");
  return `${params || "no arguments"} -> returns ${PLAIN[spec.return_type]}`;
}

/** Starter code that compiles and returns the return type's empty value. */
export function functionStarterCode(language: string, spec: StarterSpec): string {
  const sig = signatureLine(language, spec);
  const ret = DEFAULTS[language]?.[spec.return_type];
  if (ret === undefined) throw new Error(`unsupported function language: ${language}`);
  const note = "Write your code here. Keep the name and parameters exactly as given.";
  switch (language) {
    case "python":
      return `${sig}\n    # ${note}\n    return ${ret}\n`;
    case "javascript":
      return `// ${typeComment(spec)}\n${sig} {\n  // ${note}\n  return ${ret};\n}\n`;
    case "java": {
      const cls = spec.class_name ?? "Solution";
      return `class ${cls} {\n    ${sig} {\n        // ${note}\n        return ${ret};\n    }\n}\n`;
    }
    case "c":
      return `// Arrays arrive as { data, len }. Return an array with malloc'd data and its len.\n${sig} {\n    // ${note}\n    return ${ret};\n}\n`;
    case "cpp":
      return `${sig} {\n    // ${note}\n    return ${ret};\n}\n`;
    case "go":
      return `${sig} {\n\t// ${note}\n\treturn ${ret}\n}\n`;
    case "ruby":
      return `# ${typeComment(spec)}\n${sig}\n  # ${note}\n  ${ret}\nend\n`;
    case "php":
      return `<?php\n// ${typeComment(spec)}\n${sig} {\n    // ${note}\n    return ${ret};\n}\n`;
    default:
      throw new Error(`unsupported function language: ${language}`);
  }
}
