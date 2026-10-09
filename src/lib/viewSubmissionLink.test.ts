import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/*
 * Student > Floor > completed task > "View Submission" opens that task's card
 * in Build-log > Recent work. The two screens agree only through a URL and an
 * element id, so this pins both ends. It reads the source: the unit tests here
 * have no browser, and the contract is three strings.
 */
const source = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const tasksPage = source("components/dashboard/student/StudentAssignedTasksPage.tsx");
const buildLog = source("components/dashboard/student/BuildLogEntries.tsx");
const dashboard = source("components/dashboard/student/StudentDashboardContent.tsx");
const page = source("pages/StudentDashboard.tsx");

test("View Submission goes to the Build-log entry of that task", () => {
  assert.ok(
    tasksPage.includes(
      "navigate(`/student/dashboard?tab=log&view=entries&task=${encodeURIComponent(task.id)}`)",
    ),
    "the completed-task button must link to the Build-log entry",
  );
});

test("the dashboard opens Build-log > Recent work from that link", () => {
  assert.match(page, /useUrlTab\("tab"/, "the destination comes from ?tab=");
  assert.match(dashboard, /\["lab", "log", "squad", "profile"\]/, "log is a destination");
  assert.match(dashboard, /useUrlTab\("view"/, "the inner tab comes from ?view=");
  assert.match(dashboard, /const LOG = \["entries"/, "entries is a Build-log tab");
  assert.match(dashboard, /<TabsContent value="entries"[^>]*>\s*<BuildLogEntries \/>/);
});

test("Build-log finds the card by the same task id", () => {
  assert.ok(buildLog.includes('searchParams.get("task")'), "reads ?task=");
  assert.ok(buildLog.includes("<Card id={`build-log-${e.task_id}`}>"), "card carries the id");
  assert.ok(
    buildLog.includes("document.getElementById(`build-log-${targetTaskId}`)"),
    "looks the card up by the same id",
  );
});

test("a task id from the link is only ever matched against the student's own entries", () => {
  // The link cannot read anything: it scrolls to a card that useBuildLog()
  // (the signed-in student's own rows) already rendered, or does nothing.
  assert.ok(buildLog.includes("entries.some(e => e.task_id === targetTaskId)"));
  assert.equal(
    /\.eq\([^)]*targetTaskId/.test(buildLog),
    false,
    "the task id from the URL must never be used in a database query",
  );
});
