import {
  LayoutDashboard, Users, ClipboardList, Settings,
} from "lucide-react";

/**
 * The admin's four destinations and the pages inside each, shared by the
 * sidebar (the four) and the dashboard (the tab row inside). One list, so the
 * two cannot drift apart. Notifications is the header bell, not an entry here.
 */
export const ADMIN_GROUPS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, children: [
    { id: "dashboard", label: "Dashboard" },
    { id: "analytics", label: "Reports & Analytics" },
  ] },
  { id: "people", label: "People", icon: Users, children: [
    { id: "students", label: "Students" },
    { id: "startups", label: "Companies" },
    { id: "colleges", label: "Colleges" },
    { id: "college-oversight", label: "College Oversight" },
    { id: "student-oversight", label: "Student Oversight" },
  ] },
  { id: "work-queue", label: "Work Queue", icon: ClipboardList, children: [
    { id: "proof-submissions", label: "Proof Review" },
    { id: "reviewed-submissions", label: "Flagged" },
    { id: "task-oversight", label: "Task Oversight" },
    { id: "assign-tasks", label: "Assign Tasks" },
    { id: "xp-moderation", label: "Trust & XP" },
  ] },
  { id: "platform", label: "Platform", icon: Settings, children: [
    { id: "jobs", label: "Jobs" },
    { id: "resources", label: "Resources" },
    { id: "announcements", label: "Announcements" },
    { id: "content-library", label: "Content Library" },
    { id: "token-usage", label: "Token Usage" },
    { id: "security-events", label: "Security Events" },
    { id: "student-trace", label: "Student Trace" },
    { id: "bug-finder", label: "Bug Finder" },
    { id: "settings", label: "Settings & Roles" },
  ] },
];

// recruiter-oversight lives inside Companies now; an old link to it lands there.
export const groupOf = (tab: string) =>
  ADMIN_GROUPS.find((g) => g.children.some((c) => c.id === (tab === "recruiter-oversight" ? "startups" : tab)));
