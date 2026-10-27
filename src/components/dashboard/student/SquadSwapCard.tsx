import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { FAST_WEEK, FAST_WEEK_MINUTES, WHEN_FORMAT } from "@/lib/testClock";

// Squad swap (migration 143, owner decision 24 Oct 2026): two students in the same section trade squads in the
// first 7 days of a season. Each must enter the other squad's secret code. The server checks every rule.

interface Swap { id: string; student: string; squad: string; created_at: string }
interface State {
  in_squad: boolean; squad?: string; open?: boolean; closes_at?: string | null; code?: string | null;
  used?: boolean; outgoing?: Swap | null; incoming?: Swap[];
}
interface Lookup { squad: string; members: { student_id: string; name: string; used: boolean }[] }

const message = (e: unknown) => (e as { message?: string })?.message ?? "Something went wrong. Try again.";

export default function SquadSwapCard({ onSwapped }: { onSwapped: () => void }) {
  const { toast } = useToast();
  const [state, setState] = useState<State | null>(null);
  const [code, setCode] = useState("");
  const [found, setFound] = useState<Lookup | null>(null);
  const [answerCode, setAnswerCode] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("my_squad_swap" as never);
    setState((data as State) ?? null);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: string, args: Record<string, unknown>, done: string) => {
    setBusy(true);
    const { data, error } = await supabase.rpc(fn as never, args as never);
    setBusy(false);
    if (error) { toast({ title: "Not done", description: message(error), variant: "destructive" }); return null; }
    toast({ title: done });
    return data;
  };

  if (!state?.in_squad) return null;
  const incoming = state.incoming ?? [];
  // Nothing to show once the 7 days are over and nothing is waiting.
  if (!state.open && incoming.length === 0 && !state.outgoing) return null;

  return (
    <Card data-testid="squad-swap">
      <CardContent className="pt-5 space-y-4">
        <div>
          <h3 className="font-semibold">Swap squads with a friend</h3>
          <p className="text-sm text-muted-foreground">
            Open only in the first {FAST_WEEK ? `${FAST_WEEK_MINUTES} minutes` : "7 days"} of the season
            {state.closes_at ? ` (until ${FAST_WEEK ? "" : "the end of "}${format(new Date(state.closes_at).getTime() - 60000, WHEN_FORMAT)})` : ""}. You and your friend
            trade places, so both squads stay the same size. Both of you must be in the same section, and you each
            share your squad code. Your own points move with you. You can swap only once per season.
          </p>
        </div>

        {state.code && (
          <p className="text-sm">
            Your squad code: <span className="font-mono font-semibold tracking-wider" data-testid="my-squad-code">{state.code}</span>{" "}
            <span className="text-muted-foreground">Share it only with the friend you want to swap with.</span>
          </p>
        )}

        {incoming.map((w) => (
          <div key={w.id} className="rounded-md border p-3 space-y-2" data-testid="swap-incoming">
            <p className="text-sm"><b>{w.student}</b> from <b>{w.squad}</b> wants to swap squads with you.</p>
            <p className="text-xs text-muted-foreground">To accept, enter the code of {w.squad} (ask {w.student} for it).</p>
            <div className="flex flex-wrap gap-2">
              <Input className="max-w-[180px] font-mono uppercase" placeholder="SQ-XXXXXX" aria-label="Their squad code"
                value={answerCode[w.id] ?? ""} onChange={(e) => setAnswerCode({ ...answerCode, [w.id]: e.target.value })} />
              <Button size="sm" disabled={busy || !(answerCode[w.id] ?? "").trim()} onClick={async () => {
                if (await run("answer_squad_swap", { _swap_id: w.id, _accept: true, _code: answerCode[w.id] }, `You are now in ${w.squad}`)) onSwapped();
                void load();
              }}>Accept swap</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
                await run("answer_squad_swap", { _swap_id: w.id, _accept: false }, "Request declined");
                void load();
              }}>Decline</Button>
            </div>
          </div>
        ))}

        {state.outgoing ? (
          <div className="rounded-md border p-3 space-y-2" data-testid="swap-outgoing">
            <p className="text-sm">
              Waiting for <b>{state.outgoing.student}</b> ({state.outgoing.squad}) to accept. Give them your squad code.
            </p>
            <Button size="sm" variant="outline" disabled={busy} onClick={async () => {
              await run("cancel_squad_swap", { _swap_id: state.outgoing!.id }, "Request cancelled");
              void load();
            }}>Cancel request</Button>
          </div>
        ) : state.used ? (
          <p className="text-sm text-muted-foreground">You have already swapped once this season.</p>
        ) : state.open && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Input className="max-w-[180px] font-mono uppercase" placeholder="SQ-XXXXXX" aria-label="Friend's squad code"
                value={code} onChange={(e) => { setCode(e.target.value); setFound(null); }} />
              <Button size="sm" variant="outline" disabled={busy || !code.trim()} onClick={async () => {
                const data = await run("squad_swap_lookup", { _code: code }, "Code is right");
                setFound((data as Lookup) ?? null);
              }}>Check code</Button>
            </div>
            {found && (
              <div className="space-y-1">
                <p className="text-sm">Pick who you want to swap with in <b>{found.squad}</b>:</p>
                <div className="flex flex-wrap gap-2">
                  {found.members.map((m) => (
                    <Button key={m.student_id} size="sm" disabled={busy || m.used} title={m.used ? "Already swapped this season" : undefined}
                      onClick={async () => {
                        if (await run("request_squad_swap", { _code: code, _with_student: m.student_id }, `Request sent to ${m.name}`)) {
                          setCode(""); setFound(null);
                        }
                        void load();
                      }}>
                      Swap with {m.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
