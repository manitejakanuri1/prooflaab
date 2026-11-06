// One answer can hold a main program plus up to 3 helper files (Python Lots only). They travel and are saved
// as one text: the main program first, then a marker line and the contents of each helper. An answer with no
// valid marker is just the main program, so every older answer still reads the same.
// Keep identical: src/lib/codeFiles.ts and supabase/functions/_shared/codeFiles.ts (CI compares them).

export const MAX_HELPER_FILES = 3;
const MARKER = "#==prooflab-file== ";
const MARKER_LINE = /^#==prooflab-file== ([^\r\n]*?)\r?$/gm;
const HELPER_NAME = /^[a-z][a-z0-9_]{0,39}\.py$/;

export interface HelperFile {
  name: string;
  content: string;
}

export interface CodeFiles {
  main: string;
  helpers: HelperFile[];
}

export function validHelperName(name: string): boolean {
  return HELPER_NAME.test(name) && name !== "main.py";
}

/** A marker counts only with a valid new name, within the limit. Any other is an ordinary Python comment. */
export function splitCodeFiles(code: string): CodeFiles {
  const seen = new Set<string>();
  const cuts: { name: string; start: number; end: number }[] = [];
  for (const m of code.matchAll(MARKER_LINE)) {
    const name = m[1];
    if (!validHelperName(name) || seen.has(name) || cuts.length >= MAX_HELPER_FILES) continue;
    seen.add(name);
    cuts.push({ name, start: m.index, end: m.index + m[0].length });
  }
  if (cuts.length === 0) return { main: code, helpers: [] };
  // The new line before and after a marker belongs to the marker, so joining gives back the same text.
  const beforeMarker = (at: number) => (at > 0 && code[at - 1] === "\n" ? at - 1 : at);
  const afterMarker = (at: number) => (code[at] === "\n" ? at + 1 : at);
  return {
    main: code.slice(0, beforeMarker(cuts[0].start)),
    helpers: cuts.map((cut, i) => ({
      name: cut.name,
      content: code.slice(afterMarker(cut.end), i + 1 < cuts.length ? beforeMarker(cuts[i + 1].start) : code.length),
    })),
  };
}

export function joinCodeFiles({ main, helpers }: CodeFiles): string {
  return [main, ...helpers.map((h) => `${MARKER}${h.name}\n${h.content}`)].join("\n");
}
