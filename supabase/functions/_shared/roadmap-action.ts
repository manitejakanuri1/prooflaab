/**
 * Roadmap actions are done inside ProofLab: in its code editor or as a written answer.
 * The model still sometimes adds "and run it locally" or "install X on your machine"
 * (seen on staging 20 Oct 2026). Those words are removed or turned into "in ProofLab",
 * so a task never sends the student outside the app. The prompt asks for the same thing;
 * this is the guarantee. Order matters: the specific phrases go before the general one.
 */
const OUTSIDE: [RegExp, string][] = [
  [/\b(install|download|set up|setup)\s+([\w.+#-]+(\s[\w.+#-]+)?)\s+(on|onto)\s+(your|a)\s+\w+/gi, "use $2 in ProofLab"],
  [/\bdeploy (it|them|this|the \w+) (to|on) [\w .-]+?(?=[.,;]|$)/gi, "finish $1 in ProofLab"],
  [/,?\s*(and|then)\s+(run|test|deploy|host)\s+(it|them|this|the \w+)\s+(locally|on your (own )?(machine|laptop|computer|system))/gi, ""],
  [/\s*\b(locally|on your (own )?(machine|laptop|computer|system|pc))\b/gi, " in ProofLab"],
];

export function inAppAction(text: string): string {
  let out = text;
  for (const [re, to] of OUTSIDE) out = out.replace(re, to);
  return out
    .replace(/\bin ProofLab(\s+in ProofLab)+/gi, "in ProofLab")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;])/g, "$1")
    .trim()
    .replace(/^[a-z]/, (c) => c.toUpperCase());
}
