/**
 * Deletes every stored file of one account (used when a student deletes their
 * own account, migration 105). Files live at <mount>/<bucket>/<account id>/...,
 * the same layout the file service enforces, so the account's folder in each
 * bucket is everything it ever uploaded.
 *
 * The id must be a uuid and nothing else: this builds a path and deletes a
 * folder, so "..", "/", an empty string or a bucket name must never get here.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const PRIVATE_BUCKETS = ["resumes", "voice-explanations"];
const PUBLIC_BUCKETS = ["profile-photos"];

type Remove = (path: string, options: { recursive: boolean }) => Promise<void>;

/** Returns the folders that could NOT be removed. Empty means every file is gone (or never existed). */
export async function removeOwnerFiles(
  ownerId: string,
  mounts: { private: string; public: string },
  remove: Remove = Deno.remove,
): Promise<string[]> {
  if (!UUID.test(ownerId) || !mounts.private || !mounts.public) return ["refused: not an account id"];
  const folders = [
    ...PRIVATE_BUCKETS.map((b) => `${mounts.private}/${b}/${ownerId}`),
    ...PUBLIC_BUCKETS.map((b) => `${mounts.public}/${b}/${ownerId}`),
  ];
  const failed: string[] = [];
  for (const folder of folders) {
    try {
      await remove(folder, { recursive: true });
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) failed.push(folder.split("/").slice(-2, -1)[0]);
    }
  }
  return failed;
}
