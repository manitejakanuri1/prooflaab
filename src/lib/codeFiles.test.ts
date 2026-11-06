import test from "node:test";
import assert from "node:assert/strict";
import { joinCodeFiles, MAX_HELPER_FILES, splitCodeFiles, validHelperName } from "./codeFiles.ts";

const main = "from reportlib import HEADER, summarise\nprint(HEADER)\n";
const helper = { name: "reportlib.py", content: "HEADER = 'Report'\n" };

test("an older answer with no marker is only the main program, exactly as saved", () => {
  for (const code of ["print(1)", "print(1)\n", "", "# file: x.py\nprint(1)", "\n\nprint(2)\n\n"]) {
    assert.deepEqual(splitCodeFiles(code), { main: code, helpers: [] });
  }
});

test("no helpers joins to the plain main program", () => {
  assert.equal(joinCodeFiles({ main, helpers: [] }), main);
});

test("main program and helpers come back exactly after joining and splitting", () => {
  const cases = [
    { main, helpers: [helper] },
    { main: "", helpers: [helper] },
    { main, helpers: [{ name: "a.py", content: "" }] },
    { main: "x = 1", helpers: [{ name: "a.py", content: "\n\n" }, { name: "b.py", content: "y = 2\n" }, { name: "c_1.py", content: "z" }] },
  ];
  for (const files of cases) assert.deepEqual(splitCodeFiles(joinCodeFiles(files)), files);
});

test("Windows line endings on a marker line still split", () => {
  const { helpers } = splitCodeFiles("print(1)\r\n#==prooflab-file== a.py\r\nx = 1\r\n");
  assert.equal(helpers[0].name, "a.py");
});

test("an unsafe or unknown name is never a file: it stays an ordinary comment", () => {
  for (const name of ["../x.py", "a/b.py", "/tmp/x.py", "main.py", "x.txt", "X.py", "__init__.py", ".py", "a b.py", ""]) {
    const code = `print(1)\n#==prooflab-file== ${name}\nprint(2)`;
    assert.equal(validHelperName(name), false, name);
    assert.deepEqual(splitCodeFiles(code), { main: code, helpers: [] }, name);
  }
});

test("at most 3 helpers: a fourth marker stays a comment inside the third file", () => {
  const code = ["m", "#==prooflab-file== a.py", "1", "#==prooflab-file== b.py", "2", "#==prooflab-file== c.py", "3", "#==prooflab-file== d.py", "4"].join("\n");
  const { helpers } = splitCodeFiles(code);
  assert.equal(helpers.length, MAX_HELPER_FILES);
  assert.equal(helpers[2].content, "3\n#==prooflab-file== d.py\n4");
});

test("the same helper name twice: the second marker stays a comment", () => {
  const { helpers } = splitCodeFiles("m\n#==prooflab-file== a.py\n1\n#==prooflab-file== a.py\n2");
  assert.deepEqual(helpers, [{ name: "a.py", content: "1\n#==prooflab-file== a.py\n2" }]);
});

test("a marker must be its own whole line", () => {
  const code = "s = '#==prooflab-file== a.py'\n  #==prooflab-file== b.py\n";
  assert.deepEqual(splitCodeFiles(code), { main: code, helpers: [] });
});
