/**
 * Owner E2E S3 (12 Nov 2026), N3 (13 Nov 2026): a student notification opens what it is about.
 * Shortlist opens the accept/decline section on lab.
 * Announcements / banners open and scroll to the announcement text.
 */
const BY_TYPE: Record<string, string> = {
  squad_placed: "/student/dashboard?tab=squad",
  weekly_progress: "/student/dashboard?tab=squad&view=season",
  retest_unlocked: "/student/dashboard?tab=profile&view=proof",
  shortlisted: "/student/dashboard?tab=lab#company-invites",
  sponsored_task: "/student/tasks/assigned",
  reminder: "/student/tasks/assigned",
};

export function studentNotificationLink(n: { type: string; link?: string | null; dedupe_key?: string | null }): string | null {
  if (n.type === "shortlisted") {
    if (!n.link || n.link === "/student/dashboard" || n.link === "/student/dashboard?tab=lab") {
      return "/student/dashboard?tab=lab#company-invites";
    }
    return n.link;
  }
  if (n.type === "announcement" || n.type === "banner") {
    let id = "";
    if (n.dedupe_key?.startsWith("announcement-")) {
      id = n.dedupe_key.slice("announcement-".length);
    } else if (n.dedupe_key?.startsWith("banner-")) {
      id = n.dedupe_key.slice("banner-".length);
    } else if (n.link && n.link.includes("announcement=")) {
      const match = n.link.match(/announcement=([^&]+)/);
      if (match) id = decodeURIComponent(match[1]);
    }
    return `/student/dashboard?tab=lab${id ? `&announcement=${encodeURIComponent(id)}` : ""}`;
  }
  const bare = !n.link || n.link === "/student/dashboard";
  if (!bare) return n.link!;
  return BY_TYPE[n.type] ?? n.link ?? null;
}
