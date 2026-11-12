import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDay } from "@/lib/ist";

interface AssignedRow { title: string; assigned_at: string; due_date: string | null; students: number; handed_in: number; passed: number }

/** Assign test 12 Nov 2026 (item 5, migration 250): the tasks this college assigned and how far its students got. */
const CollegeAssignedTasks = () => {
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["college-assigned-tasks"],
    queryFn: async (): Promise<AssignedRow[]> => {
      const { data, error } = await supabase.rpc("college_assigned_tasks" as never);
      if (error) throw error;
      return (data ?? []) as AssignedRow[];
    },
  });
  return (
    <Card data-testid="assigned-tasks">
      <CardHeader><CardTitle>Assigned tasks</CardTitle></CardHeader>
      <CardContent>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
          : error ? <p className="text-sm text-alert">{(error as Error).message}</p>
          : data.length === 0 ? <p className="text-sm text-muted-foreground">You have not assigned a task yet. Use Students &gt; Assign Task.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="pb-2 pr-3">Task</th><th className="pb-2 pr-3">Assigned</th><th className="pb-2 pr-3">Due</th>
                  <th className="pb-2 pr-3">Students</th><th className="pb-2 pr-3">Handed in</th><th className="pb-2">Passed</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={`${r.title}-${r.assigned_at}`} className="border-t">
                    <td className="py-2 pr-3">{r.title}</td>
                    <td className="py-2 pr-3">{fmtDay(r.assigned_at)}</td>
                    <td className="py-2 pr-3">{fmtDay(r.due_date)}</td>
                    <td className="py-2 pr-3">{r.students}</td>
                    <td className="py-2 pr-3">{r.handed_in}</td>
                    <td className="py-2">{r.passed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
export default CollegeAssignedTasks;
