import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { DELETE_WORD, deleteMyAccount } from "@/lib/deleteMyAccount";

/**
 * Delete Account, for the student's own account only. Nothing is sent until
 * the word is typed; the server refuses without it as well.
 */
const DeleteAccountDialog = ({ studentId }: { studentId: string }) => {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginPending, setLoginPending] = useState(false);

  // The login no longer works either way; clear this browser's session and leave.
  const leave = async () => {
    await supabase.auth.signOut().catch(() => {});
    window.location.assign("/");
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const { loginDeleted } = await deleteMyAccount(studentId, typed);
      if (loginDeleted) await leave();
      else setLoginPending(true); // data gone, login locked: say so before leaving
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your account was not deleted.");
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="destructive" onClick={() => { setTyped(""); setError(null); setOpen(true); }}>
        Delete Account
      </Button>
      <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
        {loginPending ? (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Your data is deleted</DialogTitle>
              <DialogDescription>
                Your profile, work and recordings are deleted. Your sign-in could not be removed just now, so it
                has been locked and cannot be used. We will finish removing it automatically.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => void leave()}>Close</Button>
            </DialogFooter>
          </DialogContent>
        ) : (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This deletes your login, your profile, your tasks and scores, your squad place, your portfolio and
              your voice recordings. It cannot be undone, and your college cannot bring it back.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="delete-confirm">Type {DELETE_WORD} to confirm</Label>
            <Input id="delete-confirm" value={typed} autoComplete="off" disabled={busy}
              onChange={(e) => setTyped(e.target.value)} />
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Keep my account</Button>
            <Button variant="destructive" disabled={busy || typed !== DELETE_WORD} onClick={() => void confirm()}>
              {busy ? "Deleting…" : "Delete my account"}
            </Button>
          </DialogFooter>
        </DialogContent>
        )}
      </Dialog>
    </>
  );
};

export default DeleteAccountDialog;
