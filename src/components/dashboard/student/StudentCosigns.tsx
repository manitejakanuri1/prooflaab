import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { PenLine } from "lucide-react";

interface Cosign {
  direction: "received" | "given";
  cosign_id: string;
  proof_id: string;
  work: string;
  student_name: string;
  cosigner_name: string;
  cosigner_role: "peer" | "mentor" | "college";
  note: string | null;
  created_at: string;
}

interface Cosignable {
  proof_id: string;
  student_id: string;
  student_name: string;
  work: string;
  submitted_at: string;
  status: string;
}

const ROLE: Record<string, string> = {
  peer: "Squad-mate",
  mentor: "Mentor",
  college: "Placement office",
};

/**
 * Cosigns — somebody else putting their name against your evidence.
 *
 * Two halves on purpose. What your work has collected, and what is waiting for
 * you to look at: a page that only showed the first would be empty for everyone
 * until somebody else happened to act first.
 *
 * Who may cosign is decided by the database from the relationship — a squad-mate
 * signs as a peer, the placement office signs as the college — so there is no
 * role to choose here and no way to claim one you do not have.
 */
const StudentCosigns = () => {
  const { toast } = useToast();
  const [cosigns, setCosigns] = useState<Cosign[] | null>(null);
  const [waiting, setWaiting] = useState<Cosignable[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [mine, open] = await Promise.all([
      supabase.rpc("my_cosigns" as never),
      supabase.rpc("cosignable_proofs" as never),
    ]);
    setCosigns((mine.data ?? []) as unknown as Cosign[]);
    setWaiting((open.data ?? []) as unknown as Cosignable[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const cosign = async (proofId: string, who: string) => {
    setBusy(proofId);
    const { error } = await supabase.rpc("cosign_proof" as never, {
      _proof_id: proofId,
      _note: notes[proofId] ?? null,
    } as never);
    setBusy(null);
    if (error) {
      toast({ title: "Not cosigned", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: `You cosigned ${who}'s work`,
      description: "It now shows on their build-log with your name against it.",
    });
    setNotes((n) => ({ ...n, [proofId]: "" }));
    void load();
  };

  if (!cosigns) return <Skeleton className="h-64 w-full rounded-xl" />;

  const received = cosigns.filter((c) => c.direction === "received");
  const given = cosigns.filter((c) => c.direction === "given");

  return (
    <div className="space-y-4">
      {/* What is waiting on you comes first: it is the only part of this page
          that asks for an action. */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Your squad's recent work
            </span>
            <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
              {waiting.length} you can cosign
            </span>
          </div>

          {waiting.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-2 max-w-prose">
              Nothing waiting. When someone in your squad submits work in the next thirty days it
              appears here, and you can put your name to it if you saw them do it.
            </p>
          ) : (
            <div className="mt-3">
              {waiting.map((w) => (
                <div key={w.proof_id} className="py-3 border-b last:border-b-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <p className="text-sm font-medium">{w.student_name}</p>
                    <span className="text-sm text-muted-foreground">— {w.work}</span>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      {format(new Date(w.submitted_at), "d MMM")}
                    </span>
                  </div>
                  <div className="mt-2 flex gap-2 flex-wrap">
                    <Input
                      value={notes[w.proof_id] ?? ""}
                      onChange={(e) => setNotes((n) => ({ ...n, [w.proof_id]: e.target.value }))}
                      placeholder="What did you see them do? (optional)"
                      className="h-9 flex-1 min-w-[180px] text-sm"
                    />
                    <Button
                      size="sm"
                      className="h-9"
                      disabled={busy === w.proof_id}
                      onClick={() => void cosign(w.proof_id, w.student_name)}
                    >
                      <PenLine className="h-3.5 w-3.5 mr-1.5" />
                      {busy === w.proof_id ? "Signing…" : "Cosign"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Cosigns on your work
          </span>
          {received.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-2 max-w-prose">
              None yet. A cosign is worth more than a self-declaration because somebody else's
              name is on it — submit work your squad can see you doing.
            </p>
          ) : (
            <div className="mt-3">
              {received.map((c) => (
                <div key={c.cosign_id} className="py-3 border-b last:border-b-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <p className="text-sm font-medium">{c.cosigner_name}</p>
                    <Badge variant="outline" className="text-[10px] font-normal">
                      {ROLE[c.cosigner_role] ?? c.cosigner_role}
                    </Badge>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      {format(new Date(c.created_at), "d MMM yyyy")}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">on {c.work}</p>
                  {c.note && <p className="text-sm mt-1">“{c.note}”</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {given.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Cosigns you have given
            </span>
            <div className="mt-3">
              {given.map((c) => (
                <div key={c.cosign_id} className="py-2.5 border-b last:border-b-0 flex items-baseline gap-2 flex-wrap">
                  <p className="text-sm">{c.student_name}</p>
                  <span className="text-sm text-muted-foreground">— {c.work}</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    {format(new Date(c.created_at), "d MMM yyyy")}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default StudentCosigns;
