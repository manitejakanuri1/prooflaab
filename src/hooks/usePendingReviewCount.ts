import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * How many written answers are waiting for a person (S31). Shares the query key and data shape of
 * ReviewedSubmissions, so the badge and the list are one cache: approving or rejecting there
 * (which invalidates the key) updates the badge too. needs_review_submissions() already limits
 * the rows to an admin or the student's own approved college; anyone else gets none.
 */
export function usePendingReviewCount(enabled = true): number {
  const { data } = useQuery({
    queryKey: ["needs-review-submissions"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("needs_review_submissions" as never);
      if (error) throw error;
      return (data ?? []) as unknown[];
    },
    enabled,
  });
  return Array.isArray(data) ? data.length : 0;
}
