/**
 * The first stretch of `text` that parses as a JSON array, or null.
 *
 * Six functions pulled the array out of a model reply with /\[[\s\S]*\]/, which
 * takes everything from the FIRST "[" to the LAST "]". Any text after the array
 * that happens to contain a "]" (a note, a second array, a code sample) made
 * JSON.parse fail with "Unexpected non-whitespace character after JSON", and the
 * student saw a failed coding round. This tries each "[" and each following "]"
 * in turn, so the array parses as soon as it is complete. A trailing comma before
 * "}" or "]" is tolerated, as models often leave one.
 *
 * The caller still checks that the items look right: if the reply was cut off,
 * the first array that parses can be an inner one.
 */
export function firstJsonArray(text: string): any[] | null {
  const clean = (s: string) => s.replace(/,\s*([}\]])/g, '$1');
  for (let a = text.indexOf('['); a >= 0; a = text.indexOf('[', a + 1)) {
    for (let z = text.indexOf(']', a); z >= 0; z = text.indexOf(']', z + 1)) {
      try {
        const v = JSON.parse(clean(text.slice(a, z + 1)));
        if (Array.isArray(v)) return v;
      } catch { /* not complete yet, keep looking */ }
    }
  }
  return null;
}
