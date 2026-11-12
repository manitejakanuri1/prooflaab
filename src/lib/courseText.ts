/** Full courses on the roadmap (owner 12 Nov 2026, migration 241): reading progress in plain words. */
export function readText(read: number, total: number): string {
  return read >= total && total > 0 ? `All ${total} chapters read` : `${read} of ${total} read`;
}

/** The chapter to open next: the first one not read yet (1-based), or 1 when all are read. */
export function nextUnread(read: Set<number>, total: number): number {
  for (let p = 1; p <= total; p++) if (!read.has(p)) return p;
  return 1;
}
