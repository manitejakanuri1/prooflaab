import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

/**
 * Admin "Bug Finder": results of the robot that uses the live app like a student, on a schedule,
 * so bugs are found with nobody online (bug-finder/run.mjs, a Cloud Run job). Not a load test - one
 * careful journey at a time. See CLAUDE.md "Bug finder" for what it does and does not cover yet.
 */

type Run = { run_id: string; started_at: string; passed: number; total: number; failed_steps: string[] };
type Step = { created_at: string; step: string; ok: boolean; duration_ms: number | null; reason: string | null };

const BugFinder = () => {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setErr(null);
    supabase.rpc("admin_bug_finder_runs" as never, { _limit: 30 } as never).then(
      ({ data, error }) => (error ? setErr(error.message) : setRuns((data as unknown as Run[]) ?? [])),
    );
  };
  useEffect(load, []);

  const openRun = (id: string) => {
    setOpen(id);
    supabase.rpc("admin_bug_finder_steps" as never, { _run_id: id } as never).then(
      ({ data, error }) => (error ? setErr(error.message) : setSteps((data as unknown as Step[]) ?? [])),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Bug Finder</h2>
          <p className="text-muted-foreground">A robot student uses the live app the same way a person would, and writes down what broke. Runs on its own test accounts; no real student is involved.</p>
        </div>
        <Button variant="outline" onClick={load}>Refresh</Button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}

      {runs === null ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No runs yet. It has been built but is not scheduled to run on its own — it only runs when triggered by hand or once Cloud Scheduler is turned on for it.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader><CardTitle className="text-sm">Runs</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {runs.map((r) => {
                const failed = r.failed_steps ?? [];        // the database sends null, not [], when nothing failed
                return (
                  <button key={r.run_id} type="button" onClick={() => openRun(r.run_id)}
                    className={`w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted ${open === r.run_id ? "border-primary bg-muted" : ""}`}>
                    <div className="flex items-center gap-2">
                      {failed.length === 0 ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-destructive" />}
                      <span className="font-medium">{format(new Date(r.started_at), "d MMM HH:mm")}</span>
                      <span className="ml-auto font-mono text-xs text-muted-foreground">{r.passed}/{r.total}</span>
                    </div>
                    {failed.length > 0 && <div className="mt-1 text-xs text-destructive">{failed.join(", ")}</div>}
                  </button>
                );
              })}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">{open ? "Steps" : "Pick a run"}</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              {steps.length > 0 && (
                <Table>
                  <TableHeader><TableRow><TableHead>Step</TableHead><TableHead>Result</TableHead><TableHead className="text-right">ms</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {steps.map((s, i) => (
                      <TableRow key={i} className={!s.ok ? "bg-destructive/5" : ""}>
                        <TableCell className="text-sm">{s.step}</TableCell>
                        <TableCell>{s.ok ? <Badge variant="outline">ok</Badge> : <span className="text-xs text-destructive">{s.reason ?? "failed"}</span>}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{s.duration_ms ?? ""}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default BugFinder;
