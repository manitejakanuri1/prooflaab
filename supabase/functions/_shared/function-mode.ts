/**
 * ProofLab function/method evaluator contract.
 *
 * First production version:
 * - JSON-compatible scalars and flat arrays only.
 * - portable signed int32 integer semantics.
 * - deterministic size limits.
 * - no executable harness/checker fields in FunctionSpec.
 */

export const FUNCTION_VALUE_TYPES = [
  "integer",
  "number",
  "boolean",
  "string",
  "array<integer>",
  "array<number>",
  "array<boolean>",
  "array<string>",
] as const;

export type FunctionValueType = typeof FUNCTION_VALUE_TYPES[number];

export const FUNCTION_MODE_LIMITS = Object.freeze({
  max_identifier_chars: 64,
  max_parameters: 8,
  max_string_chars: 10_000,
  max_string_utf8_bytes: 16 * 1024,
  max_array_elements: 10_000,
  max_arguments_json_bytes: 32 * 1024,
  max_return_json_bytes: 32 * 1024,
});

export const FUNCTION_MODE_RESERVED_NAMES = [
  "abstract",
  "alignas",
  "alignof",
  "and",
  "append",
  "args",
  "arguments",
  "argv",
  "array",
  "as",
  "asm",
  "assert",
  "async",
  "auto",
  "await",
  "begin",
  "bool",
  "boolean",
  "break",
  "byte",
  "callable",
  "cap",
  "case",
  "catch",
  "chan",
  "char",
  "char16_t",
  "char32_t",
  "char8_t",
  "class",
  "clear",
  "clone",
  "close",
  "co_await",
  "co_return",
  "co_yield",
  "collections",
  "complex",
  "concept",
  "const",
  "consteval",
  "constexpr",
  "constinit",
  "constructor",
  "continue",
  "copy",
  "debugger",
  "declare",
  "decltype",
  "def",
  "default",
  "defer",
  "defined",
  "del",
  "delete",
  "die",
  "do",
  "double",
  "echo",
  "elif",
  "else",
  "elsif",
  "empty",
  "end",
  "enddeclare",
  "endfor",
  "endforeach",
  "endif",
  "endswitch",
  "endwhile",
  "ensure",
  "enum",
  "error",
  "eval",
  "except",
  "exception",
  "exit",
  "explicit",
  "export",
  "exports",
  "extends",
  "extern",
  "fallthrough",
  "false",
  "final",
  "finally",
  "float",
  "fn",
  "for",
  "foreach",
  "friend",
  "from",
  "func",
  "function",
  "global",
  "go",
  "goto",
  "if",
  "imag",
  "implements",
  "import",
  "in",
  "include",
  "include_once",
  "infinity",
  "init",
  "inline",
  "instanceof",
  "insteadof",
  "int",
  "integer",
  "interface",
  "iota",
  "is",
  "isset",
  "iterable",
  "json",
  "lambda",
  "len",
  "let",
  "list",
  "long",
  "main",
  "make",
  "map",
  "match",
  "math",
  "max",
  "min",
  "mixed",
  "module",
  "mutable",
  "namespace",
  "nan",
  "native",
  "never",
  "new",
  "next",
  "nil",
  "noexcept",
  "none",
  "nonlocal",
  "not",
  "null",
  "nullptr",
  "number",
  "object",
  "operator",
  "optional",
  "or",
  "out",
  "package",
  "panic",
  "parent",
  "pass",
  "payload",
  "permits",
  "print",
  "println",
  "private",
  "prooflab",
  "protected",
  "prototype",
  "public",
  "raise",
  "range",
  "readonly",
  "real",
  "record",
  "recover",
  "redo",
  "register",
  "require",
  "require_once",
  "requires",
  "rescue",
  "restrict",
  "result",
  "retry",
  "return",
  "rune",
  "runtimeexception",
  "scanner",
  "sealed",
  "select",
  "self",
  "short",
  "signed",
  "sizeof",
  "static",
  "std",
  "stderr",
  "stdin",
  "stdout",
  "strictfp",
  "string",
  "struct",
  "super",
  "switch",
  "synchronized",
  "system",
  "template",
  "then",
  "this",
  "thread",
  "thread_local",
  "throw",
  "throws",
  "trait",
  "transient",
  "true",
  "try",
  "type",
  "typedef",
  "typeid",
  "typename",
  "typeof",
  "undef",
  "undefined",
  "union",
  "unless",
  "unset",
  "unsigned",
  "until",
  "using",
  "value",
  "var",
  "virtual",
  "void",
  "volatile",
  "wchar_t",
  "when",
  "while",
  "with",
  "write",
  "xor",
  "yield"
] as const;

