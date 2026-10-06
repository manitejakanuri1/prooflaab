import {
  canonicalFunctionArgumentsJson,
  canonicalFunctionValueJson,
  FUNCTION_MODE_LIMITS,
  FUNCTION_MODE_RESERVED_NAMES,
  parseFunctionArguments,
  parseFunctionSpec,
} from "./function-mode.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("C2: accepts a safe LeetCode-style signature", () => {
  const spec = parseFunctionSpec({
    function_name: "twoSum",
    class_name: "Solution",
    parameters: [
      { name: "nums", type: "array<integer>" },
      { name: "target", type: "integer" },
    ],
    return_type: "array<integer>",
  });

  assert(spec, "valid function spec rejected");

  const args = parseFunctionArguments("[[2,7,11,15],9]", spec);
  assert(args !== null, "valid typed arguments rejected");
});

Deno.test("C2: rejects executable fields and malformed identifiers", () => {
  assert(parseFunctionSpec({
    function_name: "solve);system",
    parameters: [],
    return_type: "integer",
  }) === null, "injected function identifier accepted");

  assert(parseFunctionSpec({
    function_name: "two_sum",
    parameters: [],
    return_type: "integer",
  }) === null, "underscore function name accepted");

  assert(parseFunctionSpec({
    function_name: "Solve",
    parameters: [],
    return_type: "integer",
  }) === null, "uppercase-first function accepted");

  assert(parseFunctionSpec({
    function_name: "solve",
    parameters: [],
    return_type: "integer",
    harness: "evil()",
  }) === null, "unexpected executable field accepted");
});

Deno.test("C2: reserved names are refused", () => {
  for (const name of ["class", "main", "return", "system", "json"]) {
    assert(parseFunctionSpec({
      function_name: name,
      parameters: [],
      return_type: "integer",
    }) === null, `reserved function name accepted: ${name}`);
  }

  assert(parseFunctionSpec({
    function_name: "solve",
    class_name: "Main",
    parameters: [],
    return_type: "integer",
  }) === null, "reserved class Main accepted");

  assert(FUNCTION_MODE_RESERVED_NAMES.length > 50, "reserved list unexpectedly small");
});

Deno.test("C2: rejects unsupported types, duplicate names, and excessive arity", () => {
  assert(parseFunctionSpec({
    function_name: "solve",
    parameters: [{ name: "root", type: "TreeNode" }],
    return_type: "integer",
  }) === null, "unsupported TreeNode accepted");

  assert(parseFunctionSpec({
    function_name: "solve",
    parameters: [
      { name: "x", type: "integer" },
      { name: "x", type: "integer" },
    ],
    return_type: "integer",
  }) === null, "duplicate parameters accepted");

  assert(parseFunctionSpec({
    function_name: "solve",
    parameters: Array.from(
      { length: FUNCTION_MODE_LIMITS.max_parameters + 1 },
      (_, i) => ({ name: `p${i}`, type: "integer" }),
    ),
    return_type: "integer",
  }) === null, "excessive parameter count accepted");
});

Deno.test("C2: validates argument types and int32 range", () => {
  const spec = parseFunctionSpec({
    function_name: "solve",
    parameters: [
      { name: "count", type: "integer" },
      { name: "labels", type: "array<string>" },
      { name: "enabled", type: "boolean" },
    ],
    return_type: "string",
  });

  assert(spec, "fixture rejected");

  assert(
    parseFunctionArguments('[3,["a","b"],true]', spec) !== null,
    "correct arguments rejected",
  );

  assert(
    parseFunctionArguments('[3.5,["a","b"],true]', spec) === null,
    "fraction accepted for integer",
  );

  assert(
    parseFunctionArguments('[2147483648,["a"],true]', spec) === null,
    "int32 overflow accepted",
  );
});

Deno.test("C2: canonicalizes argument JSON", () => {
  const spec = parseFunctionSpec({
    function_name: "solve",
    parameters: [
      { name: "x", type: "integer" },
      { name: "names", type: "array<string>" },
    ],
    return_type: "integer",
  });

  assert(spec, "fixture rejected");

  assert(
    canonicalFunctionArgumentsJson(' [ 7 , [ "a", "b" ] ] ', spec) ===
      '[7,["a","b"]]',
    "arguments were not canonicalized",
  );
});

Deno.test("C2: rejects NUL and lone surrogate strings", () => {
  const spec = parseFunctionSpec({
    function_name: "echoText",
    parameters: [{ name: "text", type: "string" }],
    return_type: "string",
  });

  assert(spec, "fixture rejected");

  assert(
    parseFunctionArguments(JSON.stringify(["a\u0000b"]), spec) === null,
    "NUL string accepted",
  );

  assert(
    parseFunctionArguments('["\\ud800"]', spec) === null,
    "lone surrogate accepted",
  );

  assert(
    parseFunctionArguments(JSON.stringify(["emoji 😀"]), spec) !== null,
    "valid emoji rejected",
  );
});

Deno.test("C2: enforces argument and return size caps", () => {
  const spec = parseFunctionSpec({
    function_name: "echoText",
    parameters: [{ name: "text", type: "string" }],
    return_type: "string",
  });

  assert(spec, "fixture rejected");

  const huge = "x".repeat(FUNCTION_MODE_LIMITS.max_string_chars + 1);

  assert(
    parseFunctionArguments(JSON.stringify([huge]), spec) === null,
    "oversized input string accepted",
  );

  assert(
    canonicalFunctionValueJson(JSON.stringify(huge), "string") === null,
    "oversized return string accepted",
  );
});
