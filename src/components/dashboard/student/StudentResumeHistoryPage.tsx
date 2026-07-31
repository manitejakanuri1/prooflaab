import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History, TrendingUp, TrendingDown, Minus } from "lucide-react";
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
}

const StudentResumeHistoryPage = () => {
  const { user } = useAuth();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

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
        .select("id, created_at, resume_quality_score, ats_match_score, skill_proof_score, voice_authenticity_score, coding_score, is_retest")
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
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => {
                    const prev = history[i + 1];
                    const delta =
                      prev && h.skill_proof_score != null && prev.skill_proof_score != null
                        ? h.skill_proof_score - prev.skill_proof_score
                        : null;
                    return (
                      <tr key={h.id} className="border-b last:border-0">
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
                      </tr>
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
