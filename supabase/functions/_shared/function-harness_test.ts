import {
  buildFunctionHarness,
  extractFunctionResult,
  functionResultPrefix,
} from "./function-harness.ts";
import { parseFunctionSpec } from "./function-mode.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const TOKEN = "abc123def456xyz789";

const BASE = parseFunctionSpec({
  function_name: "add",
  parameters: [
    { name: "a", type: "integer" },
    { name: "b", type: "integer" },
  ],
  return_type: "integer",
});

if (!BASE) throw new Error("BASE spec invalid");

Deno.test("C2.2: builds a trusted harness for all eight runner languages", () => {
  const fixtures: Record<string, { code: string; spec: typeof BASE }> = {
    python: {
      code: "def add(a, b):\n    return a + b",
      spec: BASE,
    },
    javascript: {
      code: "function add(a,b){ return a+b; }",
      spec: BASE,
    },
    java: {
      code: "class Solution { int add(int a,int b){ return a+b; } }",
      spec: {
        ...BASE,
        class_name: "Solution",
      },
    },
    c: {
      code: "int add(int a, int b) { return a + b; }",
      spec: BASE,
    },
    cpp: {
      code: "int add(int a, int b) { return a + b; }",
      spec: BASE,
    },
    go: {
      code: "func add(a int, b int) int { return a + b }",
      spec: BASE,
    },
    ruby: {
      code: "def add(a,b)\n  a+b\nend",
      spec: BASE,
    },
    php: {
      code: "<?php function add($a,$b){ return $a+$b; }",
      spec: BASE,
    },
  };

  for (const [language, fixture] of Object.entries(fixtures)) {
    const built = buildFunctionHarness(
      language,
      fixture.code,
      fixture.spec,
      "[20,22]",
      TOKEN,
    );

    assert(
      built.includes(functionResultPrefix(TOKEN)),
      `${language}: missing trusted result prefix`,
    );

    assert(
      built.includes("add"),
      `${language}: function call missing`,
    );
  }
});

Deno.test("C2.2: class/method invocation is generated for supported languages", () => {
  const spec = parseFunctionSpec({
    function_name: "solve",
    class_name: "Solution",
    parameters: [{ name: "x", type: "integer" }],
    return_type: "integer",
  });

  assert(spec, "class spec rejected");

  for (const language of ["python", "javascript", "java", "ruby", "php"]) {
    const code = language === "java"
      ? "class Solution { int solve(int x){ return x; } }"
      : language === "cpp"
      ? "class Solution { public: int solve(int x){ return x; } };"
      : language === "python"
      ? "class Solution:\n    def solve(self, x): return x"
      : language === "javascript"
      ? "class Solution { solve(x){ return x; } }"
      : language === "ruby"
      ? "class Solution\n def solve(x); x; end\nend"
      : "<?php class Solution { function solve($x){ return $x; } }";

    const built = buildFunctionHarness(language, code, spec, "[7]", TOKEN);
    assert(built.includes("Solution"), `${language}: class invocation missing`);
  }
});

Deno.test("C2.2: C, C++ and Go refuse class mode; Java requires a class", () => {
  const classSpec = parseFunctionSpec({
    function_name: "solve",
    class_name: "Solution",
    parameters: [],
    return_type: "integer",
  });

  assert(classSpec, "class fixture invalid");

  for (const language of ["c", "cpp", "go"]) {
    let failed = false;
    try {
      buildFunctionHarness(language, "", classSpec, "[]", TOKEN);
    } catch {
      failed = true;
    }
    assert(failed, `${language}: class mode should be refused`);
  }

  const plain = parseFunctionSpec({
    function_name: "solve",
    parameters: [],
    return_type: "integer",
  });

  assert(plain, "plain fixture invalid");

  let javaFailed = false;
  try {
    buildFunctionHarness("java", "", plain, "[]", TOKEN);
  } catch {
    javaFailed = true;
  }

  assert(javaFailed, "java without class_name should be refused");
});

