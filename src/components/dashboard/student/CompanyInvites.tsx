import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

// MF-047 (migration 198): a company shortlisted the student. The student presses Accept or Decline;
// the company can move them to interviewing / offered / hired only after Accept.

interface Invite { id: string; company: string; note: string | null; stage: string; student_response: string | null }

export default function CompanyInvites() {
  const { toast } = useToast();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("my_shortlists" as never);
    setInvites(((data as Invite[]) ?? []).filter((i) => !i.student_response));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const answer = async (id: string, accept: boolean) => {
    setBusy(true);
    const { error } = await supabase.rpc("respond_to_shortlist" as never, { _shortlist_id: id, _accept: accept } as never);
    setBusy(false);
    if (error) { toast({ title: "Not saved", description: error.message, variant: "destructive" }); return; }
    toast({ title: accept ? "Accepted. The company can now contact you." : "Declined. The company is told." });
    await load();
  };

  if (invites.length === 0) return null;
  return (
    <Card data-testid="company-invites">
      <CardContent className="pt-5 space-y-3">
        <h3 className="font-semibold">Companies want to talk to you</h3>
        {invites.map((i) => (
          <div key={i.id} className="rounded-md border p-3 space-y-2">
            <p className="text-sm"><b>{i.company}</b> saw your work and shortlisted you.</p>
            {i.note && <p className="text-sm text-muted-foreground">{i.note}</p>}
            <p className="text-xs text-muted-foreground">
              Accept to share your contact details with them. Nothing moves forward until you accept.
            </p>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => void answer(i.id, true)}>Accept</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void answer(i.id, false)}>Decline</Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
