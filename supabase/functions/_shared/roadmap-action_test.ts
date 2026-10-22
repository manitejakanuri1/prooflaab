import { assertEquals } from "jsr:@std/assert@1";
import { inAppAction } from "./roadmap-action.ts";

Deno.test("roadmap action: 'run it locally' is removed", () => {
  assertEquals(
    inAppAction("In ProofLab, build a small Node.js service with three endpoints (create, read, list) and run it locally."),
    "In ProofLab, build a small Node.js service with three endpoints (create, read, list).",
  );
});

Deno.test("roadmap action: 'on your laptop' becomes 'in ProofLab'", () => {
  assertEquals(inAppAction("Write the parser on your laptop."), "Write the parser in ProofLab.");
});

Deno.test("roadmap action: install / deploy are turned into in-app work", () => {
  assertEquals(inAppAction("Install Flask on your computer, then add one route."), "Use Flask in ProofLab, then add one route.");
  assertEquals(inAppAction("Build the API and deploy it to Render."), "Build the API and finish it in ProofLab.");
});

Deno.test("roadmap action: an in-app action is left exactly as it was", () => {
  const ok = "In ProofLab, design the schema for Expense Splitter: tables for users, groups, expenses.";
  assertEquals(inAppAction(ok), ok);
});
