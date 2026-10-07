import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Clock, PlayCircle } from "lucide-react";
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
  const [taskIdByStage, setTaskIdByStage] = useState<Record<number, string>>({});
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
        .select("id, roadmap_stage_index, started_at, status, task_submissions(status, created_at)")
        .eq("roadmap_scorecard_id", scorecard.id);

      const statusMap: Record<number, StageTask["status"]> = {};
      const idMap: Record<number, string> = {};
      (tasks || []).forEach((t: any) => {
        idMap[t.roadmap_stage_index] = t.id;
        // Graded attempts on this stage's task (task_submissions; proof uploads are retired).
        const attempts = Array.isArray(t.task_submissions) ? t.task_submissions : [];
        let status: StageTask["status"] = "Pending";
        if (t.status === "completed" || attempts.some((a: any) => a.status === "passed")) {
          status = "Completed";
        } else if (attempts.some((a: any) => a.status === "needs_review")) {
          status = "Under Review";
        } else if (t.started_at || attempts.length > 0) {
          status = "In Progress";
        }
        statusMap[t.roadmap_stage_index] = status;
      });
      setTaskStatusByStage(statusMap);
      setTaskIdByStage(idMap);
      setLoading(false);
    })();
  }, [user]);

  // The test's roadmap, shown on the ladder: each stage under the step whose
  // skill it names (anything unmatched goes in the "Other" box on the map).
  // "Clean sweep" is the no-mistakes placeholder, not something to revise.
  const mistakes: TestMistake[] = (stages ?? []).map((st, i) => ({
    skill: st.skill ?? "other",
    title: st.title,
    why: st.why,
    action: st.action,
    status: taskStatusByStage[i] ?? "Pending",
    taskId: taskIdByStage[i],
  })).filter((m) => m.title !== "Clean sweep");

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Your learning path: lessons and quizzes, step by step. Your one task for today is on the Daily Card.
      </p>
      <ThisWeekPlan />
      <div id="ladder">
        <LevelMap mistakes={mistakes} onGoToTasks={(taskId) => navigate(taskId ? `/student/tasks/assigned?open=${taskId}` : "/student/tasks/assigned")} />
      </div>
    </div>
  );
};

export default StudentRoadmapPage;
