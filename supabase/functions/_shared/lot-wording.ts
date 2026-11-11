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

function hasLabel(text: string, label: string): boolean {
  return new RegExp(`^\\s*(\\*\\*)?${label}(\\*\\*)?\\s*:`, 'im').test(text);
}

const FILE_DELIVERABLE = /\b(upload|attach(ed|ment)?|(text|markdown|pdf|word|docx?|txt|csv|excel)\b[^.\n]{0,25}\bfile\b|\.(txt|md|pdf|docx?)\b|screenshot|github (repo|link))/i;
const UNSEEN_MATERIAL = /\b((article|document|transcript|log|data|dataset|table|code|snippet|function|program|query|script|class|method|file|email|spec(ification)?|report)\s+(below|above|attached|provided)|(see|use|read)\s+the\s+(attached|following)\s+(article|document|data|file)|from the attached)\b/i;
// QA week 8 (Nov 2026): Lots on REAL asked to "summarise the raw notes", "fix three wrong answers on a five-question
// sheet" and to use the "Infosys Interview Experience 2023 article" - none of it was shown. A named article, sheet,
// set of notes or handout the student is meant to work from must be in code_sample.
const NAMED_MATERIAL = /\b(raw notes|meeting notes|(the|this|that|these|those)\s+([\w'-]+\s+){0,6}(article|sheet|worksheet|handout|notes|blog post|write-up|transcript|log file))\b/i;
// "as a PDF", "a script and its output log": things that only make sense as a file.
const FILE_WORDS = /\b(pdf|output log|log file|(submit|send|share|attach)\s+(the|your|a)\s+(script|file|document))\b/i;
const FABRICATED_PAST = /\byou\s+(recently\s+|just\s+)?(attended|appeared (in|for)|sat (for|in)|took part in|were (interviewed|selected)|went (to|through))\b/i;
// QA round 2 (11 Nov 2026): REAL Lots said "pick five from your practice set", "the list given" and "repo excerpt"
// with nothing shown. A list, set or excerpt the student works from must be in code_sample.
const GIVEN_MATERIAL = /\b(practice set|(the|this)\s+([\w-]+\s+){0,2}(list|set|data|table|excerpt|questions|answers)\s+(given|provided|shown)|given (list|set|data|table|excerpt)|(repo|code|text|log|file)\s+excerpt)\b/i;
// QA round 2 item 1: "Time and Work Solver" and "Build a timed aptitude mock test" asked for a program but were
// made as written Lots (the page decides written vs code before the Lot is written).
const PROGRAM_ASK = /\b(write|build|create|implement|develop|code)\s+(a|an|the|your|one)?\s*([\w+#-]+\s+){0,4}(program|script|function|solver|calculator|simulator)\b/i;
const PROGRAM_TITLE = /\b(program|script|solver|calculator|simulator)\b/i;
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
  if (FILE_WORDS.test(text)) problems.push('Asks for a PDF, a log or a file; the student can only type in the answer box or the code editor, so ask them to paste the text there.');
  if (NAMED_MATERIAL.test(text) && !code) problems.push('Names notes, a sheet, an article or a log the student works from, but it is not included; put the material in code_sample or describe the facts in the task itself.');
  if (UNSEEN_MATERIAL.test(text) && !code) problems.push('Refers to material "below/attached/provided" that is not included; put it in code_sample or remove the reference.');
  if (FABRICATED_PAST.test(text)) problems.push('Assumes the student already did something (attended, appeared, was interviewed); describe a situation they can actually work on.');
  if (GIVEN_MATERIAL.test(text) && !code) problems.push('Points at a list, set or excerpt the student is not shown; put it in code_sample or write the facts into the task itself.');
  if (VOICE_IN_TASK.test(text)) problems.push('Asks for a recording or video; the voice explanation is a separate step after submitting.');
  return problems;
}


/** True when a Lot's title or "Your task:" line asks the student for a program (it must be a coding Lot). */
export function asksForProgram(lot: { title?: unknown; scenario?: unknown }): boolean {
  const title = typeof lot.title === 'string' ? lot.title : '';
  const text = typeof lot.scenario === 'string' ? lot.scenario : '';
  const task = text.match(/^\s*(\*\*)?your task(\*\*)?\s*:(.*)$/im)?.[3] ?? '';
  return PROGRAM_TITLE.test(title) || PROGRAM_ASK.test(`${title}\n${task}`);
}
