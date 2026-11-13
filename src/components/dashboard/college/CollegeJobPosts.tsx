import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { fmtDay } from "@/lib/ist";

// Owner 12 Nov 2026 (migration 310): the college's own job posts and how many of its students opened Apply.

interface Post { job_id: string; title: string; company: string; last_date: string | null; status: string; students_opened_apply: number }

export default function CollegeJobPosts({ refresh = 0 }: { refresh?: number }) {
  const qc = useQueryClient();
  const { data: posts = [] } = useQuery({
    queryKey: ["college-job-posts"],
    queryFn: async (): Promise<Post[]> => {
      const { data, error } = await supabase.rpc("college_job_posts" as never);
      if (error) {
        console.error("college_job_posts error:", error);
        throw error;
      }
      return (data ?? []) as Post[];
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (refresh > 0) {
      void qc.invalidateQueries({ queryKey: ["college-job-posts"] });
    }
  }, [refresh, qc]);

  if (posts.length === 0) return null;
  return (
    <Card data-testid="college-job-posts">
      <CardContent className="pt-5 space-y-2">
        <h3 className="font-semibold">Your job posts</h3>
        <p className="text-xs text-muted-foreground">Your students see these on their Jobs page until the last date.</p>
        {posts.map((p) => (
          <div key={p.job_id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t pt-2 text-sm">
            <span className="font-medium">{p.title}</span>
            <span className="text-muted-foreground">{p.company}</span>
            <span className="text-muted-foreground">Last date: {p.last_date ? fmtDay(p.last_date) : "No deadline"}</span>
            {p.status !== "approved" && <span className="text-muted-foreground">({p.status})</span>}
            <span className="ml-auto" data-testid="apply-count">
              {p.students_opened_apply} {p.students_opened_apply === 1 ? "student" : "students"} opened Apply
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
