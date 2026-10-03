import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const since = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();
const count = async (table: string, build: (q: any) => any = (q) => q) => {
  const { count, error } = await build(supabase.from(table as never).select("id", { count: "exact", head: true }));
  if (error) throw error;
  return count ?? 0;
};

/**
 * Admin > Operations > Jobs & health: what the background work has actually
 * produced, read from the database rows those jobs write. It answers "did last
 * night's jobs run, and is anything stuck?" without opening the cloud console.
 *
 * It does not show Cloud Scheduler or queue internals - the browser has no access
 * to those. A job that did not run shows up here as a zero where a number should be.
 */
const AdminOpsHealth = () => {
  const today = new Date().toISOString().slice(0, 10);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-ops-health"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const [lotsToday, activeStudents, voicePending, voiceStuck, voiceFailed, pages7d, templates, ai24h, review] = await Promise.all([
        count("tasks", (q) => q.eq("lot_date", today)),
        count("student_profiles", (q) => q.eq("status", "active")),
        count("voice_explanations", (q) => q.in("transcription_status", ["pending", "processing"])),
        count("voice_explanations", (q) => q.in("transcription_status", ["pending", "processing"]).lt("created_at", since(0.25))),
        count("voice_explanations", (q) => q.eq("transcription_status", "failed").gte("created_at", since(24))),
        count("source_content", (q) => q.gte("fetched_at", since(24 * 7))),
        count("lot_templates"),
        count("llm_usage", (q) => q.gte("created_at", since(24))),
        count("task_submissions", (q) => q.eq("status", "needs_review")),
      ]);
      return { lotsToday, activeStudents, voicePending, voiceStuck, voiceFailed, pages7d, templates, ai24h, review };
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="text-sm text-destructive">Could not load: {(error as Error)?.message}</p>;

  const rows: { area: string; label: string; value: string; bad: boolean; hint: string }[] = [
    { area: "Daily Lots", label: "Lots dated today", value: `${data.lotsToday} for ${data.activeStudents} active students`,
      bad: data.activeStudents > 0 && data.lotsToday === 0, hint: "0 means the 05:40 job did not create today's Lots." },
    { area: "Voice queue", label: "Waiting or being transcribed", value: String(data.voicePending), bad: false, hint: "Normal while students are recording." },
    { area: "Voice queue", label: "Waiting longer than 15 minutes", value: String(data.voiceStuck), bad: data.voiceStuck > 0, hint: "The recovery job should clear these within minutes." },
    { area: "Voice queue", label: "Failed in the last 24 hours", value: String(data.voiceFailed), bad: data.voiceFailed > 0, hint: "The student is asked to record again." },
    { area: "Crawler", label: "New source pages in 7 days", value: String(data.pages7d), bad: data.pages7d === 0, hint: "0 for a week means the crawler found nothing new or did not run." },
    { area: "Lot writing", label: "Lots written and stored", value: String(data.templates), bad: false, hint: "Written once, reused." },
    { area: "AI", label: "AI calls in the last 24 hours", value: String(data.ai24h), bad: false, hint: "Detail is under AI usage." },
    { area: "Work", label: "Submissions waiting for a person", value: String(data.review), bad: false, hint: "See Work > Flags & reviews." },
  ];

  return (
    <Card>
      <CardHeader><CardTitle>Jobs &amp; health</CardTitle></CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t first:border-t-0">
                <td className="py-2 pr-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground w-28">{r.area}</td>
                <td className="py-2 pr-3">{r.label}<p className="text-xs text-muted-foreground">{r.hint}</p></td>
                <td className={`py-2 text-right font-mono tabular-nums ${r.bad ? "text-destructive font-semibold" : ""}`}>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted-foreground">
          Read from the rows the jobs write. Scheduler and queue internals are in the cloud console; alerts cover them.
        </p>
      </CardContent>
    </Card>
  );
};

export default AdminOpsHealth;
