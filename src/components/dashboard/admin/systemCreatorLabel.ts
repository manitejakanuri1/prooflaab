// MF-091 / E2E-8: Lots written by the system or a company page have no human creator row.
// Daily Lots: created_by_type 'system', source 'daily_lot'. Company Lots: created_by_type 'recruiter', source 'sponsored'.
export const systemCreatorLabel = (task: { source?: string | null; created_by_type?: string | null; lot_date?: string | null; is_ai_generated?: boolean | null }) => {
  if (task.source === "sponsored" || task.created_by_type === "recruiter") return "Company Lot";
  if (task.source === "daily_lot" || task.created_by_type === "system" || task.lot_date) return "Daily Lot (system)";
  return task.is_ai_generated ? "ProofLab (AI)" : "ProofLab";
};

/** S12: a task category as shown ("technical" -> "Technical"; empty -> "General"). The stored value is not changed. */
export const categoryLabel = (c: string | null | undefined) => (c ? c.charAt(0).toUpperCase() + c.slice(1) : "General");
