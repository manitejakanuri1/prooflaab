import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/hooks/useConfirm";
import { toast } from "@/hooks/use-toast";
import { fmtDay } from "@/lib/ist";

interface AssignedRow {
  title: string; description: string | null; assigned_at: string; due_date: string | null;
  students: number; handed_in: number; passed: number; task_ids: string[];
}
interface StudentRow { student_id: string; full_name: string | null; roll_number: string | null; state: "passed" | "handed_in" | "not_started" }

const STATE: Record<StudentRow["state"], { label: string; cls: string }> = {
  passed: { label: "Passed", cls: "bg-verified/15 text-verified hover:bg-verified/15" },
  handed_in: { label: "Handed in", cls: "bg-primary/15 text-primary hover:bg-primary/15" },
  not_started: { label: "Not handed in", cls: "bg-muted text-muted-foreground hover:bg-muted" },
};

/** Assign test 12 Nov 2026 (item 5, migration 250): the tasks this college assigned and how far its students got.
 *  E2E C5 (migration 295): a row opens the task (text + each student's status) with a Cancel button. */
const CollegeAssignedTasks = () => {
  const qc = useQueryClient();
  const [open, setOpen] = useState<AssignedRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmBox, ask] = useConfirm();
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["college-assigned-tasks"],
    queryFn: async (): Promise<AssignedRow[]> => {
      const { data, error } = await supabase.rpc("college_assigned_tasks" as never);
      if (error) throw error;
      return (data ?? []) as AssignedRow[];
    },
  });
  const ids = open?.task_ids ?? [];
  const who = useQuery({
    queryKey: ["college-assigned-task-students", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async (): Promise<StudentRow[]> => {
      const { data, error } = await supabase.rpc("college_assigned_task_students" as never, { _task_ids: ids } as never);
      if (error) throw error;
      return (data ?? []) as StudentRow[];
    },
  });

  const cancel = async () => {
    if (!open) return;
    const waiting = open.students - open.handed_in;
    if (!(await ask({
      title: `Cancel "${open.title}"?`,
      points: [
        open.students === 0 ? "No student has it; the task is removed."
          : `It is removed for the ${waiting} ${waiting === 1 ? "student" : "students"} who have not handed it in.`,
        ...(open.handed_in > 0 ? [`Work already handed in (${open.handed_in}) is kept.`] : []),
      ],
      action: "Cancel task",
    }))) return;
    setBusy(true);
    const { data: res, error: err } = await supabase.rpc("college_cancel_assigned_tasks" as never, { _task_ids: open.task_ids } as never);
    setBusy(false);
    if (err) { toast({ title: "Not cancelled", description: err.message, variant: "destructive" }); return; }
    const r = res as unknown as { removed: number; kept: number };
    toast({ title: `Task cancelled for ${r.removed} ${r.removed === 1 ? "student" : "students"}`,
            description: r.kept > 0 ? `${r.kept} handed-in ${r.kept === 1 ? "answer was" : "answers were"} kept.` : undefined });
    setOpen(null);
    await qc.invalidateQueries({ queryKey: ["college-assigned-tasks"] });
  };

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
                  <tr key={r.task_ids.join(",")} className="border-t cursor-pointer hover:bg-muted/40"
                      onClick={() => setOpen(r)} title="Open this task">
                    <td className="py-2 pr-3 text-primary underline-offset-2 hover:underline">{r.title}</td>
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

      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto" data-testid="assigned-task-detail">
          <DialogHeader>
            <DialogTitle>{open?.title}</DialogTitle>
            <DialogDescription>
              Assigned {fmtDay(open?.assigned_at ?? null)} · due {fmtDay(open?.due_date ?? null)}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm whitespace-pre-wrap">{open?.description}</p>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Students</p>
            {who.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
              : who.error ? <p className="text-sm text-alert">{(who.error as Error).message}</p>
              : (who.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No student has this task now.</p>
              : (
              <ul className="divide-y text-sm">
                {(who.data ?? []).map((s) => (
                  <li key={s.student_id} className="flex items-center gap-2 py-1.5">
                    <span>{s.full_name ?? "Student"}</span>
                    {s.roll_number && <span className="text-xs text-muted-foreground">{s.roll_number}</span>}
                    <Badge className={`ml-auto ${STATE[s.state].cls}`}>{STATE[s.state].label}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(null)}>Close</Button>
            <Button variant="destructive" disabled={busy || !open || (open.students > 0 && open.handed_in >= open.students)}
                    title={open && open.students > 0 && open.handed_in >= open.students ? "Every student has handed it in" : undefined}
                    onClick={() => void cancel()}>
              {busy ? "Cancelling…" : "Cancel task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmBox}
    </Card>
  );
};
export default CollegeAssignedTasks;
