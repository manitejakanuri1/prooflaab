// S34 write recipes for Sidhu's live staging suite (sidhu_s32_live_e2e.mjs loads this file).
// Same contract as his: role, fixtures (env vars that must be set or the recipe is BLOCKED, never passed),
// run(page, ctx) -> detail (a real browser on the deployed staging site), db(ctx) -> ONE read-only SELECT that
// proves the stored effect, matches -> the inventory rows this recipe covers.
//
// Nothing here has been run: there are no authorized staging logins yet. Selectors come from the source of the
// S34 screens; a selector that does not match on staging FAILS the recipe, it does not pass it.
//
// Fixtures the owner must approve first:
//   E2E_FIXTURE_VOICE_CANDIDATE_NAME / _VOICE_ID  a discoverable fixture student who switched audio sharing on
//                                                 (signed in as themself) and has one scored recording
//   E2E_FIXTURE_DELETE_STUDENT_ID                 the THROWAWAY student the "student" role signs in as. Staging and
//                                                 production share Google Identity: this login is deleted for good.
const since = "created_at > now() - interval '30 minutes'";
const openSettings = async (p, x, button) => {
  await x.go("/admin/dashboard?tab=settings");
  await p.getByRole("button", { name: button }).first().click();
  await p.getByRole("dialog").waitFor({ timeout: 15000 });
};

