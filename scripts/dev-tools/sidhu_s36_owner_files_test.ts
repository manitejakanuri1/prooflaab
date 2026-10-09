// S36 QA: the file purge for self-deleted accounts (supabase/functions/_shared/owner-files.ts) with the REAL Deno.remove.
//   deno test --no-lock --allow-read --allow-write --allow-env scripts/dev-tools/sidhu_s36_owner_files_test.ts
// Tests named REPRO pass WHILE THE FINDING EXISTS; when it is fixed they fail and should become normal tests.
const assert = (ok: boolean, why: string) => { if (!ok) throw new Error(why); };
const assertEquals = (a: unknown, b: unknown, why = "") => assert(JSON.stringify(a) === JSON.stringify(b), `${why} got ${JSON.stringify(a)}`);
import { removeOwnerFiles } from "../../supabase/functions/_shared/owner-files.ts";

const ID = "00000000-0000-4000-8000-0000000000a1";
const root = new URL("../../", import.meta.url);

Deno.test("REPRO S36-01: the functions image runs Deno WITHOUT --allow-write", async () => {
  const docker = await Deno.readTextFile(new URL("functions-service/Dockerfile", root));
  const cmd = docker.slice(docker.indexOf("CMD"));
  assert(cmd.includes("--allow-read") && !cmd.includes("--allow-write"), "CMD changed: re-check S36-01");
});

Deno.test({
  name: "REPRO S36-01: so on a mounted bucket the purge can never succeed (every folder fails, row never marked)",
  permissions: { read: true, write: false, env: true },
  async fn() {
    const dir = await Deno.makeTempDir({ dir: Deno.env.get("TEMP") ?? undefined }).catch(() => null);
    const mount = dir ?? "/tmp";
    const failed = await removeOwnerFiles(ID, { private: mount, public: mount });
    assertEquals(failed, ["resumes", "voice-explanations", "profile-photos"]);
  },
});

Deno.test("REPRO S36-02: with no bucket mounted (staging functions has no volumes), the purge reports success", async () => {
  const missing = `${await Deno.makeTempDir()}/not-mounted`;
  const failed = await removeOwnerFiles(ID, { private: `${missing}/private`, public: `${missing}/public` });
  assertEquals(failed, [], "NotFound is read as 'already gone', so files_purged_at would be set and the files kept");
});
