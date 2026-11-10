import { of10 } from "@/lib/lotMarks";
import InfoTip from "@/components/common/InfoTip";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
    tone: "bg-verified/10 text-verified border-verified/20",
    says: "On your resume and not flagged in your starting test.",
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
    tone: "bg-compete/10 text-compete border-compete/20",
    says: "The assessment came back short of the bar. Worth another pass.",
  },
};

interface TopicRating {
  topic: string;
  label: "strong" | "building" | "needs_work" | "new";
  accuracy_pct: number | null;
  attempts: number;
  last_seen?: string | null;
}

// D1 / F7: topic_ratings keeps only a rating and an answer count per topic (migration 146), not the
// answers themselves, so the popup shows the counts it is built from and says so.
const TopicDialog = ({ r, onClose }: { r: TopicRating | null; onClose: () => void }) => (
  <Dialog open={Boolean(r)} onOpenChange={(v) => !v && onClose()}>
    <DialogContent className="max-w-md">
      {r && (
        <>
          <DialogHeader><DialogTitle>{r.topic}</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              <span className="font-medium">{r.label === "strong" ? "Strong" : r.label === "needs_work" ? "Needs work" : "Building"}</span>
              {" · "}about {Math.round(((r.accuracy_pct ?? 0) * r.attempts) / 100)} of {r.attempts} answers correct
            </p>
            {r.last_seen && <p className="text-muted-foreground">Last answer on this topic: {format(new Date(r.last_seen), "d MMM yyyy")}</p>}
            <p className="text-muted-foreground">
              From your quiz answers and daily Lots on this topic. ProofLab keeps the count for each topic,
              not a list of the single answers, so they can't be shown here.
            </p>
            <p className="text-xs text-muted-foreground">Shows after 3 answers on a topic. 75%+ = Strong, under 50% = Needs work.</p>
          </div>
        </>
      )}
    </DialogContent>
  </Dialog>
);

/**
 * Strong in / Needs work, from the quiz and Lot answers recorded per topic (migration 146).
 * Labels and accuracy only: the underlying rating stays hidden from students.
 */
const TopicStrengths = () => {
  const [rows, setRows] = useState<TopicRating[] | null>(null);
  const [pick, setPick] = useState<TopicRating | null>(null);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.rpc("my_topic_ratings" as never);
      setRows(error ? [] : ((data ?? []) as unknown as TopicRating[]));
    })();
  }, []);

  const strong = (rows ?? []).filter((r) => r.label === "strong");
  const weak = (rows ?? []).filter((r) => r.label === "needs_work");
  if (strong.length === 0 && weak.length === 0) return null;

  const chips = (list: TopicRating[], tone: string) => (
    <div className="mt-2 flex flex-wrap gap-2">
      {list.map((r) => (
        <Badge key={r.topic} variant="outline" role="button" tabIndex={0}
               onClick={() => setPick(r)} onKeyDown={(e) => e.key === "Enter" && setPick(r)}
               className={`cursor-pointer text-xs font-normal ${tone}`}>
          {r.topic}: {Math.round(((r.accuracy_pct ?? 0) * r.attempts) / 100)} of {r.attempts} correct{r.label === "strong" ? " ✓" : ""}
        </Badge>
      ))}
    </div>
  );

  return (
    <Card>
      <CardContent className="pt-5 space-y-4">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Where you stand, topic by topic
        </span>{" "}
        <InfoTip text="Shows after 3 answers on a topic. 75%+ = Strong, under 50% = Needs work." />
        {strong.length > 0 && (
          <div>
            <p className="text-sm font-medium">Strong in</p>
            {chips(strong, "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20")}
          </div>
        )}
        {weak.length > 0 && (
          <div>
            <p className="text-sm font-medium">Needs work</p>
            {chips(weak, "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20")}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          From your quiz answers and daily Lots. A topic shows once you have answered at least 3. Tap a topic for its details.
        </p>
        <TopicDialog r={pick} onClose={() => setPick(null)} />
      </CardContent>
    </Card>
  );
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
  const [openSkill, setOpenSkill] = useState<Skill | null>(null);
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
      <div className="space-y-4">
      <TopicStrengths />
      <Card><CardContent className="pt-6">
        <p className="text-sm text-muted-foreground max-w-prose">
          No skills recorded yet. They arrive from your resume when you upload one, and from
          the assessment — then every lot you submit and every explanation you record moves
          one of them closer to proven.
        </p>
      </CardContent></Card>
      </div>
    );
  }

  const proven = skills.filter((s) => s.status === "proven").length;

  return (
    <div className="space-y-4">
      <TopicStrengths />
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
            <Card key={s.skill} role="button" tabIndex={0} className="cursor-pointer hover:shadow-md"
                  onClick={() => setOpenSkill(s)} onKeyDown={(e) => e.key === "Enter" && setOpenSkill(s)}>
              <CardContent className="pt-5">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h3 className="font-semibold">{s.skill}</h3>
                  <Badge variant="outline" className={`text-[10px] font-normal ${meta.tone}`}>
                    {meta.label}
                  </Badge>
                  {s.assessed_score != null && (
                    <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                      Starting test: {of10(s.assessed_score)}
                    </span>
                  )}
                </div>

                <p className="text-xs text-muted-foreground mt-1">{meta.says}</p>
                {s.assessed_score != null && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Starting test = your overall starting-test average, shown on each skill from your resume.
                  </p>
                )}

                {s.topics_total > 0 && (
                  <div className="mt-3">
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Syllabus levels cleared{" "}
                        <InfoTip text="Each skill's syllabus is split into levels. A level counts once you pass it." />
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
      <Dialog open={Boolean(openSkill)} onOpenChange={(v) => !v && setOpenSkill(null)}>
        <DialogContent className="max-w-md">
          {openSkill && (
            <>
              <DialogHeader><DialogTitle>{openSkill.skill}: {(STATUS[openSkill.status] ?? STATUS.claimed).label}</DialogTitle></DialogHeader>
              <div className="space-y-2 text-sm">
                <p><span className="font-medium">What it means:</span> {(STATUS[openSkill.status] ?? STATUS.claimed).says}</p>
                {openSkill.assessed_score != null && (
                  <p><span className="font-medium">Starting test: {of10(openSkill.assessed_score)}</span> - your overall
                    starting-test average. The same number is shown on each skill from your resume.</p>
                )}
                <p><span className="font-medium">Where it came from:</span> {openSkill.claimed_from ? `added from ${openSkill.claimed_from.replace(/_/g, " ")}` : "your resume"}
                  {`; Lots on it: ${openSkill.proven_lots}; explained out loud: ${openSkill.proven_voice}`}
                  {openSkill.topics_total > 0 ? `; syllabus levels cleared: ${openSkill.topics_cleared} of ${openSkill.topics_total}` : ""}.</p>
                <p><span className="font-medium">How to improve:</span> do the Lots that use this skill, explain each one out loud,
                  and clear its syllabus levels on your roadmap.</p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StudentSkillsProved;
