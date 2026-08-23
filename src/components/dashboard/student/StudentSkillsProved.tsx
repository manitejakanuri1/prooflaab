import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

interface Skill {
  skill: string;
  status: string;
  claimed_from: string | null;
  assessed_score: number | null;
  proven_lots: number;
  proven_voice: number;
  topics_cleared: number;
  topics_total: number;
  needs_improvement: boolean;
  last_evidence_at: string | null;
}

/** Claimed → assessed → proven, and the fourth one nobody wants to be in. */
const STATUS: Record<string, { label: string; tone: string; says: string }> = {
  proven: {
    label: "Proven",
    tone: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
    says: "Evidence exists for this: work submitted and explained out loud.",
  },
  assessed: {
    label: "Assessed",
    tone: "bg-primary/10 text-primary border-primary/20",
    says: "You have been tested on it. Submit work using it to move it to proven.",
  },
  claimed: {
    label: "Claimed",
    tone: "bg-muted text-muted-foreground border-transparent",
    says: "Taken from your resume. Nothing has tested it yet.",
  },
  needs_improvement: {
    label: "Needs work",
    tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    says: "The assessment came back short of the bar. Worth another pass.",
  },
};

/**
 * Skills proved — a skill next to the evidence for it.
 *
 * The rows have existed since the skills stage and nothing ever displayed them,
 * so a student could be told their skill was proven and have no way to see it.
 * Every number here is counted from something that happened: topics cleared on
 * the ladder, lots submitted, explanations recorded.
 */
const StudentSkillsProved = () => {
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("my_skills_proved" as never);
    if (err) { setError(err.message); return; }
    setSkills((data ?? []) as unknown as Skill[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) {
    return (
      <Card><CardContent className="pt-6">
        <p className="text-sm text-destructive">Could not load your skills: {error}</p>
      </CardContent></Card>
    );
  }

  if (!skills) return <Skeleton className="h-64 w-full rounded-xl" />;

  if (skills.length === 0) {
    return (
      <Card><CardContent className="pt-6">
        <p className="text-sm text-muted-foreground max-w-prose">
          No skills recorded yet. They arrive from your resume when you upload one, and from
          the assessment — then every lot you submit and every explanation you record moves
          one of them closer to proven.
        </p>
      </CardContent></Card>
    );
  }

  const proven = skills.filter((s) => s.status === "proven").length;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Skills proved
          </span>
          <p className="mt-1 text-sm">
            <span className="font-mono text-xl font-semibold tabular-nums">{proven}</span>
            <span className="text-muted-foreground"> of {skills.length} carry evidence.</span>
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {skills.map((s) => {
          const meta = STATUS[s.status] ?? STATUS.claimed;
          const pct = s.topics_total > 0
            ? Math.round((Number(s.topics_cleared) / Number(s.topics_total)) * 100)
            : 0;
          return (
            <Card key={s.skill}>
              <CardContent className="pt-5">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h3 className="font-semibold">{s.skill}</h3>
                  <Badge variant="outline" className={`text-[10px] font-normal ${meta.tone}`}>
                    {meta.label}
                  </Badge>
                  {s.assessed_score != null && (
                    <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                      {s.assessed_score}/100
                    </span>
                  )}
                </div>

                <p className="text-xs text-muted-foreground mt-1">{meta.says}</p>

                {s.topics_total > 0 && (
                  <div className="mt-3">
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Topics on the ladder
                      </span>
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                        {s.topics_cleared} of {s.topics_total}
                      </span>
                    </div>
                    <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )}

                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    { k: "Lots", v: s.proven_lots },
                    { k: "Explained", v: s.proven_voice },
                    { k: "From", v: s.claimed_from ?? "—" },
                  ].map(({ k, v }) => (
                    <div key={k} className="rounded-lg bg-muted/50 p-2">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        {k}
                      </span>
                      <div className="font-mono text-sm font-semibold tabular-nums mt-0.5 truncate">
                        {v}
                      </div>
                    </div>
                  ))}
                </div>

                {s.last_evidence_at && (
                  <p className="text-xs text-muted-foreground mt-3">
                    Last evidence {format(new Date(s.last_evidence_at), "d MMM yyyy")}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default StudentSkillsProved;
