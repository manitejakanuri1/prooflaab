/** Full courses on the roadmap (owner 12 Nov 2026, migration 241): reading progress in plain words. */
export function readText(read: number, total: number): string {
  return read >= total && total > 0 ? `All ${total} chapters read` : `${read} of ${total} read`;
}

/** The chapter to open next: the first one in reading order not read yet, or the first when all are read.
 *  `order` = chapter positions in reading order (migration 260: a chapter can sit between two others). */
export function nextUnread(read: Set<number>, order: number[]): number {
  return order.find((p) => !read.has(p)) ?? order[0] ?? 1;
}
