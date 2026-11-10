// Polish pass screenshots on the TEST website only. Reads TEST logins from the owner's file, never prints them.
// node scripts/dev-tools/polish_shots.mjs <loginsFile> <outDir> <label>
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const { chromium } = createRequire(process.env.PW_FROM ?? import.meta.url)("playwright");
import { cookieSignIn } from "./bff_login.mjs";

const [file, out, label] = process.argv.slice(2);
const BASE = "https://prooflab-staging.web.app";
mkdirSync(out, { recursive: true });

// Blocks look like: "Student 08 (CSE-A)\n  Name: ..\n  Email: ..\n  Password: .."
const logins = {};
for (const block of readFileSync(file, "utf8").split(/\r?\n\s*\r?\n/)) {
  const head = block.trim().split(/\r?\n/)[0] ?? "";
  const email = block.match(/Email:\s*(\S+)/)?.[1], password = block.match(/Password:\s*(\S+)/)?.[1];
  if (email && password) logins[head.split(" (")[0].trim()] = { email, password };
}

const SHOTS = {
  "Student 08": [
    ["student-daily", "/student/dashboard?tab=lab"],
    ["student-recent-work", "/student/dashboard?tab=log&view=entries"],
    ["student-progress", "/student/dashboard?tab=log&view=progress"],
    ["student-skills", "/student/dashboard?tab=log&view=skills"],
    ["student-squad", "/student/dashboard?tab=squad"],
  ],
  "College": [["college-students", "/college/dashboard?tab=students"], ["college-squads", "/college/dashboard?tab=squads"]],
  "Company A": [["company-talent", "/company/dashboard?tab=talent"]],
  "Admin": [["admin-daily-lots", "/admin/dashboard?tab=daily-lots"]],
};

const browser = await chromium.launch();
try {
  for (const [who, pages] of Object.entries(SHOTS)) {
    const creds = logins[who];
    if (!creds) { console.log(`SKIP ${who}: no login block`); continue; }
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      await cookieSignIn(ctx, BASE, creds);
      const page = await ctx.newPage();
      for (const [name, path] of pages) {
        await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(2500);
        await page.screenshot({ path: `${out}/${label}-${name}.png`, fullPage: true });
        console.log(`OK ${label}-${name}`);
      }
    } catch (e) { console.log(`FAIL ${who}: ${String(e.message).slice(0, 120)}`); }
    await ctx.close();
  }
} finally { await browser.close(); }
