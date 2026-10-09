import { removeOwnerFiles } from "./owner-files.ts";

const assert = (ok: boolean, why: string) => {
  if (!ok) throw new Error(why);
};
const ID = "11111111-2222-3333-4444-555555555555";
const mounts = { private: "/mnt/private", public: "/mnt/public" };
const there = () => Promise.resolve(true);

Deno.test("removes exactly the account's folder in each of the three buckets", async () => {
  const seen: string[] = [];
  const failed = await removeOwnerFiles(ID, mounts, (path, options) => {
    assert(options.recursive === true, "recursive");
    seen.push(path);
    return Promise.resolve();
  }, there);
  assert(failed.length === 0, "no failures");
  assert(JSON.stringify(seen) === JSON.stringify([
    `/mnt/private/resumes/${ID}`,
    `/mnt/private/voice-explanations/${ID}`,
    `/mnt/public/profile-photos/${ID}`,
  ]), seen.join(","));
});

Deno.test("anything that is not an account id deletes nothing", async () => {
  for (const bad of ["", "..", "../resumes", `${ID}/..`, "resumes", `${ID} `, "*", ID.toUpperCase() + "/x"]) {
    let called = false;
    const failed = await removeOwnerFiles(bad, mounts, () => { called = true; return Promise.resolve(); }, there);
    assert(!called && failed.length === 1, `refused: ${JSON.stringify(bad)}`);
  }
  let called = false;
  await removeOwnerFiles(ID, { private: "", public: "/mnt/public" }, () => { called = true; return Promise.resolve(); }, there);
  assert(!called, "no mount, no delete");
});

Deno.test("a missing folder is fine; any other error is reported and the rest still run", async () => {
  let calls = 0;
  const failed = await removeOwnerFiles(ID, mounts, (path) => {
    calls++;
    if (path.includes("resumes")) return Promise.reject(new Deno.errors.NotFound("gone"));
    if (path.includes("voice")) return Promise.reject(new Error("permission denied"));
    return Promise.resolve();
  }, there);
  assert(calls === 3, "all three tried");
  assert(JSON.stringify(failed) === JSON.stringify(["voice-explanations"]), failed.join(","));
});

Deno.test("S36-02: storage that is not mounted is a failure, never 'nothing to delete'", async () => {
  // Staging functions has the mount variables but no volume: every path is simply missing.
  let removes = 0;
  const failed = await removeOwnerFiles(ID, mounts, () => { removes++; return Promise.reject(new Deno.errors.NotFound("no such path")); },
    () => Promise.resolve(false));
  assert(removes === 0, "nothing is even attempted");
  assert(JSON.stringify(failed) === JSON.stringify([
    "resumes (storage not mounted)", "voice-explanations (storage not mounted)", "profile-photos (storage not mounted)",
  ]), failed.join(","));
  // Only the public bucket missing: the private ones are done, the row still must not be marked.
  const half = await removeOwnerFiles(ID, mounts, () => Promise.resolve(), (path) => Promise.resolve(path === "/mnt/private"));
  assert(JSON.stringify(half) === JSON.stringify(["profile-photos (storage not mounted)"]), half.join(","));
  // The real check, with no injection: a path that does not exist on this machine.
  const real = await removeOwnerFiles(ID, { private: "/definitely/not/mounted/private", public: "/definitely/not/mounted/public" });
  assert(real.length === 3 && real.every((f) => f.includes("storage not mounted")), real.join(","));
});
