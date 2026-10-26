import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

// Squad swaps (migration 143). A college sees its own finished swaps; the admin also sees waiting,
// declined, cancelled and expired requests, for one college or all of them.

interface SwapRow {
  id: string; college: string | null; cohort: string | null; status: string;
  from_student: string; from_squad: string; from_points: number | null;
  to_student: string; to_squad: string; to_points: number | null;
  created_at: string; decided_at: string | null;
}

export default function SquadSwapsList({ collegeId, showCollege = false }: { collegeId?: string | null; showCollege?: boolean }) {
  const [rows, setRows] = useState<SwapRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("squad_swaps_list" as never, { _college_id: collegeId ?? null } as never).then(({ data, error }) => {
      setError(error?.message ?? null);
      setRows((data as SwapRow[]) ?? []);
    });
  }, [collegeId]);

  if (error) return <p className="text-sm text-alert">{error}</p>;
  if (!rows) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">No squad swaps yet. Students can swap in the first 7 days of a season.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[720px]" data-testid="squad-swaps">
        <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="py-2 pr-3">When</th>
            {showCollege && <th className="py-2 pr-3">College</th>}
            <th className="py-2 pr-3">Section</th>
            <th className="py-2 pr-3">Student moved</th>
            <th className="py-2 pr-3">Swapped with</th>
            <th className="py-2 pr-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t align-top">
              <td className="py-2 pr-3 whitespace-nowrap">{format(new Date(r.decided_at ?? r.created_at), "d MMM yyyy, h:mm a")}</td>
              {showCollege && <td className="py-2 pr-3">{r.college ?? "—"}</td>}
              <td className="py-2 pr-3">{r.cohort ?? "—"}</td>
              <td className="py-2 pr-3">
                <b>{r.from_student}</b>: {r.from_squad} → {r.to_squad}
                {r.from_points != null && <div className="text-xs text-muted-foreground">{r.from_points} points moved with them</div>}
              </td>
              <td className="py-2 pr-3">
                <b>{r.to_student}</b>: {r.to_squad} → {r.from_squad}
                {r.to_points != null && <div className="text-xs text-muted-foreground">{r.to_points} points moved with them</div>}
              </td>
              <td className="py-2 pr-3"><Badge variant={r.status === "done" ? "default" : "secondary"}>{r.status}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
