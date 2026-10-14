// S39 architecture freeze: the college screens keep the controls they had at TEJA 7704a98. OFFLINE, reads source only.
// The CI workflow also refuses ANY change under src/ against 7704a98; this file says what must stay, by name.
//
//   node --test scripts/dev-tools/sidhu_s39_ui_contract.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { read } from "./sidhu_s39_squad_fixture.mjs";

const college = (f) => read(`src/components/dashboard/college/${f}`);

test("navigation: the four college destinations, in order, with their names", () => {
  const nav = [...college("CollegeDashboardSidebar.tsx").matchAll(/\{ id: "(\w+)",\s+label: "([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(nav, ["home:Home", "students:Students", "squads:Squads", "insights:Insights"]);
});

test("Import students: Branch is a dropdown of the known branches plus Other…; the typed box appears only for Other…", () => {
  const ui = college("TpoImportStudents.tsx");
  assert.match(ui, /<Select value=\{branch\} onValueChange=\{setBranch\}>/);
  assert.match(ui, /<SelectValue placeholder="Branch" \/>/);
  assert.match(ui, /branches\.map\(\(b\) => <SelectItem key=\{b\} value=\{b\}>\{b\}<\/SelectItem>\)/);
  assert.match(ui, /<SelectItem value="__other__">Other…<\/SelectItem>/);
  assert.match(ui, /\{branch === "__other__" && \(\s*<Input/, "the typed box is only the Other… escape");
  assert.match(ui, /supabase\.rpc\("tpo_naming_themes"/, "choices still come from the naming themes (migration 109 restores them on staging)");
  assert.match(ui, /Pick a branch first/);
});

test("Students: the Branch filter stays a dropdown with All branches", () => {
  const ui = college("TpoStudents.tsx");
  assert.match(ui, /<Select value=\{branch\} onValueChange=\{setBranch\}>[\s\S]{0,200}<SelectValue placeholder="Branch" \/>/);
  assert.match(ui, /<SelectItem value="all">All branches<\/SelectItem>/);
});

test("Squads: Assign and Manage tabs, Create squad, Generate (tpo_form_squads) and Rebalance stay", () => {
  const ui = college("TpoSquads.tsx");
  assert.match(ui, /<TabsTrigger value="assign">Assign<\/TabsTrigger>/);
  assert.match(ui, /<TabsTrigger value="manage">Manage<\/TabsTrigger>/);
  assert.match(ui, /"Create squad"/);
  assert.match(ui, /supabase\.rpc\("tpo_form_squads"/);
  assert.match(ui, /tpo_rebalance_squads/);
  assert.match(ui, /assign_to_squad/);
});

test("Assign Tasks: both Branch pickers stay dropdowns", () => {
  const ui = read("src/components/dashboard/assignTasks/AssignTasksScreen.tsx");
  assert.equal((ui.match(/<SelectValue placeholder="Select branch" \/>/g) ?? []).length, 2);
  assert.equal((ui.match(/<SelectValue placeholder="All branches" \/>/g) ?? []).length, 2);
});

test("College onboarding: Branches Offered stays a list of checkboxes; Profile keeps its comma box (unchanged since Sep 2025)", () => {
  assert.match(read("src/components/onboarding/CollegeWizard.tsx"), /<Label>Branches Offered \*<\/Label>[\s\S]{0,200}<Checkbox/);
  assert.match(college("CollegeProfilePage.tsx"), /<Label htmlFor="branches">Branches Offered<\/Label>\s*<Textarea/);
});
