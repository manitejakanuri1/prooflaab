/**
 * The runner (code-runner/) runs eight languages. A lesson's code example is shown with a Run
 * button only when it is one of them; everything else (Bash, SQL, YAML, Kotlin ...) stays plain
 * code. JavaScript that uses the page (document, window, alert) cannot run on the server, so it
 * is left as plain code too.
 */
const RUNNER: Record<string, string> = {
  python: "python", py: "python",
  javascript: "javascript", js: "javascript", node: "javascript",
  ruby: "ruby", php: "php",
  c: "c", cpp: "cpp", "c++": "cpp",
  go: "go", golang: "go",
  java: "java",
};

export function runnableLanguage(language: string | null | undefined, code: string): string | null {
  const lang = RUNNER[(language ?? "").trim().toLowerCase()];
  if (!lang) return null;
  if (lang === "javascript" && /\b(document|window|alert|localStorage|navigator)\b/.test(code)) return null;
  return lang;
}
