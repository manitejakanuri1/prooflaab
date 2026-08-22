import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RotateCcw, Sparkles, ArrowRight, CheckCircle2 } from "lucide-react";

interface WeekItem {
  level_id: string;
  title: string;
  skill: string;
  level_number: number;
  slot: number;
  reason: string;
  reason_code: "retry" | "revise" | "next" | "stretch";
  status: string;
}

const DONE = new Set(["cleared", "mastered", "placed"]);

const KIND = {
  retry:  { label: "Finish this", icon: RotateCcw,     tone: "text-amber-500" },
  revise: { label: "Quick revision", icon: Sparkles,   tone: "text-primary" },
  next:   { label: "Next step", icon: ArrowRight,      tone: "text-muted-foreground" },
  stretch:{ label: "Stretch", icon: ArrowRight,        tone: "text-muted-foreground" },
} as const;

/**
 * This week's five steps.
 *
 * The ladder does not change — twelve tracks, 146 topics, written once and read
 * by everyone. What changes weekly is which rungs a student is pointed at, and
 * that is chosen from what they actually did last week: anything they started
 * and left, then the Foundations their resume suggested they know, then the next
 * steps on their path.
 *
 * No model decides this. Reading last week's results and ordering five topics is
 * arithmetic, and paying for judgement where arithmetic will do buys nothing.
 */
const ThisWeekPlan = () => {
  const [items, setItems] = useState<WeekItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("my_week" as never);
    if (err) { setError(err.message); return; }
    setItems((data ?? []) as unknown as WeekItem[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) return null;
  if (!items) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (items.length === 0) return null;

  const done = items.filter((i) => DONE.has(i.status)).length;

  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            This week
          </span>
          <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
            {done} of {items.length} done
          </span>
        </div>

        <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all"
               style={{ width: `${Math.round((done / items.length) * 100)}%` }} />
        </div>

        <div className="mt-3">
          {items.map((it) => {
            const kind = KIND[it.reason_code] ?? KIND.next;
            const Icon = kind.icon;
            const finished = DONE.has(it.status);
            return (
              <div key={it.level_id}
                   className="flex items-start gap-3 py-3 border-b last:border-b-0">
                <span className="mt-0.5">
                  {finished
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    : <Icon className={`h-4 w-4 ${kind.tone}`} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <p className={`text-sm font-medium ${finished ? "line-through text-muted-foreground" : ""}`}>
                      {it.title}
                    </p>
                    <Badge variant="outline" className="font-normal text-[10px]">
                      {kind.label}
                    </Badge>
                  </div>
                  {/* The reason is shown, not just the pick. Being told what to
                      do next is an instruction; being told why is a plan. */}
                  <p className="text-xs text-muted-foreground mt-0.5">{it.reason}</p>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums mt-1">
                  step {it.level_number}
                </span>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground mt-3">
          Chosen from your own path, and rebuilt every Monday from what you did
          the week before.
        </p>
      </CardContent>
    </Card>
  );
};

export default ThisWeekPlan;
