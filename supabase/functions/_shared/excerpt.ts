/**
 * The first `max` characters of a crawled page's real text.
 *
 * The Lot writer used to take the first 800 characters of the stored page. For a page like a
 * PrepInsta interview article, the first ~11,800 characters are the site's menu and a "log in
 * to unlock" box, and the real text starts after that, so the AI wrote the task from a menu.
 * This drops images, turns links into their words, and keeps only lines that read like
 * sentences (7 or more words, and no sign-in / cookie / menu wording).
 */
const JUNK = /(sign in|log ?in|unlock|cookie|subscribe|skip to|privacy policy|terms (of|&)|all rights reserved|download the app|copyright|opens in new tab)/i;


// A menu or promo strip reads "Projects Industry Projects Placement ready projects Show recruiters ...":
// many capitalised words and no sentence punctuation. Real text has punctuation and mostly
// lowercase words.
function isSentenceLike(line: string): boolean {
  const words = line.split(' ');
  if (words.length < 8 || JUNK.test(line)) return false;
  if (!/[.?!:;,]/.test(line.replace(/\.\.\./g, ''))) return false;
  const capitals = words.filter((w) => /^[A-Z][A-Za-z]*$/.test(w)).length;
  return capitals / words.length <= 0.5;
}

export function pageExcerpt(markdown: string, max = 800): string {
  const cleaned = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')       // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');   // [text](url) -> text

  const prose = cleaned
    .split('\n')
    .map((l) => l.replace(/^[\s>*#\-]+/, '').replace(/\s+/g, ' ').trim())
    .filter(isSentenceLike)
    .join('\n');

  // A page with almost no sentence-like lines (a short list, a table): fall back to the page start.
  return (prose.length >= 80 ? prose : cleaned.replace(/\s+/g, ' ').trim()).slice(0, max);
}
