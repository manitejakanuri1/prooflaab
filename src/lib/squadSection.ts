/**
 * A squad plays inside one section (MF-011, migration 167). Same key as the database: a squad's cohort,
 * else "GENERAL". The reserve list already sends each student's section in that form (tpo_reserves).
 */
export function squadsForStudent<T extends { cohort: string | null }>(squads: T[], studentSection: string | null | undefined): T[] {
  if (!studentSection) return [];
  return squads.filter((s) => ((s.cohort ?? "").trim() || "GENERAL") === studentSection.trim());
}
