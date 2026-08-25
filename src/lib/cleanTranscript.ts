/**
 * Fixes the handful of things speech-to-text reliably mishears — technical
 * terms and spoken-aloud punctuation — without touching anything else.
 *
 * Deliberately does NOT remove "um", "uh", "hmm" or any other hesitation.
 * Those are part of what the grading AI is looking for (a signal a student
 * did the work themselves, not a defect to clean up) and the platform's own
 * scoring prompt says so explicitly. A separate tool this was adapted from
 * strips fillers by default — that half was left out on purpose.
 */

const TECH_TERMS: [RegExp, string][] = [
  [/\bget\s?hub\b/gi, "GitHub"],
  [/\bjason\b/gi, "JSON"],
  [/\ba\s?p\s?i\b/gi, "API"],
  [/\bj\s?s\b/gi, "JS"],
  [/\bb\s?p\b(?=\s|$)/gi, "VPN"],
  [/\bnode\s?j\s?s\b/gi, "Node.js"],
  [/\breact\s?j\s?s\b/gi, "React.js"],
  [/\bpost\s?gres\b/gi, "Postgres"],
  [/\bsequel\b/gi, "SQL"],
  [/\bdocker\s?file\b/gi, "Dockerfile"],
];

const SPOKEN_PUNCTUATION: [RegExp, string][] = [
  [/\s*\bfull\s?stop\b\s*/gi, ". "],
  [/\s*\bcomma\b\s*/gi, ", "],
  [/\s*\bquestion\s?mark\b\s*/gi, "? "],
];

export function cleanTranscript(text: string): string {
  let out = text;
  for (const [pattern, replacement] of TECH_TERMS) out = out.replace(pattern, replacement);
  for (const [pattern, replacement] of SPOKEN_PUNCTUATION) out = out.replace(pattern, replacement);
  return out.replace(/\s+/g, " ").replace(/\s+([.,?])/g, "$1").trim();
}
