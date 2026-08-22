import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { format, isSameDay } from "date-fns";
import {
  LogIn, PlayCircle, Upload, Mic, CheckCircle2, FileCheck, ShieldCheck,
  Gauge, UserCog, Swords,
} from "lucide-react";

interface Event {
  occurred_at: string;
  event_type: string;
  source_type: string | null;
  source_id: string | null;
  metadata: Record<string, unknown>;
  total: number;
}

/** Every event type the database records, said the way a student would say it. */
const EVENT: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  login:              { label: "Signed in",                 icon: LogIn },
  lot_started:        { label: "Started the day's lot",     icon: PlayCircle },
  lot_submitted:      { label: "Submitted the day's lot",   icon: Upload },
  voice_recorded:     { label: "Recorded an explanation",   icon: Mic },
  topic_cleared:      { label: "Cleared a topic",           icon: CheckCircle2 },
  proof_submitted:    { label: "Submitted work",            icon: FileCheck },
  proof_verified:     { label: "Work verified",             icon: ShieldCheck },
  skill_assessed:     { label: "Skill assessed",            icon: Gauge },
  profile_updated:    { label: "Updated your profile",      icon: UserCog },
  match_participated: { label: "Played a squad match",      icon: Swords },
};

const PAGE = 50;

/**
 * History — the activity timeline.
 *
 * The events table has been filling since the day the triggers went in and had
 * no reader, so the record of what a student did existed and only the college
 * could see any of it. Paged rather than fetched whole: a student a year in has
 * thousands of rows, and a page that asks for all of them is a page that stops
 * loading.
 */
const StudentHistory = () => {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (from: number) => {
    setLoading(true);
    const { data } = await supabase.rpc("my_history" as never, {
      _limit: PAGE, _offset: from,
    } as never);
    const rows = (data ?? []) as unknown as Event[];
    setTotal(rows.length > 0 ? Number(rows[0].total) : from);
    setEvents((prev) => (from === 0 ? rows : [...(prev ?? []), ...rows]));
    setLoading(false);
  }, []);

  useEffect(() => { void load(0); }, [load]);

  if (!events) return <Skeleton className="h-64 w-full rounded-xl" />;

  if (events.length === 0) {
    return (
      <Card><CardContent className="pt-6">
        <p className="text-sm text-muted-foreground max-w-prose">
          Nothing recorded yet. Every sign-in, lot, explanation and cleared topic lands here
          from the moment you start — it is written by the system, not typed in by anyone.
        </p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              History
            </span>
            <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
              {events.length} of {total}
            </span>
          </div>

          <div className="mt-3">
            {events.map((e, i) => {
              const meta = EVENT[e.event_type] ?? { label: e.event_type, icon: CheckCircle2 };
              const Icon = meta.icon;
              const at = new Date(e.occurred_at);
              // One date heading per day rather than a date on every row.
              const newDay = i === 0 || !isSameDay(at, new Date(events[i - 1].occurred_at));
              return (
                <div key={`${e.occurred_at}-${i}`}>
                  {newDay && (
                    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground pt-4 first:pt-0 pb-1">
                      {format(at, "EEEE d MMMM yyyy")}
                    </p>
                  )}
                  <div className="flex items-center gap-3 py-2 border-b last:border-b-0">
                    <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <p className="text-sm flex-1 min-w-0">{meta.label}</p>
                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                      {format(at, "h:mm a")}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {events.length < total && (
            <Button
              variant="outline"
              className="mt-4 w-full"
              disabled={loading}
              onClick={() => {
                const next = offset + PAGE;
                setOffset(next);
                void load(next);
              }}
            >
              {loading ? "Loading…" : `Show ${Math.min(PAGE, total - events.length)} more`}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default StudentHistory;