Deno.test("C2.2: result envelope requires one final trusted frame", () => {
  const prefix = functionResultPrefix(TOKEN);

  assert(
    extractFunctionResult(
      `debug\n${prefix}{"ok":true,"value":[2,7]}\n`,
      TOKEN,
      "array<integer>",
    ) === "[2,7]",
    "valid envelope was not extracted",
  );

  assert(
    extractFunctionResult(
      `${prefix}{"ok":true,"value":1}\nnoise\n`,
      TOKEN,
      "integer",
    ) === null,
    "non-final frame was accepted",
  );

  assert(
    extractFunctionResult(
      `${prefix}{"ok":true,"value":1}\n${prefix}{"ok":true,"value":1}\n`,
      TOKEN,
      "integer",
    ) === null,
    "duplicate frame was accepted",
  );

  assert(
    extractFunctionResult(
      `${prefix}1\n`,
      TOKEN,
      "integer",
    ) === null,
    "legacy raw payload was accepted",
  );
});

Deno.test("C2.2: result envelope type checks and canonicalizes", () => {
  const prefix = functionResultPrefix(TOKEN);

  assert(
    extractFunctionResult(
      `${prefix}{"ok":true,"value":42}\n`,
      TOKEN,
      "integer",
    ) === "42",
    "integer envelope failed",
  );

  assert(
    extractFunctionResult(
      `${prefix}{"ok":true,"value":"42"}\n`,
      TOKEN,
      "integer",
    ) === null,
    "wrong return type was accepted",
  );

  assert(
    extractFunctionResult(
      `${prefix}{"ok":true,"value":null}\n`,
      TOKEN,
      "integer",
    ) === null,
    "null return was accepted",
  );

  assert(
    extractFunctionResult(
      `${prefix}{"ok":true,"value":1,"extra":2}\n`,
      TOKEN,
      "integer",
    ) === null,
    "extra envelope key was accepted",
  );

  assert(
    extractFunctionResult(
      `${prefix}{"ok":false,"error":"type"}\n`,
      TOKEN,
      "integer",
    ) === null,
    "error envelope was graded as success",
  );
});

Deno.test("C2.2: integer contract is portable signed 32-bit", () => {
  const spec = parseFunctionSpec({
    function_name: "solve",
    parameters: [{ name: "x", type: "integer" }],
    return_type: "integer",
  });

  assert(spec, "integer fixture rejected");

  buildFunctionHarness(
    "python",
    "def solve(x): return x",
    spec,
    "[2147483647]",
    TOKEN,
  );

  let rejected = false;
  try {
    buildFunctionHarness(
      "python",
      "def solve(x): return x",
      spec,
      "[2147483648]",
      TOKEN,
    );
  } catch {
    rejected = true;
  }

  assert(rejected, "out-of-range integer was accepted");
});

Deno.test("C2.2: unsupported language and malformed tokens are refused", () => {
  let badLanguage = false;
  try {
    buildFunctionHarness("typescript", "", BASE, "[1,2]", TOKEN);
  } catch {
    badLanguage = true;
  }
  assert(badLanguage, "unsupported language accepted");

  let badToken = false;
  try {
    buildFunctionHarness(
      "python",
      "def add(a,b): return a+b",
      BASE,
      "[1,2]",
      "bad token",
    );
  } catch {
    badToken = true;
  }
  assert(badToken, "unsafe protocol token accepted");
});


Deno.test("C2-B2-A1 runtime stdin: dynamic harnesses do not embed test values", () => {
  const fixtures: Record<string, string> = {
    python: "def add(a,b): return a+b",
    javascript: "function add(a,b){ return a+b; }",
    ruby: "def add(a,b); a+b; end",
    php: "<?php function add($a,$b){ return $a+$b; }",
  };

  for (const [language, code] of Object.entries(fixtures)) {
    const built = buildFunctionHarness(
      language,
      code,
      BASE,
      "[123456789,987654321]",
      TOKEN,
    );

    assert(
      !built.includes("123456789") &&
        !built.includes("987654321"),
      `${language}: test arguments leaked into source`,
    );

    assert(
      built.includes("stdin") ||
        built.includes("STDIN") ||
        built.includes("readFileSync(0"),
      `${language}: runtime stdin reader missing`,
    );
  }
});


