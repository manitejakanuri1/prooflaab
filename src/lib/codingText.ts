/**
 * Assign test 12 Nov 2026 (item 2): a written teamwork question saved as "Coding" became a Python test that
 * expected one fixed paragraph - nobody could pass it. A Coding task must read like code: it names a
 * language or code words, or says what goes in and what comes out.
 * ponytail: keyword check, no AI; a false "not coding" only asks the author to pick Writing or add input/output.
 */
const CODE_WORDS = /\b(python|java|javascript|typescript|c\+\+|cpp|c#|golang|rust|sql|query|function|method|class|array|list|string|integer|loop|recursion|algorithm|program|code|script|api|stdin|stdout|print|return|compile|regex|json|dictionary|hash ?map|linked list|stack|queue|tree|graph|sort|binary)\b/gi;
const IO_WORDS = /\b(input|output)\b/i;

export function looksLikeCoding(text: string): boolean {
  const hits = new Set((text.match(CODE_WORDS) ?? []).map((w) => w.toLowerCase()));
  return hits.size >= 2 || (hits.size >= 1 && IO_WORDS.test(text));
}

export const NOT_CODING_HINT =
  "This reads like a written question, so a code test cannot check it. Choose Writing, or say what the code takes in and must print.";
