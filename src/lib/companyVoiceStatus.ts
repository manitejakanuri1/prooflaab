import { of10 } from "./lotMarksText.ts";

/**
 * F9 / S7 (13 Nov 2026): Standardized voice status words across company screens.
 * Replaces "Voice not tested", "no voice score", "No spoken explanation yet"
 * and "Spoken explanation not scored…".
 *
 * One set of voice words everywhere on company screens:
 * - "Voice 7.2/10"
 * - "1 voice try, not scored"
 * - "N voice tries, not scored"
 * - "No voice yet"
 */
export function companyVoiceText(
  score: number | null | undefined,
  tries: number = 0,
): string {
  if (score != null && Number(score) > 0) {
    return `Voice ${of10(score)}`;
  }
  if (tries === 1) {
    return "1 voice try, not scored";
  }
  if (tries > 1) {
    return `${tries} voice tries, not scored`;
  }
  return "No voice yet";
}
