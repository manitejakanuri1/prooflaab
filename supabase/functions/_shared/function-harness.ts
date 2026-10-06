import {
  matchesFunctionValue,
  parseFunctionArguments,
  type FunctionSpec,
  type FunctionValueType,
} from "./function-mode.ts";

const LANGUAGES = new Set([
  "python",
  "javascript",
  "java",
  "c",
  "cpp",
  "go",
  "ruby",
  "php",
]);

const TOKEN_RE = /^[A-Za-z0-9_-]{12,96}$/;

function requireToken(token: string): void {
  if (!TOKEN_RE.test(token)) {
    throw new Error("invalid function harness result token");
  }
}

function helperSuffix(token: string): string {
  return token.replace(/[^A-Za-z0-9]/g, "").slice(0, 24);
}

export function functionResultPrefix(token: string): string {
  requireToken(token);
  return `__PROOFLAB_FUNCTION_RESULT_${token}__`;
}

/**
 * Accept student debug output, but require exactly one trusted result marker,
 * and require it to be the final non-empty line.
 *
 * The result is parsed as JSON, checked against the frozen return type, and
 * JSON-stringified again so language-specific formatting cannot affect grading.
 */
export function extractFunctionResult(
  stdout: string,
  token: string,
  returnType: FunctionValueType,
): string | null {
  const prefix = functionResultPrefix(token);
  const lines = stdout.replace(/\r\n/g, "\n").split("\n");

  const marked = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.startsWith(prefix));

  // Exactly one result frame is required.
  if (marked.length !== 1) return null;

  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === "") last--;

  // It must also be the final non-empty stdout line.
  if (last !== marked[0].index) return null;

  const payload = marked[0].line.slice(prefix.length);

  let decoded: unknown;
  try {
    decoded = JSON.parse(payload);
  } catch {
    return null;
  }

  if (
    decoded === null ||
    typeof decoded !== "object" ||
    Array.isArray(decoded)
  ) {
    return null;
  }

  const envelope = decoded as Record<string, unknown>;
  const keys = Object.keys(envelope).sort();

  if (envelope.ok === true) {
    if (
      keys.length !== 2 ||
      keys[0] !== "ok" ||
      keys[1] !== "value"
    ) {
      return null;
    }

    if (!matchesFunctionValue(envelope.value, returnType)) {
      return null;
    }

    return JSON.stringify(envelope.value);
  }

  if (envelope.ok === false) {
    if (
      keys.length !== 2 ||
      keys[0] !== "error" ||
      keys[1] !== "ok"
    ) {
      return null;
    }

    if (
      typeof envelope.error !== "string" ||
      !new Set([
        "type",
        "null",
        "nonfinite",
        "range",
      ]).has(envelope.error)
    ) {
      return null;
    }

    return null;
  }

  return null;
}

export function buildFunctionHarness(
  language: string,
  studentCode: string,
  spec: FunctionSpec,
  argumentsJson: string,
  token: string,
): string {
  if (!LANGUAGES.has(language)) {
    throw new Error(`unsupported function language: ${language}`);
  }

  requireToken(token);

  if (!parseFunctionArguments(argumentsJson, spec)) {
    throw new Error("invalid function arguments");
  }

  if (
    (language === "c" ||
      language === "cpp" ||
      language === "go") &&
    spec.class_name
  ) {
    throw new Error(`${language} function mode does not support class_name`);
  }

  if (language === "java" && !spec.class_name) {
    throw new Error("java function mode requires class_name");
  }

  switch (language) {
    case "python":
      return pythonHarness(studentCode, spec, token);
    case "javascript":
      return javascriptHarness(studentCode, spec, token);
    case "java":
      return javaHarness(studentCode, spec, token);
    case "c":
      return cHarness(studentCode, spec, token);
    case "cpp":
      return cppHarness(studentCode, spec, token);
    case "go":
      return goHarness(studentCode, spec, token);
    case "ruby":
      return rubyHarness(studentCode, spec, token);
    case "php":
      return phpHarness(studentCode, spec, token);
  }

  throw new Error("unreachable language");
}

