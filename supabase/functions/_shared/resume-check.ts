/**
 * Check 2 of resume intake: does this text look like a resume at all?
 *
 * Testers uploaded assignments, scripts and reports and got an ATS score and an
 * unlocked assessment. A resume almost always carries a way to reach the person
 * and a few standard section headings; an essay or a report rarely has both.
 * This is the free first pass. The AI's own is_resume verdict (check 3) catches
 * a document that happens to pass it.
 */

export const NOT_A_RESUME =
  'This does not look like a resume. Please upload your resume (PDF or DOCX).';

// A long academic CV is a few thousand words; a 30-page report is far more.
const MAX_WORDS = 6000;

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
// Ten or more digits, allowing the spaces, dashes and +country code people type.
const PHONE = /(?:\+?\d[\s-]?){10,}/;
const LINK = /linkedin\.com|github\.com/i;

const SECTIONS: RegExp[] = [
  /\beducation\b|\bacademic/i,
  /\bskills?\b/i,
  /\bprojects?\b/i,
  /\bexperience\b|\binternships?\b|\bemployment\b|\bwork history\b/i,
  /\bcertifications?\b|\bcertificates?\b/i,
  /\bsummary\b|\bobjective\b|\bprofile\b|\babout me\b/i,
  /\bachievements?\b|\bawards?\b|\bactivities\b|\bhobbies\b|\blanguages known\b/i,
];

/** Returns null when the text passes, or the reason it does not. */
export function resumeShapeProblem(text: string): string | null {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words > MAX_WORDS) return 'too long for a resume';
  if (!EMAIL.test(text) && !PHONE.test(text) && !LINK.test(text)) return 'no contact details';
  const found = SECTIONS.filter((re) => re.test(text)).length;
  if (found < 2) return 'no resume sections';
  return null;
}

/** The magic bytes of the file really are what its name claims. */
export function fileTypeMatches(bytes: Uint8Array, isPdf: boolean): boolean {
  const head = String.fromCharCode(...bytes.slice(0, 5));
  // %PDF- for PDF; a DOCX is a ZIP, which starts PK.
  return isPdf ? head === '%PDF-' : head.startsWith('PK');
}
