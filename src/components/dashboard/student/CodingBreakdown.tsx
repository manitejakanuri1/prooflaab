import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Row { question_no: number; passed: number; counted: number; skipped: boolean }

/**
 * How the onboarding coding score was made, one line per question (migration 128).
 * The score is all tests passed / all tests counted, so a skipped question pulls it down
 * even when the other answer was fully correct. Renders nothing until the counts arrive.
 */
const CodingBreakdown = ({ assessmentId }: { assessmentId?: string | null }) => {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!assessmentId) return;
    supabase.rpc("my_coding_breakdown" as never, { _assessment_id: assessmentId } as never)
      .then(({ data }) => setRows(((data as Row[] | null) ?? [])), () => {});
  }, [assessmentId]);

  if (!rows.length) return null;
  const passed = rows.reduce((s, r) => s + r.passed, 0);
  const counted = rows.reduce((s, r) => s + r.counted, 0);

  return (
    <div className="mt-2 space-y-0.5 text-xs text-muted-foreground text-left">
      {rows.map((r) => (
        <p key={r.question_no}>
          Question {r.question_no}: {r.skipped ? `skipped (0/${r.counted})` : `${r.passed}/${r.counted} tests passed`}
        </p>
      ))}
      <p>Score = {passed} of {counted} tests passed. A skipped question counts as 0.</p>
    </div>
  );
};

export default CodingBreakdown;
