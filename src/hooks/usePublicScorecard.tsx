import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface PublicScorecard {
  resume_quality_score: number | null;
  ats_match_score: number | null;
  skill_proof_score: number | null;
  project_proof_score: number | null;
  reasoning_score: number | null;
  interview_readiness_score: number | null;
  roadmap: string | null;
  created_at: string;
}

export const usePublicScorecard = (studentId?: string) => {
  const [scorecard, setScorecard] = useState<PublicScorecard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!studentId) {
      setLoading(false);
      return;
    }

    const fetchScorecard = async () => {
      setLoading(true);
      // ponytail: public_resume_scorecards view already scopes to is_public portfolios
      // and drops voice_notes — no extra filtering needed client-side.
      const { data } = await supabase
        .from("public_resume_scorecards")
        .select("*")
        .eq("student_id", studentId)
        .maybeSingle();

      setScorecard(data);
      setLoading(false);
    };

    fetchScorecard();
  }, [studentId]);

  return { scorecard, loading };
};