const VALUE_TYPES = new Set<string>(FUNCTION_VALUE_TYPES);
const RESERVED = new Set<string>(FUNCTION_MODE_RESERVED_NAMES);

const FUNCTION_IDENTIFIER = /^[a-z][A-Za-z0-9]*$/;
const CLASS_IDENTIFIER = /^[A-Z][A-Za-z0-9]*$/;

const MIN_INTEGER = -2147483648;
const MAX_INTEGER = 2147483647;

export interface FunctionParameter {
  name: string;
  type: FunctionValueType;
}

export interface FunctionSpec {
  function_name: string;
  class_name?: string;
  parameters: FunctionParameter[];
  return_type: FunctionValueType;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function reservedIdentifier(value: string): boolean {
  const normalized = value.toLowerCase();
  return RESERVED.has(normalized) ||
    normalized.startsWith("__prooflab") ||
    normalized.startsWith("__pl");
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function validUnicodeString(value: string): boolean {
  if (
    value.length > FUNCTION_MODE_LIMITS.max_string_chars ||
    utf8Bytes(value) > FUNCTION_MODE_LIMITS.max_string_utf8_bytes ||
    value.includes("\u0000")
  ) {
    return false;
  }

  // Reject lone UTF-16 surrogate code units. Proper pairs are allowed.
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);

    if (c >= 0xd800 && c <= 0xdbff) {
      if (i + 1 >= value.length) return false;
      const n = value.charCodeAt(i + 1);
      if (n < 0xdc00 || n > 0xdfff) return false;
      i++;
      continue;
    }

    if (c >= 0xdc00 && c <= 0xdfff) return false;
  }

  return true;
}

export function isFunctionValueType(
  value: unknown,
): value is FunctionValueType {
  return typeof value === "string" && VALUE_TYPES.has(value);
}

export function parseFunctionSpec(value: unknown): FunctionSpec | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const raw = value as Record<string, unknown>;

  if (
    !hasOnlyKeys(
      raw,
      new Set(["function_name", "class_name", "parameters", "return_type"]),
    )
  ) {
    return null;
  }

  if (
    typeof raw.function_name !== "string" ||
    raw.function_name.length > FUNCTION_MODE_LIMITS.max_identifier_chars ||
    !FUNCTION_IDENTIFIER.test(raw.function_name) ||
    reservedIdentifier(raw.function_name)
  ) {
    return null;
  }

  if (
    raw.class_name !== undefined &&
    raw.class_name !== null &&
    (
      typeof raw.class_name !== "string" ||
      raw.class_name.length > FUNCTION_MODE_LIMITS.max_identifier_chars ||
      !CLASS_IDENTIFIER.test(raw.class_name) ||
      reservedIdentifier(raw.class_name)
    )
  ) {
    return null;
  }

  if (
    !Array.isArray(raw.parameters) ||
    raw.parameters.length > FUNCTION_MODE_LIMITS.max_parameters
  ) {
    return null;
  }

  if (!isFunctionValueType(raw.return_type)) return null;

  const className = typeof raw.class_name === "string"
    ? raw.class_name
    : undefined;

  const parameters: FunctionParameter[] = [];
  const names = new Set<string>();

  for (const item of raw.parameters) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;

    const param = item as Record<string, unknown>;

    if (
      !hasOnlyKeys(param, new Set(["name", "type"])) ||
      typeof param.name !== "string" ||
      param.name.length > FUNCTION_MODE_LIMITS.max_identifier_chars ||
      !FUNCTION_IDENTIFIER.test(param.name) ||
      reservedIdentifier(param.name) ||
      names.has(param.name.toLowerCase()) ||
      param.name.toLowerCase() === raw.function_name.toLowerCase() ||
      (
        className !== undefined &&
        param.name.toLowerCase() === className.toLowerCase()
      ) ||
      !isFunctionValueType(param.type)
    ) {
      return null;
    }

    names.add(param.name.toLowerCase());

    parameters.push({
      name: param.name,
      type: param.type,
    });
  }

  return {
    function_name: raw.function_name,
    ...(className ? { class_name: className } : {}),
    parameters,
    return_type: raw.return_type,
  };
}

