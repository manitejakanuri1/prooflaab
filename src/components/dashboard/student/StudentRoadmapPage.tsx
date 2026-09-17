import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Map, Flag, CheckCircle2, Clock, PlayCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { parseStages, type RoadmapStage } from "./RoadmapStages";
import type { TestMistake } from "./TestMistakes";
import LevelMap from "./LevelMap";
import ThisWeekPlan from "./ThisWeekPlan";

interface StageTask {
  roadmap_stage_index: number;
  status: "Pending" | "In Progress" | "Under Review" | "Completed";
}

const statusMeta: Record<StageTask["status"], { label: string; className: string; icon: typeof Clock }> = {
  Pending: { label: "Not started", className: "border-muted-foreground/30 text-muted-foreground", icon: Clock },
  "In Progress": { label: "In progress", className: "border-amber-400 text-amber-600", icon: PlayCircle },
  "Under Review": { label: "Under review", className: "border-blue-400 text-blue-600", icon: Clock },
  Completed: { label: "Done", className: "border-emerald-500 text-emerald-600", icon: CheckCircle2 },
};

const StudentRoadmapPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stages, setStages] = useState<RoadmapStage[] | null>(null);
  const [taskStatusByStage, setTaskStatusByStage] = useState<Record<number, StageTask["status"]>>({});
  const [hasScorecard, setHasScorecard] = useState(false);

  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: profile } = await supabase.from("student_profiles").select("id").eq("user_id", user.id).single();
      if (!profile) {
        setLoading(false);
        return;
      }
      const { data: scorecard } = await supabase
        .from("resume_scorecards")
        .select("id, roadmap")
        .eq("student_id", profile.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!scorecard) {
        setLoading(false);
        return;
      }
      setHasScorecard(true);
      setStages(parseStages(scorecard.roadmap));

      const { data: tasks } = await supabase
        .from("tasks")
        .select("roadmap_stage_index, started_at, proof_uploads(status)")
        .eq("roadmap_scorecard_id", scorecard.id);

      const statusMap: Record<number, StageTask["status"]> = {};
      (tasks || []).forEach((t: any) => {
        const proofs = Array.isArray(t.proof_uploads) ? t.proof_uploads : [];
        let status: StageTask["status"] = "Pending";
        if (proofs.length > 0) {
          status = proofs[proofs.length - 1].status === "Verified" ? "Completed" : "Under Review";
        } else if (t.started_at) {
          status = "In Progress";
        }
        statusMap[t.roadmap_stage_index] = status;
      });
      setTaskStatusByStage(statusMap);
      setLoading(false);
    })();
  }, [user]);

  // The test's roadmap, shown on the ladder: each stage under the step whose
  // skill it names (anything unmatched goes in the "Other" box on the map).
  // "Clean sweep" is the no-mistakes placeholder, not something to revise.
  const mistakes: TestMistake[] = (stages ?? []).filter((st) => st.title !== "Clean sweep").map((st, i) => ({
    skill: st.skill ?? "other",
    title: st.title,
    why: st.why,
    action: st.action,
    status: taskStatusByStage[i] ?? "Pending",
  }));

  return (
    <div className="space-y-6">
      <ThisWeekPlan />
      <LevelMap mistakes={mistakes} onGoToTasks={() => navigate("/student/tasks/assigned")} />
    </div>
  );
};

export default StudentRoadmapPage;
