// The wording contract every generated Lot must meet before it is saved.
//
// Production Lots on 3 Oct 2026 asked students to "submit a plain text file"
// (there is no upload), to "use the attached PrepInsta article" (nothing was
// attached), to write about a drive they "recently attended" (they had not), and
// to "record yourself" inside a written task. Each of those is caught here, with
// no AI involved, and fed back to the generator as a reason to rewrite.
//
// Contract (labels on their own lines, plain text):
//   <2-4 sentences of context>
//   Your task: ...
//   coding  -> Input: / Output: / Example: / Why: (Constraints: optional)
//   written -> What to write: ... (in the answer box, roughly how long)

export type LotMode = 'sandbox' | 'rubric';

export const SECTION_LABELS = ['Your task', 'Input', 'Output', 'Constraints', 'Example', 'Why', 'What to write'] as const;

function hasLabel(text: string, label: string): boolean {
  return new RegExp(`^\\s*(\\*\\*)?${label}(\\*\\*)?\\s*:`, 'im').test(text);
}

const FILE_DELIVERABLE = /\b(upload|attach(ed|ment)?|(text|markdown|pdf|word|docx?|txt|csv|excel)\b[^.\n]{0,25}\bfile\b|\.(txt|md|pdf|docx?)\b|screenshot|github (repo|link))/i;
const UNSEEN_MATERIAL = /\b((article|document|transcript|log|data|dataset|table|code|snippet|function|program|query|script|class|method|file|email|spec(ification)?|report)\s+(below|above|attached|provided)|(see|use|read)\s+the\s+(attached|following)\s+(article|document|data|file)|from the attached)\b/i;
const FABRICATED_PAST = /\byou\s+(recently\s+|just\s+)?(attended|appeared (in|for)|sat (for|in)|took part in|were (interviewed|selected)|went (to|through))\b/i;
const VOICE_IN_TASK = /\b(record (yourself|a (video|voice|audio))|voice (note|recording)|video)\b/i;

/** Problems with this Lot's wording; [] means it may be published. */
export function lotWordingProblems(lot: { title?: unknown; scenario?: unknown; code_sample?: unknown }, mode: LotMode): string[] {
  const title = typeof lot.title === 'string' ? lot.title.trim() : '';
  const text = typeof lot.scenario === 'string' ? lot.scenario.trim() : '';
  const code = typeof lot.code_sample === 'string' ? lot.code_sample.trim() : '';
  const problems: string[] = [];

  if (!title || title.length > 90) problems.push('Give a short natural title (under 90 characters).');
  if (text.length < 120) problems.push('The task is too short to understand on first read.');
  if (text.length > 1600) problems.push('The task is too long; keep context to 2-4 short sentences.');
  if (!hasLabel(text, 'Your task')) problems.push('Missing a "Your task:" line that says exactly what to do.');

  if (mode === 'sandbox') {
    for (const label of ['Input', 'Output', 'Example', 'Why']) {
      if (!hasLabel(text, label)) problems.push(`Missing a "${label}:" line (coding tasks need Input, Output, Example and Why).`);
    }
  } else if (!hasLabel(text, 'What to write')) {
    problems.push('Missing a "What to write:" line saying what goes in the answer box and roughly how long.');
  }

  if (FILE_DELIVERABLE.test(text)) problems.push('Asks for a file, upload, attachment or link; the student can only type in the answer box or the code editor.');
  if (UNSEEN_MATERIAL.test(text) && !code) problems.push('Refers to material "below/attached/provided" that is not included; put it in code_sample or remove the reference.');
  if (FABRICATED_PAST.test(text)) problems.push('Assumes the student already did something (attended, appeared, was interviewed); describe a situation they can actually work on.');
  if (VOICE_IN_TASK.test(text)) problems.push('Asks for a recording or video; the voice explanation is a separate step after submitting.');
  return problems;
}
