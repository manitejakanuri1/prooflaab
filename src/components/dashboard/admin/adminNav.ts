import {
  LayoutDashboard, Users, ClipboardList, Settings,
} from "lucide-react";

/**
 * The admin's four destinations (Home, People, Work, Operations) and the pages inside each, shared by the
 * sidebar (the four) and the dashboard (the tab row inside). One list, so the
 * two cannot drift apart. Notifications is the header bell, not an entry here.
 */
export const ADMIN_GROUPS = [
  { id: "home", label: "Home", icon: LayoutDashboard, children: [
    { id: "dashboard", label: "Overview" },
    { id: "analytics", label: "Reports" },
    { id: "announcements", label: "Announcements" },
  ] },
  { id: "people", label: "People", icon: Users, children: [
    { id: "students", label: "Students" },
    { id: "colleges", label: "Colleges" },
    { id: "startups", label: "Companies" },
    { id: "college-oversight", label: "College users" },
    { id: "student-oversight", label: "Student oversight" },
    { id: "settings", label: "Admins & roles" },
  ] },
  { id: "work", label: "Work", icon: ClipboardList, children: [
    { id: "task-oversight", label: "Lots & tasks" },
    { id: "daily-lots", label: "Daily Lots" },
    { id: "submissions", label: "Submissions" },
    { id: "reviewed-submissions", label: "Flags & reviews" },
    { id: "assign-tasks", label: "Assign tasks" },
    { id: "content-library", label: "Content library" },
    { id: "jobs", label: "Job sources" },
    { id: "resources", label: "Resources" },
  ] },
  { id: "operations", label: "Operations", icon: Settings, children: [
    { id: "token-usage", label: "AI usage" },
    { id: "ops-jobs", label: "Jobs & health" },
    { id: "security-events", label: "Security & audit" },
    { id: "student-trace", label: "Errors & traces" },
    { id: "bug-finder", label: "Bug finder" },
  ] },
];

// recruiter-oversight lives inside Companies now; an old link to it lands there.
export const groupOf = (tab: string) =>
  ADMIN_GROUPS.find((g) => g.children.some((c) => c.id === (tab === "recruiter-oversight" ? "startups" : tab)));
