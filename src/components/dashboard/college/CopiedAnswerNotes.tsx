import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { copiedNoteText, type CopiedNote } from "@/lib/lotText";
import { fmtDay } from "@/lib/ist";

/**
 * Purna 12 Nov 2026 (migration 229): an info-only list of answers that look copied, for this college's own
 * students (copied_answer_notes() filters by college). No button, no count, nothing to do: the mark stands.
 */
const CopiedAnswerNotes = () => {
  const { data = [] } = useQuery({
    queryKey: ["copied-answer-notes"],
    queryFn: async (): Promise<CopiedNote[]> => {
      const { data, error } = await supabase.rpc("copied_answer_notes" as never, { _limit: 10 } as never);
      if (error) throw error;
      return (data ?? []) as CopiedNote[];
    },
  });
  if (data.length === 0) return null;
  return (
    <Card data-testid="copied-notes">
      <CardContent className="pt-5 space-y-1">
        <p className="flex items-center gap-2 text-sm font-medium"><Info className="h-4 w-4 text-muted-foreground" />For your information</p>
        {data.map((n) => (
          <p key={n.submission_id} className="text-xs text-muted-foreground">{copiedNoteText(n, (d) => fmtDay(d))}</p>
        ))}
      </CardContent>
    </Card>
  );
};
export default CopiedAnswerNotes;