export function canonicalFunctionArgumentsJson(
  stdin: string,
  spec: FunctionSpec,
): string | null {
  if (utf8Bytes(stdin) > FUNCTION_MODE_LIMITS.max_arguments_json_bytes) {
    return null;
  }

  let value: unknown;

  try {
    value = JSON.parse(stdin);
  } catch {
    return null;
  }

  if (!Array.isArray(value) || value.length !== spec.parameters.length) {
    return null;
  }

  for (let i = 0; i < value.length; i++) {
    if (!matchesFunctionValue(value[i], spec.parameters[i].type)) return null;
  }

  const encoded = JSON.stringify(value);

  if (
    encoded === undefined ||
    utf8Bytes(encoded) > FUNCTION_MODE_LIMITS.max_arguments_json_bytes
  ) {
    return null;
  }

  return encoded;
}

export function parseFunctionArguments(
  stdin: string,
  spec: FunctionSpec,
): unknown[] | null {
  const canonical = canonicalFunctionArgumentsJson(stdin, spec);
  if (canonical === null) return null;

  const value = JSON.parse(canonical);
  return Array.isArray(value) ? value : null;
}

export function canonicalFunctionValueJson(
  text: string,
  type: FunctionValueType,
): string | null {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  if (!matchesFunctionValue(value, type)) return null;

  const encoded = JSON.stringify(value);

  if (
    encoded === undefined ||
    utf8Bytes(encoded) > FUNCTION_MODE_LIMITS.max_return_json_bytes
  ) {
    return null;
  }

  return encoded;
}

export function matchesFunctionValue(
  value: unknown,
  type: FunctionValueType,
): boolean {
  switch (type) {
    case "integer":
      return typeof value === "number" &&
        Number.isFinite(value) &&
        Number.isInteger(value) &&
        value >= MIN_INTEGER &&
        value <= MAX_INTEGER;

    case "number":
      return typeof value === "number" && Number.isFinite(value);

    case "boolean":
      return typeof value === "boolean";

    case "string":
      return typeof value === "string" && validUnicodeString(value);

    case "array<integer>":
      return Array.isArray(value) &&
        value.length <= FUNCTION_MODE_LIMITS.max_array_elements &&
        value.every((x) =>
          typeof x === "number" &&
          Number.isFinite(x) &&
          Number.isInteger(x) &&
          x >= MIN_INTEGER &&
          x <= MAX_INTEGER
        );

    case "array<number>":
      return Array.isArray(value) &&
        value.length <= FUNCTION_MODE_LIMITS.max_array_elements &&
        value.every((x) => typeof x === "number" && Number.isFinite(x));

    case "array<boolean>":
      return Array.isArray(value) &&
        value.length <= FUNCTION_MODE_LIMITS.max_array_elements &&
        value.every((x) => typeof x === "boolean");

    case "array<string>":
      return Array.isArray(value) &&
        value.length <= FUNCTION_MODE_LIMITS.max_array_elements &&
        value.every((x) => typeof x === "string" && validUnicodeString(x));
  }
}