function jsonString(value: string): string {
  const out = JSON.stringify(value);
  if (out === undefined) throw new Error("cannot encode string");
  return out.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function pythonLiteral(value: unknown): string {
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return jsonString(value);
  if (Array.isArray(value)) return `[${value.map(pythonLiteral).join(",")}]`;
  throw new Error("unsupported python literal");
}

function javascriptLiteral(value: unknown): string {
  const out = JSON.stringify(value);
  if (out === undefined) throw new Error("unsupported javascript literal");
  return out;
}

function callExpression(spec: FunctionSpec, args: string[], language: string): string {
  const joined = args.join(", ");

  if (!spec.class_name) return `${spec.function_name}(${joined})`;

  switch (language) {
    case "python":
      return `${spec.class_name}().${spec.function_name}(${joined})`;
    case "javascript":
      return `new ${spec.class_name}().${spec.function_name}(${joined})`;
    case "java":
    case "cpp":
      return `new ${spec.class_name}().${spec.function_name}(${joined})`;
    case "ruby":
      return `${spec.class_name}.new.${spec.function_name}(${joined})`;
    case "php":
      return `(new ${spec.class_name}())->${spec.function_name}(${joined})`;
    default:
      throw new Error(`class mode unsupported for ${language}`);
  }
}

function pythonHarness(
  studentCode: string,
  spec: FunctionSpec,
  token: string,
): string {
  const args = spec.parameters.map((_, i) => `__prooflab_args[${i}]`);
  const call = callExpression(spec, args, "python");
  const prefix = jsonString(functionResultPrefix(token));

  return `import json as __prooflab_json
import sys as __prooflab_sys

__prooflab_loads = __prooflab_json.loads
__prooflab_dumps = __prooflab_json.dumps
__prooflab_read = __prooflab_sys.stdin.read
__prooflab_write = __prooflab_sys.stdout.write
__prooflab_flush = __prooflab_sys.stdout.flush

${studentCode}

__prooflab_args = __prooflab_loads(__prooflab_read())

if (
    not isinstance(__prooflab_args, list)
    or len(__prooflab_args) != ${spec.parameters.length}
):
    raise RuntimeError("invalid function arguments")

__prooflab_value = ${call}

__prooflab_payload = __prooflab_dumps(
    __prooflab_value,
    ensure_ascii=False,
    allow_nan=False,
    separators=(",", ":"),
)

__prooflab_write("\\n" + ${prefix} + ${jsonString('{"ok":true,"value":')} + __prooflab_payload + ${jsonString("}")} + "\\n")
__prooflab_flush()
`;
}

function javascriptHarness(
  studentCode: string,
  spec: FunctionSpec,
  token: string,
): string {
  const suffix = helperSuffix(token);
  const args = `__prooflab_args_${suffix}`;

  const call = callExpression(
    spec,
    spec.parameters.map((_, i) => `${args}[${i}]`),
    "javascript",
  );

  return `const __prooflab_fs_${suffix} = require("fs");
const __prooflab_parse_${suffix} = JSON.parse.bind(JSON);
const __prooflab_stringify_${suffix} = JSON.stringify.bind(JSON);
const __prooflab_write_${suffix} =
  process.stdout.write.bind(process.stdout);

${studentCode}

const ${args} = __prooflab_parse_${suffix}(
  __prooflab_fs_${suffix}.readFileSync(0, "utf8")
);

if (
  !Array.isArray(${args}) ||
  ${args}.length !== ${spec.parameters.length}
) {
  throw new Error("invalid function arguments");
}

const __prooflab_value_${suffix} = ${call};

const __prooflab_payload_${suffix} =
  __prooflab_stringify_${suffix}(
    __prooflab_value_${suffix}
  );

if (__prooflab_payload_${suffix} === undefined) {
  throw new Error("unsupported function return value");
}

__prooflab_write_${suffix}(
  "\\n" +
  ${jsonString(functionResultPrefix(token))} +
  ${jsonString('{"ok":true,"value":')} +
  __prooflab_payload_${suffix} +
  ${jsonString("}")} +
  "\\n"
);
`;
}

function javaType(type: FunctionValueType): string {
  switch (type) {
    case "integer":
      return "int";
    case "number":
      return "double";
    case "boolean":
      return "boolean";
    case "string":
      return "String";
    case "array<integer>":
      return "int[]";
    case "array<number>":
      return "double[]";
    case "array<boolean>":
      return "boolean[]";
    case "array<string>":
      return "String[]";
  }
}

function javaLiteral(value: unknown, type: FunctionValueType): string {
  switch (type) {
    case "integer":
    case "number":
      return String(value);
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return jsonString(value as string);
    case "array<integer>":
      return `new int[]{${(value as number[]).join(",")}}`;
    case "array<number>":
      return `new double[]{${(value as number[]).join(",")}}`;
    case "array<boolean>":
      return `new boolean[]{${(value as boolean[]).map((x) => x ? "true" : "false").join(",")}}`;
    case "array<string>":
      return `new String[]{${(value as string[]).map(jsonString).join(",")}}`;
  }
}

function javaParseMethod(type: FunctionValueType): string {
  switch (type) {
    case "integer": return "parseInt";
    case "number": return "parseNumber";
    case "boolean": return "parseBoolean";
    case "string": return "parseString";
    case "array<integer>": return "parseIntArray";
    case "array<number>": return "parseNumberArray";
    case "array<boolean>": return "parseBooleanArray";
    case "array<string>": return "parseStringArray";
  }
}

function javaHarness(
  studentCode: string,
  spec: FunctionSpec,
  token: string,
): string {
  if (/^\s*package\s+[\w.]+\s*;/m.test(studentCode)) {
    throw new Error("java function mode does not support package declarations");
  }

  const names = spec.parameters.map((_, i) => `__prooflabArg${i}`);

  const parsing: string[] = [
    "    __PLJson __prooflab = new __PLJson(new String(System.in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));",
    "    __prooflab.beginArgs();",
  ];

  spec.parameters.forEach((parameter, i) => {
    if (i > 0) parsing.push("    __prooflab.comma();");
    parsing.push(
      `    ${javaType(parameter.type)} ${names[i]} = __prooflab.${javaParseMethod(parameter.type)}();`,
    );
  });

  parsing.push("    __prooflab.endArgs();");

  const call = callExpression(spec, names, "java");
  const resultType = javaType(spec.return_type);
  const prefix = jsonString(functionResultPrefix(token));

  return `import java.util.*;

${studentCode}

final class __ProofLabMain {
  static final class __PLJson {
    final String s;
    int p = 0;

    __PLJson(String s) {
      this.s = s;
    }

    void fail() {
      throw new RuntimeException("invalid function arguments");
    }

    void ws() {
      while (p < s.length() && Character.isWhitespace(s.charAt(p))) p++;
    }

    boolean take(char c) {
      ws();
      if (p < s.length() && s.charAt(p) == c) {
        p++;
        return true;
      }
      return false;
    }

    void expect(char c) {
      if (!take(c)) fail();
    }

    void beginArgs() {
      expect('[');
    }

    void comma() {
      expect(',');
    }

    void endArgs() {
      expect(']');
      ws();
      if (p != s.length()) fail();
    }

    String numberToken() {
      ws();
      int start = p;

      if (p < s.length() && s.charAt(p) == '-') p++;
      if (p >= s.length()) fail();

      if (s.charAt(p) == '0') {
        p++;
      } else {
        if (s.charAt(p) < '1' || s.charAt(p) > '9') fail();
        while (
          p < s.length() &&
          s.charAt(p) >= '0' &&
          s.charAt(p) <= '9'
        ) p++;
      }

      if (p < s.length() && s.charAt(p) == '.') {
        p++;
        int digits = p;
        while (
          p < s.length() &&
          s.charAt(p) >= '0' &&
          s.charAt(p) <= '9'
        ) p++;
        if (digits == p) fail();
      }

      if (
        p < s.length() &&
        (s.charAt(p) == 'e' || s.charAt(p) == 'E')
      ) {
        p++;
        if (
          p < s.length() &&
          (s.charAt(p) == '+' || s.charAt(p) == '-')
        ) p++;

        int digits = p;
        while (
          p < s.length() &&
          s.charAt(p) >= '0' &&
          s.charAt(p) <= '9'
        ) p++;

        if (digits == p) fail();
      }

      return s.substring(start, p);
    }

    int parseInt() {
      String value = numberToken();
      if (
        value.indexOf('.') >= 0 ||
        value.indexOf('e') >= 0 ||
        value.indexOf('E') >= 0
      ) fail();

      try {
        long n = Long.parseLong(value);
        if (n < -2147483648L || n > 2147483647L) fail();
        return (int)n;
      } catch (NumberFormatException e) {
        fail();
        return 0;
      }
    }

    double parseNumber() {
      try {
        double n = Double.parseDouble(numberToken());
        if (!Double.isFinite(n)) fail();
        return n;
      } catch (NumberFormatException e) {
        fail();
        return 0;
      }
    }

    boolean parseBoolean() {
      ws();

      if (s.startsWith("true", p)) {
        p += 4;
        return true;
      }

      if (s.startsWith("false", p)) {
        p += 5;
        return false;
      }

      fail();
      return false;
    }

    int hex4() {
      if (p + 4 > s.length()) fail();

      int out = 0;

      for (int i = 0; i < 4; i++) {
        char c = s.charAt(p++);
        int v;

        if (c >= '0' && c <= '9') v = c - '0';
        else if (c >= 'a' && c <= 'f') v = c - 'a' + 10;
        else if (c >= 'A' && c <= 'F') v = c - 'A' + 10;
        else {
          fail();
          return 0;
        }

        out = (out << 4) | v;
      }

      return out;
    }

    String parseString() {
      ws();
      if (p >= s.length() || s.charAt(p++) != '"') fail();

      StringBuilder b = new StringBuilder();

      while (p < s.length()) {
        char c = s.charAt(p++);

        if (c == '"') return b.toString();

        if (c == '\\\\') {
          if (p >= s.length()) fail();
          char e = s.charAt(p++);

          switch (e) {
            case '"': b.append('"'); break;
            case '\\\\': b.append('\\\\'); break;
            case '/': b.append('/'); break;
            case 'b': b.append('\\b'); break;
            case 'f': b.append('\\f'); break;
            case 'n': b.append('\\n'); break;
            case 'r': b.append('\\r'); break;
            case 't': b.append('\\t'); break;

            case 'u': {
              int first = hex4();

              if (first >= 0xD800 && first <= 0xDBFF) {
                if (
                  p + 2 > s.length() ||
                  s.charAt(p++) != '\\\\' ||
                  s.charAt(p++) != 'u'
                ) fail();

                int second = hex4();

                if (second < 0xDC00 || second > 0xDFFF) fail();

                b.append((char)first);
                b.append((char)second);
              } else {
                if (first >= 0xDC00 && first <= 0xDFFF) fail();
                b.append((char)first);
              }

              break;
            }

            default:
              fail();
          }
        } else {
          if (c < 0x20) fail();
          b.append(c);
        }
      }

      fail();
      return "";
    }

    boolean arrayStart() {
      expect('[');
      ws();
      return take(']');
    }

    int[] parseIntArray() {
      ArrayList<Integer> a = new ArrayList<>();
      if (arrayStart()) return new int[0];

      while (true) {
        if (a.size() >= 10000) fail();
        a.add(parseInt());
        if (take(']')) break;
        expect(',');
      }

      int[] out = new int[a.size()];
      for (int i = 0; i < out.length; i++) out[i] = a.get(i);
      return out;
    }

    double[] parseNumberArray() {
      ArrayList<Double> a = new ArrayList<>();
      if (arrayStart()) return new double[0];

      while (true) {
        if (a.size() >= 10000) fail();
        a.add(parseNumber());
        if (take(']')) break;
        expect(',');
      }

      double[] out = new double[a.size()];
      for (int i = 0; i < out.length; i++) out[i] = a.get(i);
      return out;
    }

    boolean[] parseBooleanArray() {
      ArrayList<Boolean> a = new ArrayList<>();
      if (arrayStart()) return new boolean[0];

      while (true) {
        if (a.size() >= 10000) fail();
        a.add(parseBoolean());
        if (take(']')) break;
        expect(',');
      }

      boolean[] out = new boolean[a.size()];
      for (int i = 0; i < out.length; i++) out[i] = a.get(i);
      return out;
    }

    String[] parseStringArray() {
      ArrayList<String> a = new ArrayList<>();
      if (arrayStart()) return new String[0];

      while (true) {
        if (a.size() >= 10000) fail();
        a.add(parseString());
        if (take(']')) break;
        expect(',');
      }

      return a.toArray(new String[0]);
    }
  }

  static String __plString(String s) {
    if (s == null) throw new RuntimeException("null return");

    StringBuilder b = new StringBuilder("\"");

    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);

      switch (c) {
        case '"': b.append("\\\\\""); break;
        case '\\\\': b.append("\\\\\\\\"); break;
        case '\\b': b.append("\\\\b"); break;
        case '\\f': b.append("\\\\f"); break;
        case '\\n': b.append("\\\\n"); break;
        case '\\r': b.append("\\\\r"); break;
        case '\\t': b.append("\\\\t"); break;
        default:
          if (c < 32) b.append(String.format("\\\\u%04x", (int)c));
          else b.append(c);
      }
    }

    return b.append('"').toString();
  }

  static String __plJson(int v) {
    return Integer.toString(v);
  }

  static String __plJson(double v) {
    if (!Double.isFinite(v)) throw new RuntimeException("non-finite return");
    return Double.toString(v);
  }

  static String __plJson(boolean v) {
    return v ? "true" : "false";
  }

  static String __plJson(String v) {
    return __plString(v);
  }

  static String __plJson(int[] a) {
    if (a == null) throw new RuntimeException("null return");
    StringBuilder b = new StringBuilder("[");
    for (int i = 0; i < a.length; i++) {
      if (i > 0) b.append(',');
      b.append(a[i]);
    }
    return b.append(']').toString();
  }

  static String __plJson(double[] a) {
    if (a == null) throw new RuntimeException("null return");
    StringBuilder b = new StringBuilder("[");
    for (int i = 0; i < a.length; i++) {
      if (i > 0) b.append(',');
      if (!Double.isFinite(a[i])) throw new RuntimeException("non-finite return");
      b.append(Double.toString(a[i]));
    }
    return b.append(']').toString();
  }

  static String __plJson(boolean[] a) {
    if (a == null) throw new RuntimeException("null return");
    StringBuilder b = new StringBuilder("[");
    for (int i = 0; i < a.length; i++) {
      if (i > 0) b.append(',');
      b.append(a[i] ? "true" : "false");
    }
    return b.append(']').toString();
  }

  static String __plJson(String[] a) {
    if (a == null) throw new RuntimeException("null return");
    StringBuilder b = new StringBuilder("[");
    for (int i = 0; i < a.length; i++) {
      if (i > 0) b.append(',');
      b.append(__plString(a[i]));
    }
    return b.append(']').toString();
  }

  public static void main(String[] ignored) throws Exception {
${parsing.join("\n")}
    ${resultType} __prooflabResult = ${call};

    System.out.print(
      "\\n" +
      ${prefix} +
      ${jsonString('{"ok":true,"value":')} +
      __plJson(__prooflabResult) +
      ${jsonString("}")} +
      "\\n"
    );

    System.out.flush();
  }
}
`;
}

function cScalarLiteral(value: unknown, type: FunctionValueType): string {
  switch (type) {
    case "integer":
      return String(value);
    case "number":
      return String(value);
    case "boolean":
      return value ? "1" : "0";
    case "string":
      return jsonString(value as string);
    default:
      throw new Error("array requires declaration");
  }
}

function cArrayType(type: FunctionValueType): {
  element: string;
  wrapper: string;
} {
  switch (type) {
    case "array<integer>":
      return { element: "int", wrapper: "PLIntArray" };
    case "array<number>":
      return { element: "double", wrapper: "PLNumberArray" };
    case "array<boolean>":
      return { element: "int", wrapper: "PLBoolArray" };
    case "array<string>":
      return { element: "const char *", wrapper: "PLStringArray" };
    default:
      throw new Error("not an array type");
  }
}

function cArgument(
  value: unknown,
  type: FunctionValueType,
  index: number,
): { declarations: string; expression: string } {
  if (!type.startsWith("array<")) {
    return {
      declarations: "",
      expression: cScalarLiteral(value, type),
    };
  }

  const arr = value as unknown[];
  const info = cArrayType(type);
  const data = `__pl_arg_${index}_data`;
  const wrapper = `__pl_arg_${index}`;

  if (arr.length === 0) {
    return {
      declarations:
        `${info.wrapper} ${wrapper} = { NULL, 0 };`,
      expression: wrapper,
    };
  }

  const literals = arr.map((v) => {
    if (type === "array<boolean>") return v ? "1" : "0";
    if (type === "array<string>") return jsonString(v as string);
    return String(v);
  });

  return {
    declarations:
      `${info.element} ${data}[] = { ${literals.join(", ")} };\n` +
      `${info.wrapper} ${wrapper} = { ${data}, ${arr.length} };`,
    expression: wrapper,
  };
}

function cReturnType(type: FunctionValueType): string {
  switch (type) {
    case "integer":
      return "int";
    case "number":
      return "double";
    case "boolean":
      return "int";
    case "string":
      return "const char *";
    case "array<integer>":
      return "PLIntArray";
    case "array<number>":
      return "PLNumberArray";
    case "array<boolean>":
      return "PLBoolArray";
    case "array<string>":
      return "PLStringArray";
  }
}

function cSerialize(type: FunctionValueType, variable: string): string {
  switch (type) {
    case "integer":
      return `fprintf(stdout, "%d", ${variable});`;
    case "number":
      return `if (!isfinite(${variable})) return 3;
  fprintf(stdout, "%.17g", ${variable});`;
    case "boolean":
      return `fputs(${variable} ? "true" : "false", stdout);`;
    case "string":
      return `__pl_json_string(${variable});`;
    case "array<integer>":
      return `fputc('[', stdout);
  for (size_t i = 0; i < ${variable}.len; i++) {
    if (i) fputc(',', stdout);
    fprintf(stdout, "%d", ${variable}.data[i]);
  }
  fputc(']', stdout);`;
    case "array<number>":
      return `fputc('[', stdout);
  for (size_t i = 0; i < ${variable}.len; i++) {
    if (i) fputc(',', stdout);
    if (!isfinite(${variable}.data[i])) return 3;
    fprintf(stdout, "%.17g", ${variable}.data[i]);
  }
  fputc(']', stdout);`;
    case "array<boolean>":
      return `fputc('[', stdout);
  for (size_t i = 0; i < ${variable}.len; i++) {
    if (i) fputc(',', stdout);
    fputs(${variable}.data[i] ? "true" : "false", stdout);
  }
  fputc(']', stdout);`;
    case "array<string>":
      return `fputc('[', stdout);
  for (size_t i = 0; i < ${variable}.len; i++) {
    if (i) fputc(',', stdout);
    __pl_json_string(${variable}.data[i]);
  }
  fputc(']', stdout);`;
  }
}

function cParseExpression(type: FunctionValueType): string {
  switch (type) {
    case "integer":
      return "__pl_parse_int(&__prooflab_p)";
    case "number":
      return "__pl_parse_number(&__prooflab_p)";
    case "boolean":
      return "__pl_parse_bool(&__prooflab_p)";
    case "string":
      return "__pl_parse_string(&__prooflab_p)";
    case "array<integer>":
      return "__pl_parse_int_array(&__prooflab_p)";
    case "array<number>":
      return "__pl_parse_number_array(&__prooflab_p)";
    case "array<boolean>":
      return "__pl_parse_bool_array(&__prooflab_p)";
    case "array<string>":
      return "__pl_parse_string_array(&__prooflab_p)";
  }
}

function cHarness(
  studentCode: string,
  spec: FunctionSpec,
  token: string,
): string {
  const resultType = cReturnType(spec.return_type);

  const prototypeArgs = spec.parameters.length
    ? spec.parameters.map((p) => cReturnType(p.type)).join(", ")
    : "void";

  const prototype =
    `${resultType} ${spec.function_name}(${prototypeArgs});`;

  const names = spec.parameters.map((_, i) => `__prooflab_arg_${i}`);

  const parsing: string[] = [
    "  __pl_expect(&__prooflab_p, '[');",
  ];

  spec.parameters.forEach((parameter, i) => {
    if (i > 0) {
      parsing.push(
        "  __pl_expect(&__prooflab_p, ',');",
      );
    }

    parsing.push(
      `  ${cReturnType(parameter.type)} ${names[i]} = ${
        cParseExpression(parameter.type)
      };`,
    );
  });

  parsing.push("  __pl_expect(&__prooflab_p, ']');");
  parsing.push("  __pl_ws(&__prooflab_p);");
  parsing.push(
    "  if (__prooflab_p.p != __prooflab_p.n) __pl_fail();",
  );

  const call =
    `${spec.function_name}(${names.join(", ")})`;

  const prefix = jsonString(functionResultPrefix(token));

  return `#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <math.h>

typedef struct { int *data; size_t len; } PLIntArray;
typedef struct { double *data; size_t len; } PLNumberArray;
typedef struct { int *data; size_t len; } PLBoolArray;
typedef struct { const char **data; size_t len; } PLStringArray;

${prototype}

typedef struct {
  const char *s;
  size_t p;
  size_t n;
} __PLParser;

static void __pl_fail(void) {
  exit(2);
}

static void __pl_ws(__PLParser *p) {
  while (p->p < p->n) {
    char c = p->s[p->p];

    if (
      c == ' ' ||
      c == '\\n' ||
      c == '\\r' ||
      c == '\\t'
    ) {
      p->p++;
    } else {
      break;
    }
  }
}

static int __pl_take(__PLParser *p, char wanted) {
  __pl_ws(p);

  if (p->p < p->n && p->s[p->p] == wanted) {
    p->p++;
    return 1;
  }

  return 0;
}

static void __pl_expect(__PLParser *p, char wanted) {
  if (!__pl_take(p, wanted)) __pl_fail();
}

static char *__pl_read_all(size_t *length) {
  size_t cap = 4096;
  size_t n = 0;

  char *out = (char *)malloc(cap + 1);
  if (!out) __pl_fail();

  for (;;) {
    int ch = fgetc(stdin);
    if (ch == EOF) break;

    if (n >= 65536) __pl_fail();

    if (n == cap) {
      cap *= 2;

      char *next = (char *)realloc(out, cap + 1);
      if (!next) __pl_fail();

      out = next;
    }

    out[n++] = (char)ch;
  }

  out[n] = '\\0';
  *length = n;
  return out;
}

static int __pl_hex4(__PLParser *p) {
  if (p->p + 4 > p->n) __pl_fail();

  int out = 0;

  for (int i = 0; i < 4; i++) {
    char c = p->s[p->p++];
    int value;

    if (c >= '0' && c <= '9') value = c - '0';
    else if (c >= 'a' && c <= 'f') value = c - 'a' + 10;
    else if (c >= 'A' && c <= 'F') value = c - 'A' + 10;
    else __pl_fail();

    out = (out << 4) | value;
  }

  return out;
}

static void __pl_utf8(
  char *out,
  size_t *length,
  unsigned codepoint
) {
  if (codepoint == 0 || codepoint > 0x10FFFF) {
    __pl_fail();
  }

  if (codepoint <= 0x7F) {
    out[(*length)++] = (char)codepoint;
  } else if (codepoint <= 0x7FF) {
    out[(*length)++] = (char)(0xC0 | (codepoint >> 6));
    out[(*length)++] = (char)(0x80 | (codepoint & 0x3F));
  } else if (codepoint <= 0xFFFF) {
    out[(*length)++] = (char)(0xE0 | (codepoint >> 12));
    out[(*length)++] =
      (char)(0x80 | ((codepoint >> 6) & 0x3F));
    out[(*length)++] =
      (char)(0x80 | (codepoint & 0x3F));
  } else {
    out[(*length)++] = (char)(0xF0 | (codepoint >> 18));
    out[(*length)++] =
      (char)(0x80 | ((codepoint >> 12) & 0x3F));
    out[(*length)++] =
      (char)(0x80 | ((codepoint >> 6) & 0x3F));
    out[(*length)++] =
      (char)(0x80 | (codepoint & 0x3F));
  }
}

static char *__pl_parse_string(__PLParser *p) {
  __pl_ws(p);

  if (
    p->p >= p->n ||
    p->s[p->p++] != '"'
  ) {
    __pl_fail();
  }

  size_t cap = (p->n - p->p) * 4 + 1;
  char *out = (char *)malloc(cap);

  if (!out) __pl_fail();

  size_t length = 0;

  while (p->p < p->n) {
    unsigned char c =
      (unsigned char)p->s[p->p++];

    if (c == '"') {
      out[length] = '\\0';
      return out;
    }

    if (c == '\\\\') {
      if (p->p >= p->n) __pl_fail();

      char e = p->s[p->p++];

      switch (e) {
        case '"': out[length++] = '"'; break;
        case '\\\\': out[length++] = '\\\\'; break;
        case '/': out[length++] = '/'; break;
        case 'b': out[length++] = '\\b'; break;
        case 'f': out[length++] = '\\f'; break;
        case 'n': out[length++] = '\\n'; break;
        case 'r': out[length++] = '\\r'; break;
        case 't': out[length++] = '\\t'; break;

        case 'u': {
          unsigned first = (unsigned)__pl_hex4(p);
          unsigned codepoint = first;

          if (first >= 0xD800 && first <= 0xDBFF) {
            if (
              p->p + 2 > p->n ||
              p->s[p->p++] != '\\\\' ||
              p->s[p->p++] != 'u'
            ) {
              __pl_fail();
            }

            unsigned second = (unsigned)__pl_hex4(p);

            if (
              second < 0xDC00 ||
              second > 0xDFFF
            ) {
              __pl_fail();
            }

            codepoint =
              0x10000 +
              (((first - 0xD800) << 10) |
                (second - 0xDC00));
          } else if (
            first >= 0xDC00 &&
            first <= 0xDFFF
          ) {
            __pl_fail();
          }

          __pl_utf8(out, &length, codepoint);
          break;
        }

        default:
          __pl_fail();
      }
    } else {
      if (c < 0x20) __pl_fail();
      out[length++] = (char)c;
    }
  }

  __pl_fail();
  return NULL;
}

static void __pl_number_span(
  __PLParser *p,
  size_t *start,
  size_t *end
) {
  __pl_ws(p);

  size_t i = p->p;
  *start = i;

  if (i < p->n && p->s[i] == '-') i++;

  if (i >= p->n) __pl_fail();

  if (p->s[i] == '0') {
    i++;
  } else {
    if (p->s[i] < '1' || p->s[i] > '9') {
      __pl_fail();
    }

    while (
      i < p->n &&
      p->s[i] >= '0' &&
      p->s[i] <= '9'
    ) {
      i++;
    }
  }

  if (i < p->n && p->s[i] == '.') {
    i++;
    size_t digits = i;

    while (
      i < p->n &&
      p->s[i] >= '0' &&
      p->s[i] <= '9'
    ) {
      i++;
    }

    if (digits == i) __pl_fail();
  }

  if (
    i < p->n &&
    (p->s[i] == 'e' || p->s[i] == 'E')
  ) {
    i++;

    if (
      i < p->n &&
      (p->s[i] == '+' || p->s[i] == '-')
    ) {
      i++;
    }

    size_t digits = i;

    while (
      i < p->n &&
      p->s[i] >= '0' &&
      p->s[i] <= '9'
    ) {
      i++;
    }

    if (digits == i) __pl_fail();
  }

  if (i == *start) __pl_fail();

  p->p = i;
  *end = i;
}

static int __pl_parse_int(__PLParser *p) {
  size_t start;
  size_t end;

  __pl_number_span(p, &start, &end);

  for (size_t i = start; i < end; i++) {
    if (
      p->s[i] == '.' ||
      p->s[i] == 'e' ||
      p->s[i] == 'E'
    ) {
      __pl_fail();
    }
  }

  char *tail = NULL;
  long long value =
    strtoll(p->s + start, &tail, 10);

  if (
    !tail ||
    (size_t)(tail - p->s) != end ||
    value < -2147483648LL ||
    value > 2147483647LL
  ) {
    __pl_fail();
  }

  return (int)value;
}

static double __pl_parse_number(__PLParser *p) {
  size_t start;
  size_t end;

  __pl_number_span(p, &start, &end);

  char *tail = NULL;
  double value =
    strtod(p->s + start, &tail);

  if (
    !tail ||
    (size_t)(tail - p->s) != end ||
    !isfinite(value)
  ) {
    __pl_fail();
  }

  return value;
}

static int __pl_parse_bool(__PLParser *p) {
  __pl_ws(p);

  if (
    p->p + 4 <= p->n &&
    memcmp(p->s + p->p, "true", 4) == 0
  ) {
    p->p += 4;
    return 1;
  }

  if (
    p->p + 5 <= p->n &&
    memcmp(p->s + p->p, "false", 5) == 0
  ) {
    p->p += 5;
    return 0;
  }

  __pl_fail();
  return 0;
}

static PLIntArray __pl_parse_int_array(__PLParser *p) {
  PLIntArray out = { NULL, 0 };
  size_t cap = 0;

  __pl_expect(p, '[');

  if (__pl_take(p, ']')) return out;

  for (;;) {
    if (out.len >= 10000) __pl_fail();

    if (out.len == cap) {
      cap = cap ? cap * 2 : 8;

      int *next = (int *)realloc(
        out.data,
        cap * sizeof(int)
      );

      if (!next) __pl_fail();
      out.data = next;
    }

    out.data[out.len++] = __pl_parse_int(p);

    if (__pl_take(p, ']')) break;
    __pl_expect(p, ',');
  }

  return out;
}

static PLNumberArray __pl_parse_number_array(
  __PLParser *p
) {
  PLNumberArray out = { NULL, 0 };
  size_t cap = 0;

  __pl_expect(p, '[');

  if (__pl_take(p, ']')) return out;

  for (;;) {
    if (out.len >= 10000) __pl_fail();

    if (out.len == cap) {
      cap = cap ? cap * 2 : 8;

      double *next = (double *)realloc(
        out.data,
        cap * sizeof(double)
      );

      if (!next) __pl_fail();
      out.data = next;
    }

    out.data[out.len++] = __pl_parse_number(p);

    if (__pl_take(p, ']')) break;
    __pl_expect(p, ',');
  }

  return out;
}

static PLBoolArray __pl_parse_bool_array(
  __PLParser *p
) {
  PLBoolArray out = { NULL, 0 };
  size_t cap = 0;

  __pl_expect(p, '[');

  if (__pl_take(p, ']')) return out;

  for (;;) {
    if (out.len >= 10000) __pl_fail();

    if (out.len == cap) {
      cap = cap ? cap * 2 : 8;

      int *next = (int *)realloc(
        out.data,
        cap * sizeof(int)
      );

      if (!next) __pl_fail();
      out.data = next;
    }

    out.data[out.len++] = __pl_parse_bool(p);

    if (__pl_take(p, ']')) break;
    __pl_expect(p, ',');
  }

  return out;
}

static PLStringArray __pl_parse_string_array(
  __PLParser *p
) {
  PLStringArray out = { NULL, 0 };
  size_t cap = 0;

  __pl_expect(p, '[');

  if (__pl_take(p, ']')) return out;

  for (;;) {
    if (out.len >= 10000) __pl_fail();

    if (out.len == cap) {
      cap = cap ? cap * 2 : 8;

      const char **next =
        (const char **)realloc(
          out.data,
          cap * sizeof(const char *)
        );

      if (!next) __pl_fail();
      out.data = next;
    }

    out.data[out.len++] = __pl_parse_string(p);

    if (__pl_take(p, ']')) break;
    __pl_expect(p, ',');
  }

  return out;
}

static void __pl_json_string(const char *s) {
  if (!s) exit(3);

  fputc('"', stdout);

  for (
    const unsigned char *p =
      (const unsigned char *)s;
    *p;
    ++p
  ) {
    switch (*p) {
      case '"':
        fputs("\\\\\\"", stdout);
        break;

      case '\\\\':
        fputs("\\\\\\\\", stdout);
        break;

      case '\\b':
        fputs("\\\\b", stdout);
        break;

      case '\\f':
        fputs("\\\\f", stdout);
        break;

      case '\\n':
        fputs("\\\\n", stdout);
        break;

      case '\\r':
        fputs("\\\\r", stdout);
        break;

      case '\\t':
        fputs("\\\\t", stdout);
        break;

      default:
        if (*p < 32) {
          fprintf(stdout, "\\\\u%04x", *p);
        } else {
          fputc(*p, stdout);
        }
    }
  }

  fputc('"', stdout);
}

int main(void) {
  size_t __prooflab_length = 0;

  char *__prooflab_input =
    __pl_read_all(&__prooflab_length);

  __PLParser __prooflab_p = {
    __prooflab_input,
    0,
    __prooflab_length
  };

${parsing.join("\n")}

  ${resultType} __prooflab_result = ${call};

  fputc('\\n', stdout);
  fputs(${prefix}, stdout);
  fputs(${jsonString('{"ok":true,"value":')}, stdout);

  ${cSerialize(spec.return_type, "__prooflab_result")}

  fputs(${jsonString("}")}, stdout);
  fputc('\\n', stdout);
  fflush(stdout);

  return 0;
}

${studentCode}
`;
}

function cppType(type: FunctionValueType): string {
  switch (type) {
    case "integer":
      return "int";
    case "number":
      return "double";
    case "boolean":
      return "bool";
    case "string":
      return "std::string";
    case "array<integer>":
      return "std::vector<int>";
    case "array<number>":
      return "std::vector<double>";
    case "array<boolean>":
      return "std::vector<bool>";
    case "array<string>":
      return "std::vector<std::string>";
  }
}

function cppLiteral(value: unknown, type: FunctionValueType): string {
  if (!type.startsWith("array<")) {
    if (type === "string") return `std::string(${jsonString(value as string)})`;
    if (type === "boolean") return value ? "true" : "false";
    return String(value);
  }

  const arr = value as unknown[];
  const inner = type.slice(6, -1) as FunctionValueType;
  return `${cppType(type)}{${arr.map((x) => cppLiteral(x, inner)).join(",")}}`;
}

function cppParseMethod(type: FunctionValueType): string {
  switch (type) {
    case "integer": return "parseInt";
    case "number": return "parseNumber";
    case "boolean": return "parseBoolean";
    case "string": return "parseString";
    case "array<integer>": return "parseIntArray";
    case "array<number>": return "parseNumberArray";
    case "array<boolean>": return "parseBooleanArray";
    case "array<string>": return "parseStringArray";
  }
}

function cppHarness(
  studentCode: string,
  spec: FunctionSpec,
  token: string,
): string {
  if (spec.class_name) {
    throw new Error(
      "cpp function mode does not support class_name",
    );
  }

  const suffix = helperSuffix(token);
  const jsonFn = `__prooflab_json_${suffix}`;

  const prototypeArgs = spec.parameters.length
    ? spec.parameters.map((p) => cppType(p.type)).join(", ")
    : "";

  const prototype =
    `${cppType(spec.return_type)} ` +
    `${spec.function_name}(${prototypeArgs});`;

  const names =
    spec.parameters.map((_, i) => `__prooflab_arg_${i}`);

  const parsing: string[] = [
    "  __prooflab.beginArgs();",
  ];

  spec.parameters.forEach((parameter, i) => {
    if (i > 0) parsing.push("  __prooflab.comma();");

    parsing.push(
      `  ${cppType(parameter.type)} ${names[i]} = ` +
      `__prooflab.${cppParseMethod(parameter.type)}();`,
    );
  });

  parsing.push("  __prooflab.endArgs();");

  const call =
    `${spec.function_name}(${names.join(", ")})`;

  return `#include <iostream>
#include <string>
#include <vector>
#include <sstream>
#include <iomanip>
#include <cmath>
#include <cstdio>
#include <stdexcept>
#include <iterator>
#include <cstdint>
#include <limits>
using namespace std;

${prototype}

class __PLJson {
 public:
  explicit __PLJson(string input)
    : s(std::move(input)) {}

  void fail() const {
    throw runtime_error("invalid function arguments");
  }

  void ws() {
    while (
      p < s.size() &&
      (s[p] == ' ' ||
       s[p] == '\\n' ||
       s[p] == '\\r' ||
       s[p] == '\\t')
    ) {
      ++p;
    }
  }

  bool take(char wanted) {
    ws();

    if (p < s.size() && s[p] == wanted) {
      ++p;
      return true;
    }

    return false;
  }

  void expect(char wanted) {
    if (!take(wanted)) fail();
  }

  void beginArgs() {
    expect('[');
  }

  void comma() {
    expect(',');
  }

  void endArgs() {
    expect(']');
    ws();

    if (p != s.size()) fail();
  }

  string numberToken() {
    ws();

    size_t start = p;

    if (p < s.size() && s[p] == '-') ++p;
    if (p >= s.size()) fail();

    if (s[p] == '0') {
      ++p;
    } else {
      if (s[p] < '1' || s[p] > '9') fail();

      while (
        p < s.size() &&
        s[p] >= '0' &&
        s[p] <= '9'
      ) {
        ++p;
      }
    }

    if (p < s.size() && s[p] == '.') {
      ++p;

      size_t digits = p;

      while (
        p < s.size() &&
        s[p] >= '0' &&
        s[p] <= '9'
      ) {
        ++p;
      }

      if (digits == p) fail();
    }

    if (
      p < s.size() &&
      (s[p] == 'e' || s[p] == 'E')
    ) {
      ++p;

      if (
        p < s.size() &&
        (s[p] == '+' || s[p] == '-')
      ) {
        ++p;
      }

      size_t digits = p;

      while (
        p < s.size() &&
        s[p] >= '0' &&
        s[p] <= '9'
      ) {
        ++p;
      }

      if (digits == p) fail();
    }

    return s.substr(start, p - start);
  }

  int parseInt() {
    string token = numberToken();

    if (
      token.find('.') != string::npos ||
      token.find('e') != string::npos ||
      token.find('E') != string::npos
    ) {
      fail();
    }

    try {
      size_t used = 0;
      long long value = stoll(token, &used);

      if (
        used != token.size() ||
        value < -2147483648LL ||
        value > 2147483647LL
      ) {
        fail();
      }

      return static_cast<int>(value);
    } catch (...) {
      fail();
    }

    return 0;
  }

  double parseNumber() {
    string token = numberToken();

    try {
      size_t used = 0;
      double value = stod(token, &used);

      if (
        used != token.size() ||
        !isfinite(value)
      ) {
        fail();
      }

      return value;
    } catch (...) {
      fail();
    }

    return 0;
  }

  bool parseBoolean() {
    ws();

    if (s.compare(p, 4, "true") == 0) {
      p += 4;
      return true;
    }

    if (s.compare(p, 5, "false") == 0) {
      p += 5;
      return false;
    }

    fail();
    return false;
  }

  unsigned hex4() {
    if (p + 4 > s.size()) fail();

    unsigned out = 0;

    for (int i = 0; i < 4; ++i) {
      char c = s[p++];
      unsigned value;

      if (c >= '0' && c <= '9') value = c - '0';
      else if (c >= 'a' && c <= 'f') value = c - 'a' + 10;
      else if (c >= 'A' && c <= 'F') value = c - 'A' + 10;
      else {
        fail();
        return 0;
      }

      out = (out << 4) | value;
    }

    return out;
  }

  static void appendUtf8(
    string& out,
    unsigned codepoint
  ) {
    if (
      codepoint == 0 ||
      codepoint > 0x10FFFF
    ) {
      throw runtime_error(
        "invalid function arguments"
      );
    }

    if (codepoint <= 0x7F) {
      out.push_back(static_cast<char>(codepoint));
    } else if (codepoint <= 0x7FF) {
      out.push_back(
        static_cast<char>(0xC0 | (codepoint >> 6))
      );
      out.push_back(
        static_cast<char>(
          0x80 | (codepoint & 0x3F)
        )
      );
    } else if (codepoint <= 0xFFFF) {
      out.push_back(
        static_cast<char>(0xE0 | (codepoint >> 12))
      );
      out.push_back(
        static_cast<char>(
          0x80 | ((codepoint >> 6) & 0x3F)
        )
      );
      out.push_back(
        static_cast<char>(
          0x80 | (codepoint & 0x3F)
        )
      );
    } else {
      out.push_back(
        static_cast<char>(0xF0 | (codepoint >> 18))
      );
      out.push_back(
        static_cast<char>(
          0x80 | ((codepoint >> 12) & 0x3F)
        )
      );
      out.push_back(
        static_cast<char>(
          0x80 | ((codepoint >> 6) & 0x3F)
        )
      );
      out.push_back(
        static_cast<char>(
          0x80 | (codepoint & 0x3F)
        )
      );
    }
  }

  string parseString() {
    ws();

    if (
      p >= s.size() ||
      s[p++] != '"'
    ) {
      fail();
    }

    string out;

    while (p < s.size()) {
      unsigned char c =
        static_cast<unsigned char>(s[p++]);

      if (c == '"') return out;

      if (c == '\\\\') {
        if (p >= s.size()) fail();

        char e = s[p++];

        switch (e) {
          case '"': out.push_back('"'); break;
          case '\\\\': out.push_back('\\\\'); break;
          case '/': out.push_back('/'); break;
          case 'b': out.push_back('\\b'); break;
          case 'f': out.push_back('\\f'); break;
          case 'n': out.push_back('\\n'); break;
          case 'r': out.push_back('\\r'); break;
          case 't': out.push_back('\\t'); break;

          case 'u': {
            unsigned first = hex4();
            unsigned codepoint = first;

            if (
              first >= 0xD800 &&
              first <= 0xDBFF
            ) {
              if (
                p + 2 > s.size() ||
                s[p++] != '\\\\' ||
                s[p++] != 'u'
              ) {
                fail();
              }

              unsigned second = hex4();

              if (
                second < 0xDC00 ||
                second > 0xDFFF
              ) {
                fail();
              }

              codepoint =
                0x10000 +
                (((first - 0xD800) << 10) |
                  (second - 0xDC00));
            } else if (
              first >= 0xDC00 &&
              first <= 0xDFFF
            ) {
              fail();
            }

            appendUtf8(out, codepoint);
            break;
          }

          default:
            fail();
        }
      } else {
        if (c < 0x20) fail();
        out.push_back(static_cast<char>(c));
      }
    }

    fail();
    return "";
  }

  vector<int> parseIntArray() {
    vector<int> out;
    expect('[');

    if (take(']')) return out;

    for (;;) {
      if (out.size() >= 10000) fail();

      out.push_back(parseInt());

      if (take(']')) break;
      expect(',');
    }

    return out;
  }

  vector<double> parseNumberArray() {
    vector<double> out;
    expect('[');

    if (take(']')) return out;

    for (;;) {
      if (out.size() >= 10000) fail();

      out.push_back(parseNumber());

      if (take(']')) break;
      expect(',');
    }

    return out;
  }

  vector<bool> parseBooleanArray() {
    vector<bool> out;
    expect('[');

    if (take(']')) return out;

    for (;;) {
      if (out.size() >= 10000) fail();

      out.push_back(parseBoolean());

      if (take(']')) break;
      expect(',');
    }

    return out;
  }

  vector<string> parseStringArray() {
    vector<string> out;
    expect('[');

    if (take(']')) return out;

    for (;;) {
      if (out.size() >= 10000) fail();

      out.push_back(parseString());

      if (take(']')) break;
      expect(',');
    }

    return out;
  }

 private:
  string s;
  size_t p = 0;
};

static string ${jsonFn}(const string& s) {
  string out = "\\\"";

  for (unsigned char c : s) {
    switch (c) {
      case '"': out += "\\\\\\\""; break;
      case '\\\\': out += "\\\\\\\\"; break;
      case '\\b': out += "\\\\b"; break;
      case '\\f': out += "\\\\f"; break;
      case '\\n': out += "\\\\n"; break;
      case '\\r': out += "\\\\r"; break;
      case '\\t': out += "\\\\t"; break;

      default:
        if (c < 32) {
          char buffer[7];

          snprintf(
            buffer,
            sizeof(buffer),
            "\\\\u%04x",
            c
          );

          out += buffer;
        } else {
          out += static_cast<char>(c);
        }
    }
  }

  return out + "\\\"";
}

static string ${jsonFn}(int value) {
  return to_string(value);
}

static string ${jsonFn}(bool value) {
  return value ? "true" : "false";
}

static string ${jsonFn}(double value) {
  if (!isfinite(value)) {
    throw runtime_error("non-finite return");
  }

  ostringstream out;
  out << setprecision(17) << value;
  return out.str();
}

template <typename T>
static string ${jsonFn}(const vector<T>& values) {
  string out = "[";

  for (size_t i = 0; i < values.size(); ++i) {
    if (i) out += ",";
    out += ${jsonFn}(values[i]);
  }

  return out + "]";
}

int main() {
  string __prooflab_input(
    (istreambuf_iterator<char>(cin)),
    istreambuf_iterator<char>()
  );

  __PLJson __prooflab(
    std::move(__prooflab_input)
  );

${parsing.join("\n")}

  auto __prooflab_result = ${call};

  cout
    << "\\n"
    << ${jsonString(functionResultPrefix(token))}
    << ${jsonString('{"ok":true,"value":')}
    << ${jsonFn}(__prooflab_result)
    << ${jsonString("}")}
    << "\\n";

  cout.flush();

  return 0;
}

${studentCode}
`;
}

function goType(type: FunctionValueType): string {
  switch (type) {
    case "integer":
      return "int";
    case "number":
      return "float64";
    case "boolean":
      return "bool";
    case "string":
      return "string";
    case "array<integer>":
      return "[]int";
    case "array<number>":
      return "[]float64";
    case "array<boolean>":
      return "[]bool";
    case "array<string>":
      return "[]string";
  }
}

function goLiteral(value: unknown, type: FunctionValueType): string {
  if (!type.startsWith("array<")) {
    if (type === "string") return jsonString(value as string);
    if (type === "boolean") return value ? "true" : "false";
    return String(value);
  }

  const arr = value as unknown[];
  const inner = type.slice(6, -1) as FunctionValueType;
  return `${goType(type)}{${arr.map((x) => goLiteral(x, inner)).join(",")}}`;
}

function goHarness(
  studentCode: string,
  spec: FunctionSpec,
  token: string,
): string {
  if (/^\s*package\s+\w+/m.test(studentCode)) {
    throw new Error("go function mode expects function-only source");
  }

  const suffix = helperSuffix(token);
  const jsonAlias = `__pljson${suffix}`;
  const ioAlias = `__plio${suffix}`;
  const osAlias = `__plos${suffix}`;

  const names = spec.parameters.map((_, i) => `__prooflabArg${i}`);

  const parsing: string[] = [];

  spec.parameters.forEach((parameter, i) => {
    const name = names[i];

    parsing.push(`  var ${name} ${goType(parameter.type)}`);
    parsing.push(
      `  if err := ${jsonAlias}.Unmarshal(__prooflabArgs[${i}], &${name}); err != nil { panic("invalid function arguments") }`,
    );

    if (parameter.type === "integer") {
      parsing.push(
        `  if ${name} < -2147483648 || ${name} > 2147483647 { panic("invalid function arguments") }`,
      );
    }

    if (parameter.type === "array<integer>") {
      parsing.push(
        `  if len(${name}) > 10000 { panic("invalid function arguments") }`,
      );
      parsing.push(
        `  for _, __prooflabV := range ${name} { if __prooflabV < -2147483648 || __prooflabV > 2147483647 { panic("invalid function arguments") } }`,
      );
    }

    if (parameter.type.startsWith("array<") && parameter.type !== "array<integer>") {
      parsing.push(
        `  if len(${name}) > 10000 { panic("invalid function arguments") }`,
      );
    }
  });

  const call = `${spec.function_name}(${names.join(", ")})`;

  return `package main

import (
  ${jsonAlias} "encoding/json"
  ${ioAlias} "io"
  ${osAlias} "os"
)

${studentCode}

func main() {
  __prooflabRaw, __prooflabReadErr := ${ioAlias}.ReadAll(${osAlias}.Stdin)
  if __prooflabReadErr != nil {
    panic("invalid function arguments")
  }

  var __prooflabArgs []${jsonAlias}.RawMessage

  if err := ${jsonAlias}.Unmarshal(__prooflabRaw, &__prooflabArgs); err != nil {
    panic("invalid function arguments")
  }

  if len(__prooflabArgs) != ${spec.parameters.length} {
    panic("invalid function arguments")
  }

${parsing.join("\n")}

  __prooflabResult := ${call}

  __prooflabPayload, __prooflabErr :=
    ${jsonAlias}.Marshal(__prooflabResult)

  if __prooflabErr != nil {
    panic("unsupported function return value")
  }

  _, __prooflabWriteErr := ${osAlias}.Stdout.Write(
    []byte(
      "\\n" +
      ${jsonString(functionResultPrefix(token))} +
      ${jsonString('{"ok":true,"value":')} +
      string(__prooflabPayload) +
      ${jsonString("}")} +
      "\\n",
    ),
  )

  if __prooflabWriteErr != nil {
    panic(__prooflabWriteErr)
  }
}
`;
}

function rubyLiteral(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return jsonString(value);
  if (Array.isArray(value)) return `[${value.map(rubyLiteral).join(",")}]`;
  throw new Error("unsupported ruby literal");
}

function rubyHarness(
  studentCode: string,
  spec: FunctionSpec,
  token: string,
): string {
  const call = callExpression(
    spec,
    spec.parameters.map((_, i) => `__prooflab_args[${i}]`),
    "ruby",
  );

  return `require "json"

__prooflab_parse = JSON.method(:parse)
__prooflab_generate = JSON.method(:generate)
__prooflab_read = STDIN.method(:read)
__prooflab_write = STDOUT.method(:write)
__prooflab_flush = STDOUT.method(:flush)

${studentCode}

__prooflab_args = __prooflab_parse.call(__prooflab_read.call)

unless (
  __prooflab_args.is_a?(Array) &&
  __prooflab_args.length == ${spec.parameters.length}
)
  raise "invalid function arguments"
end

__prooflab_value = ${call}
__prooflab_payload = __prooflab_generate.call(__prooflab_value)

__prooflab_write.call(
  "\\n" +
  ${jsonString(functionResultPrefix(token))} +
  ${jsonString('{"ok":true,"value":')} +
  __prooflab_payload +
  ${jsonString("}")} +
  "\\n"
)

__prooflab_flush.call
`;
}

function phpString(value: string): string {
  return "'" + value.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

function phpLiteral(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return phpString(value);
  if (Array.isArray(value)) return `[${value.map(phpLiteral).join(",")}]`;
  throw new Error("unsupported php literal");
}

function phpHarness(
  studentCode: string,
  spec: FunctionSpec,
  token: string,
): string {
  const body = studentCode.replace(/^\s*<\?php\s*/i, "");

  const call = callExpression(
    spec,
    spec.parameters.map((_, i) => `$__prooflab_args[${i}]`),
    "php",
  );

  return `<?php

${body}

$__prooflab_args = json_decode(
    stream_get_contents(STDIN),
    true,
    512,
    JSON_THROW_ON_ERROR
);

if (
    !is_array($__prooflab_args)
    || !array_is_list($__prooflab_args)
    || count($__prooflab_args) !== ${spec.parameters.length}
) {
    throw new RuntimeException("invalid function arguments");
}

$__prooflab_value = ${call};

$__prooflab_payload = json_encode(
    $__prooflab_value,
    JSON_THROW_ON_ERROR
      | JSON_UNESCAPED_UNICODE
      | JSON_PRESERVE_ZERO_FRACTION
);

fwrite(
    STDOUT,
    "\\n"
      . ${jsonString(functionResultPrefix(token))}
      . ${jsonString('{"ok":true,"value":')}
      . $__prooflab_payload
      . ${jsonString("}")}
      . "\\n"
);

fflush(STDOUT);
`;
}