Deno.test("C2-B2-A2 Java and Go runtime stdin are test-independent", () => {
  const secretArgs = "[123456789,987654321]";

  const java = buildFunctionHarness(
    "java",
    "class Solution { int add(int a,int b){ return a+b; } }",
    { ...BASE, class_name: "Solution" },
    secretArgs,
    TOKEN,
  );

  assert(
    java.includes("final class __ProofLabMain"),
    "java trusted entrypoint missing",
  );

  assert(
    java.includes("System.in.readAllBytes()"),
    "java runtime stdin parser missing",
  );

  assert(
    !java.includes("123456789") &&
      !java.includes("987654321"),
    "java embedded test arguments in source",
  );

  const go = buildFunctionHarness(
    "go",
    "func add(a int, b int) int { return a + b }",
    BASE,
    secretArgs,
    TOKEN,
  );

  assert(
    go.includes("ReadAll(") &&
      go.includes("RawMessage"),
    "go runtime stdin parser missing",
  );

  assert(
    !go.includes("123456789") &&
      !go.includes("987654321"),
    "go embedded test arguments in source",
  );

  let javaPackageRejected = false;

  try {
    buildFunctionHarness(
      "java",
      "package bad; class Solution { int add(int a,int b){ return a+b; } }",
      { ...BASE, class_name: "Solution" },
      "[1,2]",
      TOKEN,
    );
  } catch {
    javaPackageRejected = true;
  }

  assert(
    javaPackageRejected,
    "java package declaration was accepted",
  );

  let goPackageRejected = false;

  try {
    buildFunctionHarness(
      "go",
      "package main\nfunc add(a int,b int) int { return a+b }",
      BASE,
      "[1,2]",
      TOKEN,
    );
  } catch {
    goPackageRejected = true;
  }

  assert(
    goPackageRejected,
    "go package declaration was accepted",
  );
});


Deno.test("C2-B2-A2 C and C++ runtime stdin are test-independent", () => {
  const secretArgs = "[123456789,987654321]";

  const c = buildFunctionHarness(
    "c",
    "#define fputs student_fputs\nint add(int a,int b){ return a+b; }",
    BASE,
    secretArgs,
    TOKEN,
  );

  assert(
    c.includes("__pl_read_all") &&
      c.includes("__pl_parse_int"),
    "C runtime JSON parser missing",
  );

  assert(
    !c.includes("123456789") &&
      !c.includes("987654321"),
    "C embedded test arguments in source",
  );

  assert(
    c.indexOf("int add(int, int);") <
      c.indexOf("#define fputs student_fputs"),
    "C trusted prototype was not isolated from student macros",
  );

  const cpp = buildFunctionHarness(
    "cpp",
    "#define int long long\nint add(int a,int b){ return a+b; }",
    BASE,
    secretArgs,
    TOKEN,
  );

  assert(
    cpp.includes("class __PLJson") &&
      cpp.includes("parseInt()"),
    "C++ runtime JSON parser missing",
  );

  assert(
    !cpp.includes("123456789") &&
      !cpp.includes("987654321"),
    "C++ embedded test arguments in source",
  );

  assert(
    cpp.indexOf("int add(int, int);") <
      cpp.indexOf("#define int long long"),
    "C++ trusted prototype was not isolated from student macros",
  );

  const classSpec = parseFunctionSpec({
    function_name: "solve",
    class_name: "Solution",
    parameters: [{ name: "x", type: "integer" }],
    return_type: "integer",
  });

  assert(classSpec, "C++ class rejection fixture invalid");

  let refused = false;

  try {
    buildFunctionHarness(
      "cpp",
      "class Solution { public: int solve(int x){ return x; } };",
      classSpec,
      "[7]",
      TOKEN,
    );
  } catch {
    refused = true;
  }

  assert(
    refused,
    "C++ class mode must be explicitly refused in v1",
  );
});