export default [
  { id: "s34-admin-email-template", role: ["admin"], fixtures: [], matches: /EmailTemplatesDialog\.tsx|Configure Email Templates/,
    async run(p, x) {
      const subject = `S34 E2E ${x.runId}`;
      await openSettings(p, x, /Configure Email Templates/);
      await p.locator("#email-subject").fill(subject);
      await p.locator("#email-intro").fill(`Hello {{name}}, this is the S34 live check ${x.runId}.`);
      await x.expectCall(() => p.getByRole("button", { name: /^\s*Save\s*$/ }).click(), /\/api\/db\/rpc\/admin_save_email_template/, "POST");
      await openSettings(p, x, /Configure Email Templates/);            // a fresh page: the wording must come back from the database
      await p.getByText("Using your wording.").waitFor({ timeout: 15000 });
      if ((await p.locator("#email-subject").inputValue()) !== subject) throw new Error("saved subject did not survive a reload");
      // Real delivery: the function must answer success. "Not switched on" shows a failure toast and fails here.
      await x.expectCall(() => p.getByRole("button", { name: /Send test to me/ }).click(), /\/api\/functions\/send-onboarding-email/, "POST", 60000);
      await p.getByText("Test email sent").first().waitFor({ timeout: 15000 });
      await x.expectCall(() => p.getByRole("button", { name: /Use built-in wording/ }).click(), /\/api\/db\/rpc\/admin_save_email_template/, "POST");
      await p.getByText("Using the built-in wording.").waitFor({ timeout: 15000 });
      return "saved, survived reload, test email accepted by the mail provider, built-in wording restored";
    },
    db: () => `select 'S32DB ' || count(*) from public.security_events where event_type = 'email_template_changed' and ${since};`, expectDb: ">=2" },

  { id: "s34-admin-notification-rule", role: ["admin"], fixtures: [], matches: /NotificationRulesDialog\.tsx|Manage Notification Rules/,
    async run(p, x) {
      await openSettings(p, x, /Manage Notification Rules/);
      const first = p.getByRole("dialog").getByRole("switch").first();
      await first.waitFor({ timeout: 15000 });                          // no rule rows = nothing to prove = failure
      if ((await first.getAttribute("aria-checked")) !== "true") throw new Error("first rule is already off: restore staging before the run");
      await x.expectCall(() => first.click(), /\/api\/db\/rpc\/admin_set_notification_rule/, "POST");
      await openSettings(p, x, /Manage Notification Rules/);
      const again = p.getByRole("dialog").getByRole("switch").first();
      await again.waitFor({ timeout: 15000 });
      if ((await again.getAttribute("aria-checked")) !== "false") throw new Error("the rule did not stay off after a reload");
      await x.expectCall(() => again.click(), /\/api\/db\/rpc\/admin_set_notification_rule/, "POST");   // back on
      return "rule switched off, stayed off across reload, switched on again";
    },
    db: () => `select 'S32DB ' || count(*) from public.security_events where event_type = 'notification_rule_changed' and ${since};`, expectDb: ">=2" },

  { id: "s34-student-voice-consent", role: ["established"], fixtures: [], matches: /StudentPrivacy\.tsx/,
    async run(p, x) {
      const toggle = async (want) => {
        await x.go("/student/dashboard?tab=profile&view=privacy");
        const s = p.locator("#share-voice-audio"); await s.waitFor({ timeout: 15000 });
        if ((await s.getAttribute("aria-checked")) === String(want)) throw new Error(`audio sharing is already ${want ? "on" : "off"}`);
        await x.expectCall(() => s.click(), /\/api\/db\/rpc\/set_share_voice_audio/, "POST");
        await x.go("/student/dashboard?tab=profile&view=privacy");
        if ((await p.locator("#share-voice-audio").getAttribute("aria-checked")) !== String(want)) throw new Error("the switch did not persist");
      };
      await toggle(true); await toggle(false);
      return "consent switched on and off; each state survived a reload";
    },
    db: (x) => `select 'S32DB ' || share_voice_audio from public.student_profiles where id = '${x.userId}';`, expectDb: "false" },

  { id: "s34-company-voice-play", role: ["company"], fixtures: ["E2E_FIXTURE_VOICE_CANDIDATE_NAME", "E2E_FIXTURE_VOICE_ID"], matches: /VoicePlayButton\.tsx|ProofProfile\.tsx/,
    async run(p, x) {
      await x.go("/company/dashboard?tab=talent");
      await p.getByText(x.env.E2E_FIXTURE_VOICE_CANDIDATE_NAME).first().click();
      const r = await x.expectCall(() => p.getByRole("button", { name: "Play recording" }).first().click(), /\/api\/functions\/company-voice-play/, "POST", 60000);
      await p.locator("audio[src^='blob:']").first().waitFor({ state: "attached", timeout: 30000 });
      const seconds = await p.locator("audio[src^='blob:']").first().evaluate((a) => new Promise((done) => {
        if (a.readyState >= 1) done(a.duration); else { a.addEventListener("loadedmetadata", () => done(a.duration), { once: true }); setTimeout(() => done(0), 15000); }
      }));
      if (!(seconds > 0)) throw new Error("the browser could not read the audio it was given");
      return `company-voice-play HTTP ${r}; browser decoded ${Math.round(seconds)}s of audio`;
    },
    db: (x) => `select 'S32DB ' || count(*) from public.security_events where event_type = 'company_voice_played' and detail ->> 'voice_id' = '${x.env.E2E_FIXTURE_VOICE_ID}' and ${since};`, expectDb: ">=1" },

  // LAST for the "student" role: after it, that account no longer exists.
  { id: "s34-student-delete-account", role: ["student"], fixtures: ["E2E_FIXTURE_DELETE_STUDENT_ID"], matches: /DeleteAccountDialog\.tsx|StudentSettingsPage\.tsx.*Delete Account/,
    async run(p, x) {
      if (x.env.E2E_FIXTURE_DELETE_STUDENT_ID !== x.userId) throw new Error("the signed-in student is not the approved throwaway account: nothing deleted");
      await x.go("/student/dashboard?tab=profile&view=settings");
      await p.getByRole("button", { name: /^\s*Delete Account\s*$/ }).click();
      const confirm = p.getByRole("button", { name: /Delete my account/ });
      await p.locator("#delete-confirm").fill("delete");
      if (!(await confirm.isDisabled())) throw new Error("the confirm button is enabled without the exact word");
      await p.locator("#delete-confirm").fill("DELETE");
      const r = await x.expectCall(() => confirm.click(), /\/api\/accounts\/remove/, "POST", 90000);
      const pending = await Promise.race([
        p.waitForURL((u) => new URL(u).pathname === "/", { timeout: 30000 }).then(() => false),
        p.getByText("Your data is deleted").waitFor({ timeout: 30000 }).then(() => true),
      ]);
      await x.go("/student/dashboard");
      if (!/\/auth/.test(p.url())) throw new Error("the deleted account can still open the student dashboard");
      return `accounts/remove HTTP ${r}; ${pending ? "login locked, deletion pending retry" : "login deleted"}; dashboard now sends to sign-in`;
    },
    db: (x) => `select 'S32DB ' || (select count(*) from public.removed_students where student_id = '${x.userId}' and reason = 'self') || '/' || (select count(*) from public.student_profiles where id = '${x.userId}');`, expectDb: "1/0" },
];
