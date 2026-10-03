// Splits a Lot written to the wording contract (supabase/functions/_shared/lot-wording.ts)
// into labelled sections for the task screen. Older Lots without labels return null
// and keep the existing paragraph view.

export const LOT_LABELS = ["Your task", "Input", "Output", "Constraints", "Example", "Why", "What to write"] as const;

export interface LotSection {
  label: string;
  text: string;
}

const LABEL_LINE = new RegExp(`^\\s*(?:\\*\\*)?(${LOT_LABELS.join("|")})(?:\\*\\*)?\\s*:\\s*(?:\\*\\*)?\\s*(.*)$`, "i");

/** [{label:'Context'...}, {label:'Your task'...}, ...] or null when the text has fewer than 2 labels. */
export function splitLotSections(text: string): LotSection[] | null {
  const sections: LotSection[] = [{ label: "Context", text: "" }];
  let labelled = 0;
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(LABEL_LINE);
    if (m) {
      const canonical = LOT_LABELS.find((l) => l.toLowerCase() === m[1].toLowerCase()) ?? m[1];
      sections.push({ label: canonical, text: m[2].trim() });
      labelled++;
    } else {
      const last = sections[sections.length - 1];
      last.text = last.text ? `${last.text}\n${raw.trim()}` : raw.trim();
    }
  }
  if (labelled < 2) return null;
  return sections.map((s) => ({ ...s, text: s.text.trim() })).filter((s) => s.text);
}
