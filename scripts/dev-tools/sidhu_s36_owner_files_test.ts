// S36 QA: the file purge for self-deleted accounts (supabase/functions/_shared/owner-files.ts) with the REAL Deno.remove.
//   deno test --no-lock --allow-read --allow-write --allow-env scripts/dev-tools/sidhu_s36_owner_files_test.ts
const assert = (ok: boolean, why: string) => { if (!ok) throw new Error(why); };
const assertEquals = (a: unknown, b: unknown, why = "") => assert(JSON.stringify(a) === JSON.stringify(b), `${why} got ${JSON.stringify(a)}`);
import { removeOwnerFiles } from "../../supabase/functions/_shared/owner-files.ts";

const ID = "00000000-0000-4000-8000-0000000000a1";
const root = new URL("../../", import.meta.url);

// S36-01 and S36-02 were REPRO tests. TEJA fixed both (S36): they are normal tests now.
Deno.test("S36-01 fixed: the functions image may write under /mnt (the mounted buckets) and nowhere else", async () => {
  const docker = await Deno.readTextFile(new URL("functions-service/Dockerfile", root));
  const cmd = docker.slice(docker.lastIndexOf("CMD"));
  assert(cmd.includes('"--allow-write=/mnt"'), "the purge needs write access to the mounted buckets");
  assert(!/"--allow-write"|--allow-write=\/"|--allow-all|"-A"/.test(cmd), "write access must stay limited to /mnt");
});

Deno.test("S36-01 fixed: with write access, the account's folders are really deleted and nothing else is", async () => {
  const mount = await Deno.makeTempDir();
  for (const b of ["resumes", "voice-explanations", "profile-photos"]) {
    await Deno.mkdir(`${mount}/${b}/${ID}/nested`, { recursive: true });
    await Deno.writeTextFile(`${mount}/${b}/${ID}/nested/file.bin`, "x");
    await Deno.mkdir(`${mount}/${b}/someone-else`, { recursive: true });
    await Deno.writeTextFile(`${mount}/${b}/someone-else/keep.bin`, "y");
  }
  assertEquals(await removeOwnerFiles(ID, { private: mount, public: mount }), []);
  for (const b of ["resumes", "voice-explanations", "profile-photos"]) {
    assert(await Deno.stat(`${mount}/${b}/${ID}`).then(() => false, () => true), `${b}: the account's folder is gone`);
    assert((await Deno.readTextFile(`${mount}/${b}/someone-else/keep.bin`)) === "y", `${b}: another account's file is untouched`);
  }
  await Deno.remove(mount, { recursive: true });
});

Deno.test({
  name: "S36-01: without write permission every folder is reported as NOT deleted (never marked purged)",
  permissions: { read: true, write: false, env: true },
  async fn() {
    // An existing directory stands in for a mounted bucket; write is denied to this test.
    const mount = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const failed = await removeOwnerFiles(ID, { private: mount, public: mount });
    assertEquals(failed, ["resumes", "voice-explanations", "profile-photos"]);
  },
});

Deno.test("S36-02 fixed: with no bucket mounted (staging functions has no volumes), the purge reports failure", async () => {
  const missing = `${await Deno.makeTempDir()}/not-mounted`;
  const failed = await removeOwnerFiles(ID, { private: `${missing}/private`, public: `${missing}/public` });
  assertEquals(failed, ["resumes (storage not mounted)", "voice-explanations (storage not mounted)", "profile-photos (storage not mounted)"],
    "files_purged_at must not be set when the storage cannot be seen");
});
