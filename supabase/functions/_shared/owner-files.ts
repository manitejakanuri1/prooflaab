/**
 * Deletes every stored file of one account (used when a student deletes their
 * own account, migration 105). Files live at <mount>/<bucket>/<account id>/...,
 * the same layout the file service enforces, so the account's folder in each
 * bucket is everything it ever uploaded.
 *
 * The id must be a uuid and nothing else: this builds a path and deletes a
 * folder, so "..", "/", an empty string or a bucket name must never get here.
 *
 * "Nothing to delete" is only believed when the storage itself is there
 * (Sidhu S36-02). On a service with no bucket mounted every path is missing,
 * and reading that as "already gone" would record files as deleted while they
 * all remain. So a mount folder that cannot be seen is a failure, not a pass.
 * (The mount, not <mount>/<bucket>: a bucket nobody has uploaded to yet has no
 * such folder, and that must not block a purge for ever.)
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const PRIVATE_BUCKETS = ["resumes", "voice-explanations"];
const PUBLIC_BUCKETS = ["profile-photos"];

type Remove = (path: string, options: { recursive: boolean }) => Promise<void>;
type IsDirectory = (path: string) => Promise<boolean>;

const isDirectory: IsDirectory = async (path) => {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch {
    return false;
  }
};

/**
 * Returns the buckets whose folder could NOT be confirmed gone. Empty means every file is gone
 * (or the account never stored any) in a bucket that was really there.
 */
export async function removeOwnerFiles(
  ownerId: string,
  mounts: { private: string; public: string },
  remove: Remove = Deno.remove,
  storageIsThere: IsDirectory = isDirectory,
): Promise<string[]> {
  if (!UUID.test(ownerId) || !mounts.private || !mounts.public) return ["refused: not an account id"];
  const buckets = [
    ...PRIVATE_BUCKETS.map((b) => ({ name: b, mount: mounts.private })),
    ...PUBLIC_BUCKETS.map((b) => ({ name: b, mount: mounts.public })),
  ];
  const failed: string[] = [];
  for (const bucket of buckets) {
    if (!(await storageIsThere(bucket.mount))) {
      failed.push(`${bucket.name} (storage not mounted)`);
      continue;
    }
    try {
      await remove(`${bucket.mount}/${bucket.name}/${ownerId}`, { recursive: true });
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) failed.push(bucket.name);
    }
  }
  return failed;
}
