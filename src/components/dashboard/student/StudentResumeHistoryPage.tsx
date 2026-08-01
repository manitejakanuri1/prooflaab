import { Fragment, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface HistoryEntry {
  id: string;
  created_at: string;
  resume_quality_score: number | null;
  ats_match_score: number | null;
  skill_proof_score: number | null;
  voice_authenticity_score: number | null;
  coding_score: number | null;
  is_retest: boolean;
  assessment_id: string | null;
}

interface AnswerScore {
  question_id: string;
  question_prompt: string;
  question_type: "mcq" | "short_answer";
  student_answer: string;
  correct_answer?: string;
  final_score: number;
  explanation: string;
}

const StudentResumeHistoryPage = () => {
  const { user } = useAuth();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [answersByAssessment, setAnswersByAssessment] = useState<Record<string, AnswerScore[]>>({});
  const [answersLoading, setAnswersLoading] = useState<string | null>(null);

  const toggleExpand = async (entry: HistoryEntry) => {
    if (expandedId === entry.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(entry.id);
    if (!entry.assessment_id || answersByAssessment[entry.assessment_id]) return;
    setAnswersLoading(entry.assessment_id);
    const { data } = await supabase
      .from("resume_assessments")
      .select("answer_scores")
      .eq("id", entry.assessment_id)
      .maybeSingle();
    setAnswersByAssessment((prev) => ({
      ...prev,
      [entry.assessment_id!]: (data?.answer_scores as unknown as AnswerScore[]) || [],
    }));
    setAnswersLoading(null);
  };

  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: profile } = await supabase.from("student_profiles").select("id").eq("user_id", user.id).single();
      if (!profile) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("resume_scorecards")
        .select("id, created_at, resume_quality_score, ats_match_score, skill_proof_score, voice_authenticity_score, coding_score, is_retest, assessment_id")
        .eq("student_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(20);
      setHistory((data as HistoryEntry[]) || []);
      setLoading(false);
    })();
  }, [user]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <History className="h-5 w-5" />
          Retest history
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="animate-pulse h-24 bg-muted rounded" />
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No assessments yet — confirm your resume and take the assessment first.</p>
        ) : (
          <>
            {(() => {
              const oldest = history[history.length - 1];
              const latest = history[0];
              const hasDelta = oldest.skill_proof_score != null && latest.skill_proof_score != null;
              const netDelta = hasDelta ? latest.skill_proof_score! - oldest.skill_proof_score! : null;
              const retestCount = history.filter((h) => h.is_retest).length;
              return (
                <p className="text-xs text-muted-foreground mb-3">
                  First tested {new Date(oldest.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                  {retestCount > 0 && (
                    <> · latest retest {new Date(latest.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</>
                  )}
                  {netDelta !== null && netDelta !== 0 && (
                    <>
                      {" · "}
                      {netDelta > 0
                        ? `net +${netDelta} skill proof — actual glow-up, not a fluke`
                        : `net ${netDelta} skill proof — rough patch, roadmap's calling`}
                    </>
                  )}
                  {netDelta === 0 && retestCount > 0 && <> · flat so far — same score, try again after more prep</>}
                </p>
              );
            })()}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-4 font-medium">Date</th>
                    <th className="py-2 px-3 font-medium">Type</th>
                    <th className="py-2 px-3 font-medium">Quality</th>
                    <th className="py-2 px-3 font-medium">ATS</th>
                    <th className="py-2 px-3 font-medium">Skill Proof</th>
                    <th className="py-2 px-3 font-medium">Voice</th>
                    <th className="py-2 px-3 font-medium">Coding</th>
                    <th className="py-2 pl-3 font-medium w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => {
                    const prev = history[i + 1];
                    const delta =
                      prev && h.skill_proof_score != null && prev.skill_proof_score != null
                        ? h.skill_proof_score - prev.skill_proof_score
                        : null;
                    const isExpanded = expandedId === h.id;
                    const answers = h.assessment_id ? answersByAssessment[h.assessment_id] : undefined;
                    return (
                      <Fragment key={h.id}>
                        <tr
                          className="border-b last:border-0 cursor-pointer hover:bg-muted/30"
                          onClick={() => toggleExpand(h)}
                        >
                          <td className="py-2 pr-4 whitespace-nowrap">
                            {new Date(h.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                          </td>
                          <td className="py-2 px-3">
                            {h.is_retest ? (
                              <Badge variant="outline" className="border-amber-400 text-amber-600">Retest</Badge>
                            ) : (
                              <Badge variant="secondary">Full</Badge>
                            )}
                          </td>
                          <td className="py-2 px-3">{h.resume_quality_score ?? "—"}</td>
                          <td className="py-2 px-3">{h.ats_match_score ?? "—"}</td>
                          <td className="py-2 px-3">
                            <span className="inline-flex items-center gap-1">
                              {h.skill_proof_score ?? "—"}
                              {delta !== null && delta > 0 && (
                                <span className="inline-flex items-center text-emerald-600" title={`Up ${delta} vs last attempt`}>
                                  <TrendingUp className="h-3.5 w-3.5" />
                                </span>
                              )}
                              {delta !== null && delta < 0 && (
                                <span className="inline-flex items-center text-red-500" title={`Down ${Math.abs(delta)} vs last attempt`}>
                                  <TrendingDown className="h-3.5 w-3.5" />
                                </span>
                              )}
                              {delta === 0 && (
                                <span className="inline-flex items-center text-muted-foreground" title="Same as last attempt">
                                  <Minus className="h-3.5 w-3.5" />
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="py-2 px-3">{h.voice_authenticity_score ?? "—"}</td>
                          <td className="py-2 px-3">{h.coding_score ?? "—"}</td>
                          <td className="py-2 pl-3 text-muted-foreground">
                            {h.assessment_id && (isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />)}
                          </td>
                        </tr>
                        {isExpanded && h.assessment_id && (
                          <tr className="border-b last:border-0">
                            <td colSpan={8} className="py-3 px-3 bg-muted/20">
                              {answersLoading === h.assessment_id ? (
                                <div className="animate-pulse h-16 bg-muted rounded" />
                              ) : !answers || answers.length === 0 ? (
                                <p className="text-xs text-muted-foreground">No per-question breakdown saved for this attempt.</p>
                              ) : (
                                <div className="space-y-2">
                                  {answers.map((a) => (
                                    <div key={a.question_id} className="border rounded-lg p-2.5 text-sm bg-background">
                                      <div className="flex items-start gap-2">
                                        {a.final_score >= 70 ? (
                                          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                                        ) : (
                                          <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                                        )}
                                        <p className="font-medium">{a.question_prompt}</p>
                                      </div>
                                      <p className="text-xs text-muted-foreground mt-1">You answered: {a.student_answer}</p>
                                      {a.question_type === "mcq" && a.final_score < 70 && a.correct_answer && (
                                        <p className="text-xs text-muted-foreground">Correct answer: {a.correct_answer}</p>
                                      )}
                                      <p className="text-xs text-muted-foreground mt-1">
                                        <span className="font-medium text-foreground">Why: </span>{a.explanation}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default StudentResumeHistoryPage;
