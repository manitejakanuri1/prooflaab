/** The word a student types before their account is deleted. The server checks it too. */
export const DELETE_WORD = "DELETE";

/**
 * Deletes the signed-in student's own account: their ProofLab data and their
 * login (accounts/ service + remove_students() with the reason 'self',
 * migration 105). It cannot be undone, so the caller signs the browser out
 * straight afterwards.
 */
export async function deleteMyAccount(myId: string, typed: string): Promise<void> {
  if (typed !== DELETE_WORD) throw new Error(`Type ${DELETE_WORD} to confirm.`);
  const res = await fetch("/api/accounts/remove", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ student_ids: [myId], confirm: typed }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.removed !== 1) {
    throw new Error(res.ok ? "Your account was not deleted. Please try again." : json.error ?? "Your account was not deleted.");
  }
}
