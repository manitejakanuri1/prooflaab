import { useEffect, useRef, useState } from "react";
import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react";

/**
 * The editor for the lesson boxes: Monaco, the engine VS Code is built on. Colours, line numbers,
 * bracket matching, suggestions as you type, and red marks on mistakes.
 *
 * - JavaScript, CSS and JSON: Monaco checks them while you type, so a syntax mistake is
 *   underlined at once (undefined names are not flagged: lesson snippets are pieces of programs).
 * - Every language: suggestions for its keywords and common functions (list below), plus words
 *   already in the file.
 * - Python, Java, C, C++, Go, Ruby, PHP have no live checker in the browser, so after Run the line
 *   the error points to is marked red (errorLine).
 */
interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: string;          // Monaco language id: python, javascript, java, c, cpp, go, ruby, php, html, css
  label: string;             // read out by screen readers
  errorLine?: number | null; // 1-based line to mark red after a run
  errorText?: string;
}

const WORDS: Record<string, string[]> = {
  python: ["print", "input", "len", "range", "int", "float", "str", "bool", "list", "dict", "set", "tuple", "type", "sum", "min", "max", "sorted", "enumerate", "zip", "map", "filter", "open", "abs", "round",
    "def", "class", "return", "import", "from", "as", "if", "elif", "else", "for", "while", "in", "not", "and", "or", "is", "None", "True", "False", "try", "except", "finally", "raise", "with", "lambda", "pass", "break", "continue", "yield", "self", "append", "split", "join", "strip", "format", "keys", "values", "items"],
  java: ["public", "private", "static", "void", "class", "int", "double", "boolean", "String", "new", "return", "if", "else", "for", "while", "try", "catch", "final", "extends", "implements", "import", "package", "System.out.println", "ArrayList", "HashMap", "List", "Map", "length", "equals", "main"],
  c: ["#include", "printf", "scanf", "int", "float", "double", "char", "void", "return", "if", "else", "for", "while", "switch", "case", "break", "struct", "sizeof", "malloc", "free", "main", "stdio.h", "stdlib.h", "string.h", "strlen", "strcpy"],
  cpp: ["#include", "std::cout", "std::cin", "std::endl", "std::string", "std::vector", "std::map", "using namespace std;", "int", "double", "char", "bool", "void", "return", "if", "else", "for", "while", "class", "struct", "template", "auto", "const", "new", "delete", "push_back", "size", "main", "iostream", "vector", "string"],
  go: ["package", "import", "func", "var", "const", "type", "struct", "interface", "return", "if", "else", "for", "range", "switch", "case", "go", "defer", "make", "len", "append", "fmt.Println", "fmt.Printf", "main", "string", "int", "float64", "bool", "error", "nil"],
  ruby: ["puts", "print", "def", "end", "class", "module", "if", "elsif", "else", "unless", "while", "until", "for", "in", "do", "return", "yield", "require", "attr_accessor", "each", "map", "select", "nil", "true", "false", "self", "begin", "rescue", "ensure"],
  php: ["<?php", "echo", "print", "function", "return", "if", "elseif", "else", "foreach", "for", "while", "class", "public", "private", "new", "array", "count", "strlen", "isset", "empty", "require", "include", "null", "true", "false", "$this"],
};

let registered = false;
const beforeMount: BeforeMount = (monaco) => {
  // JavaScript: underline syntax mistakes while typing, but not names the snippet does not define.
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
  if (registered) return;
  registered = true;
  for (const [lang, words] of Object.entries(WORDS)) {
    monaco.languages.registerCompletionItemProvider(lang, {
      provideCompletionItems: (model, position) => {
        const w = model.getWordUntilPosition(position);
        const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: w.startColumn, endColumn: w.endColumn };
        return { suggestions: words.map((label) => ({ label, kind: monaco.languages.CompletionItemKind.Keyword, insertText: label, range })) };
      },
    });
  }
};

const CodeEditor = ({ value, onChange, language, label, errorLine, errorText }: CodeEditorProps) => {
  const ref = useRef<Parameters<OnMount> | null>(null);
  const [ready, setReady] = useState(false);
  const lines = value.split("\n").length;
  const height = Math.min(20, Math.max(8, lines + 1)) * 19 + 12;

  // Mark (or clear) the line the last run complained about.
  useEffect(() => {
    if (!ready || !ref.current) return;
    const [editor, monaco] = ref.current;
    const model = editor.getModel();
    if (!model) return;
    const line = errorLine && errorLine <= model.getLineCount() ? errorLine : null;
    monaco.editor.setModelMarkers(model, "run", line ? [{
      severity: monaco.MarkerSeverity.Error, message: errorText || "This line has the error",
      startLineNumber: line, endLineNumber: line, startColumn: 1, endColumn: model.getLineMaxColumn(line),
    }] : []);
    if (line) editor.revealLineInCenterIfOutsideViewport(line);
  }, [ready, errorLine, errorText]);

  return (
    <Editor
      height={`${height}px`}
      language={language}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      theme="vs-dark"
      beforeMount={beforeMount}
      onMount={(editor, monaco) => { ref.current = [editor, monaco]; setReady(true); }}
      options={{
        ariaLabel: label,
        minimap: { enabled: false },
        fontSize: 13,
        tabSize: 4,
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        bracketPairColorization: { enabled: true },
        quickSuggestions: { other: true, comments: false, strings: false },
        fixedOverflowWidgets: true, // the suggestion list must not be clipped by the lesson window
        padding: { top: 8, bottom: 8 },
        renderLineHighlight: "line",
      }}
    />
  );
};

export default CodeEditor;
