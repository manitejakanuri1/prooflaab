import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Latest confirmed resume_claims id for the current student — shared by the
// job-match, cert-radar, and history tabs so each doesn't repeat the lookup.
export const useConfirmedResumeClaim = () => {
  const { user } = useAuth();
  const [claimId, setClaimId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      const { data: profile } = await supabase
        .from("student_profiles")
        .select("id")
        .eq("user_id", user.id)
        .single();
      if (!profile) {
        if (!cancelled) setLoading(false);
        return;
      }
      const { data } = await supabase
        .from("resume_claims")
        .select("id")
        .eq("student_id", profile.id)
        .eq("status", "confirmed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled) {
        setClaimId(data?.id ?? null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return { claimId, loading };
};
