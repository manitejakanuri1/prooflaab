import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtDay } from "@/lib/ist";
import { applyHost } from "@/lib/applyLink";

// Owner 12 Nov 2026 (migration 310): jobs from the student's own college plus company jobs an admin approved.
// student_jobs() does the choosing and hides jobs past their last date. The whole job is read here, in the app;
// the Apply button is the only way out of ProofLab, and it asks first.

interface Job {
  job_id: string; title: string; company: string; location: string; job_type: string;
  details: string | null; last_date: string | null; apply_link: string | null; posted_by: "college" | "company";
}

export default function StudentJobsPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<{ job: Job; host: string } | null>(null);

  useEffect(() => {
    supabase.rpc("student_jobs" as never).then(({ data, error }) => {
      if (error) setError(error.message);
      setJobs((data as Job[]) ?? []);
    });
  }, []);

  const recordApply = (job: Job) => {
    supabase.rpc("student_job_apply_click" as never, { _job_id: job.job_id } as never).then(() => {}, () => {});
    // Close after the browser has followed the link (removing the link mid-click can cancel it).
    setTimeout(() => setLeaving(null), 0);
  };

  return (
    <div className="space-y-4" data-testid="student-jobs">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Jobs</h1>
        <p className="text-sm text-muted-foreground">Jobs from your college, and company jobs ProofLab has checked.</p>
      </div>

      {jobs === null && <p className="text-sm text-muted-foreground">Loading jobs…</p>}
      {error && <p className="text-sm text-destructive">Could not load jobs: {error}</p>}
      {jobs?.length === 0 && !error && (
        <p className="text-sm text-muted-foreground" data-testid="jobs-empty">No open jobs right now. Check again later.</p>
      )}

      {jobs?.map((job) => {
        const host = applyHost(job.apply_link);
        return (
          <Card key={job.job_id} data-testid="job-card">
            <CardContent className="pt-5 space-y-3">
              <div className="flex flex-wrap items-start gap-2">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold">{job.title}</h3>
                  <p className="text-sm text-muted-foreground">{job.company}</p>
                </div>
                <Badge variant="outline">{job.posted_by === "college" ? "From your college" : "Company job"}</Badge>
              </div>
              <p className="text-sm">{job.location} · {job.job_type}</p>
              <p className="text-sm">
                Last date to apply: <b>{job.last_date ? fmtDay(job.last_date) : "No deadline"}</b>
              </p>
              {job.details && <p className="text-sm whitespace-pre-line">{job.details}</p>}
              {host ? (
                <Button size="sm" onClick={() => setLeaving({ job, host })}>Apply</Button>
              ) : (
                <p className="text-sm text-muted-foreground">Ask your college how to apply.</p>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={leaving !== null} onOpenChange={(open) => !open && setLeaving(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Apply for this job</DialogTitle>
          </DialogHeader>
          <p className="text-sm">You're leaving ProofLab to apply on {leaving?.host}.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaving(null)}>Stay</Button>
            {leaving && (
              <Button asChild>
                <a href={leaving.job.apply_link!} target="_blank" rel="noopener noreferrer" data-testid="apply-out"
                   onClick={() => recordApply(leaving.job)}>
                  Continue
                </a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
