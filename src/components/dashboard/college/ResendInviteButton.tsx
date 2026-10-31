import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

/**
 * MF-126: the set-password link in the import email expires after an hour. This sends a fresh one
 * through the same public route as "Forgot password" on the sign-in page, so it needs no new access.
 */
export default function ResendInviteButton({ email }: { email: string }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const resend = async () => {
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setBusy(false);
    if (error) {
      toast({ title: "Could not send", description: "Try again in a few minutes.", variant: "destructive" });
      return;
    }
    setSent(true);
    toast({ title: "Invite sent again", description: `A new set-password link was sent to ${email}. It works for 1 hour.` });
  };

  return (
    <Button size="sm" variant="outline" disabled={busy || sent} onClick={() => void resend()}>
      {sent ? "Invite sent" : busy ? "Sending..." : "Resend invite"}
    </Button>
  );
}
