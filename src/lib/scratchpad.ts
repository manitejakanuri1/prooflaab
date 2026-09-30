/**
 * The optional "try your code" box on a written task (migration 48).
 * Shown only when the task's rubric config names one of the code runner's languages
 * (task_rubric_config.scratch_language). Nothing typed in it is saved, submitted or graded.
 */

export const SCRATCH_LANGUAGES = ["python", "javascript", "java", "c", "cpp", "go", "ruby", "php"] as const;
export type ScratchLanguage = (typeof SCRATCH_LANGUAGES)[number];

const LABELS: Record<ScratchLanguage, string> = {
  python: "Python", javascript: "JavaScript", java: "Java", c: "C", cpp: "C++", go: "Go", ruby: "Ruby", php: "PHP",
};

/** The language to show a scratchpad for, or null for no scratchpad (anything unknown counts as none). */
export function scratchLanguage(value: unknown): ScratchLanguage | null {
  return typeof value === "string" && (SCRATCH_LANGUAGES as readonly string[]).includes(value)
    ? (value as ScratchLanguage)
    : null;
}

export const scratchLabel = (lang: ScratchLanguage) => LABELS[lang];

/** The one body submit-written-task receives: the written answer only, never scratch code. */
export const writtenSubmitBody = (taskId: string, answer: string) => ({ task_id: taskId, answer });
