/**
 * Owner E2E S3 (12 Nov 2026): a student notification opens what it is about. Older rows were written with the
 * bare '/student/dashboard' (the page the student is already on), so a click only closed the drawer. Migration 315
 * writes the right link for new rows; this maps the bare link by type for the old ones. Any other link is kept.
 */
const BY_TYPE: Record<string, string> = {
  squad_placed: "/student/dashboard?tab=squad",
  weekly_progress: "/student/dashboard?tab=squad&view=season",
  retest_unlocked: "/student/dashboard?tab=profile&view=proof",
  shortlisted: "/student/dashboard?tab=lab",
  sponsored_task: "/student/tasks/assigned",
  reminder: "/student/tasks/assigned",
};

export function studentNotificationLink(n: { type: string; link?: string | null; dedupe_key?: string | null }): string | null {
  const bare = !n.link || n.link === "/student/dashboard";
  if (!bare) return n.link!;
  if (n.type === "announcement") {
    const id = n.dedupe_key?.startsWith("announcement-") ? n.dedupe_key.slice("announcement-".length) : "";
    return `/student/dashboard?tab=lab${id ? `&announcement=${encodeURIComponent(id)}` : ""}`;
  }
  return BY_TYPE[n.type] ?? n.link ?? null;
}
