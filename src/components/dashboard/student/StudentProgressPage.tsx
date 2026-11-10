import InfoTip from "@/components/common/InfoTip";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { supabase } from "@/integrations/supabase/client";
import { fmtMark, loadWeekMarks, SCORE_HELP, type WeekMarks } from "@/lib/lotMarks";
import { latestWeeks, weekChangeText, type WeekRow } from "@/lib/weekPoints";
import { Target, Award, FileCheck, CalendarDays } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

interface WeekPoint { week: number; points: number }
interface EarnedBadge { name: string; emoji: string }

// Brand colours for the chart pop-up (it is drawn inside the chart, not as a portal).
const TOOLTIP = { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--popover-foreground))" };

/**
 * Progress — real numbers only.
 *
 * This used to read tasks.status = 'Completed' for "tasks done" and "XP
 * earned" — a status value that has never once appeared on a real Daily Lot
 * row (the pipeline uses 'pending' / 'In Progress' and never flips a task to
 * any finished state; completion lives in the retired upload table and the weekly
 * scoring tables instead). That made the completion rate and monthly XP
 * chart silently zero for every real student, quietly, forever. Rebuilt on
 * the same tables the season report and weekly scoring already prove
 * correct: student_weekly_scores for points, task_submissions (the Lots a
 * student submits) for passed vs submitted work and
 * student_badges for the rest. (Until 2 Oct 2026 the submission cards read
 * the retired upload table, which stopped filling when upload proof was switched off on
 * 19 Sep, so they showed 0 for everyone.)
 *
 * It also used to pad six months of made-up trust-score history and always
 * showed the same three achievement badges regardless of whether they were
 * earned. A student asking "how much have I actually improved" deserves an
 * honest answer — for a new student, the honest answer is "not much history
 * yet," not a fabricated upward curve.
 */

const StudentProgressPage = () => {
  const { profile, loading: profileLoading } = useStudentProfile();

  const [weeklyPoints, setWeeklyPoints] = useState<WeekPoint[] | null>(null);
  const [badges, setBadges] = useState<EarnedBadge[] | null>(null);
  const [submissions, setSubmissions] = useState<{ total: number; passed: number; review: number } | null>(null);
  // The running week, from the same source as the dashboard's "This week" (my_marks_week).
  const [running, setRunning] = useState<WeekMarks | null>(null);

  useEffect(() => {
    if (!profile?.id) return;
    (async () => {
      // student_weekly_scores holds FINISHED weeks only (written when a week is scored).
      // The newest season's latest 8 finished weeks, in week order (latestWeeks).
      const [{ data: weekly }, { data: earned }, { data: proofs }, week] = await Promise.all([
        supabase.from("student_weekly_scores").select("season_id, week, points, computed_at")
          .eq("student_id", profile.id).order("computed_at", { ascending: false }).limit(200),
        supabase.from("student_badges").select("awarded_at, badges(name, emoji)")
          .eq("student_id", profile.id).order("awarded_at", { ascending: false }).limit(3),
        supabase.from("task_submissions").select("status").eq("student_id", profile.id),
        loadWeekMarks().catch(() => null),
      ]);

      setRunning(week);
      setWeeklyPoints(latestWeeks((weekly ?? []) as WeekRow[]));
      setBadges((earned ?? []).map((r: any) => ({ name: r.badges?.name ?? "Badge", emoji: r.badges?.emoji ?? "🏅" })));
      setSubmissions({
        total: (proofs ?? []).length,
        passed: (proofs ?? []).filter((p) => p.status === "passed").length,
        review: (proofs ?? []).filter((p) => p.status === "needs_review").length,
      });
    })();
  }, [profile?.id]);

  if (profileLoading || weeklyPoints === null || submissions === null) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => (
            <Card key={i}><CardContent className="pt-6"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  const passRate = submissions.total > 0 ? Math.round((submissions.passed / submissions.total) * 100) : 0;
  // "Last week" = the newest finished week; compared with the finished week before it.
  const lastWeek = weeklyPoints.length > 0 ? weeklyPoints[weeklyPoints.length - 1].points : 0;
  const weekChange = weeklyPoints.length > 0 ? weekChangeText(weeklyPoints) : null;
  const lotsSoFar = running?.days.length ?? 0;

  const submissionData = [
    { name: "Passed", value: submissions.passed, color: "hsl(var(--verified))" },
    { name: "Needs review", value: submissions.review, color: "hsl(var(--compete))" },
    { name: "Not passed", value: submissions.total - submissions.passed - submissions.review, color: "hsl(var(--alert))" },
  ];

  const progressCards = [
    { title: "This week (so far)", value: fmtMark(running?.week_total), icon: CalendarDays, help: SCORE_HELP.thisWeek,
      color: "text-primary", bgColor: "bg-primary/10", change: `${lotsSoFar} ${lotsSoFar === 1 ? "Lot" : "Lots"} so far` },
    { title: "Last week", value: fmtMark(lastWeek), icon: Award, help: SCORE_HELP.lastWeek,
      color: "text-verified", bgColor: "bg-verified/10", change: weekChange },
    { title: "Pass Rate", value: `${passRate}%`, icon: Target, help: "Lots passed ÷ Lots handed in.",
      color: "text-primary", bgColor: "bg-primary/10", change: null },
    { title: "Total Submissions", value: submissions.total.toString(), icon: FileCheck, help: "Every piece of work you have handed in.",
      color: "text-compete", bgColor: "bg-compete/10", change: null },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {progressCards.map((card, index) => {
          const Icon = card.icon;
          return (
            <Card key={index} className="transition-all hover:shadow-md">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="flex items-center gap-1 text-sm font-medium text-muted-foreground">{card.title} <InfoTip text={card.help} /></CardTitle>
                <div className={`p-2 rounded-lg ${card.bgColor}`}>
                  <Icon className={`h-4 w-4 ${card.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{card.value}</div>
                {card.change && <div className="text-sm text-verified">{card.change}</div>}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base sm:text-lg font-semibold">Points — finished weeks</CardTitle>
            <p className="text-xs text-muted-foreground">One bar per finished week: that week's Lot marks added up (up to 20 per Lot). The running week is in "This week".</p>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            {weeklyPoints.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={weeklyPoints}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" tickFormatter={(w) => `Wk ${w}`} stroke="hsl(var(--border))" tick={{ fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis stroke="hsl(var(--border))" tick={{ fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip labelFormatter={(w) => `Week ${w}`} contentStyle={TOOLTIP} cursor={{ fill: "hsl(var(--primary) / 0.08)" }} />
                  <Bar dataKey="points" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-center px-6">
                <p className="text-sm text-muted-foreground">
                  No season running yet — this fills in once your college starts one.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base sm:text-lg font-semibold">Submission Status</CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            {submissions.total > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={submissionData} cx="50%" cy="50%" innerRadius={60} outerRadius={100}
                         paddingAngle={5} dataKey="value" stroke="hsl(var(--card))">
                      {submissionData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap justify-center gap-4 mt-4">
                  {submissionData.map((entry, index) => (
                    <div key={index} className="flex items-center space-x-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }}></div>
                      <span className="text-sm text-muted-foreground">{entry.name}: {entry.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-center px-6">
                <p className="text-sm text-muted-foreground">Nothing submitted yet.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base sm:text-lg font-semibold">Progress Indicators</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 sm:space-y-6 p-4 sm:p-6 pt-0">
            {/* MF-077: Pass Rate is already a card above; it is not shown twice. */}
            <div className="pt-4">
              <h4 className="text-sm font-medium mb-3">Most Recent Badges</h4>
              {badges && badges.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {badges.map((b, i) => (
                    <Badge key={i} className="bg-compete/10 text-compete">{b.emoji} {b.name}</Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  None yet — badges appear here as they're earned. See Build-log → Badges & Quests for how.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default StudentProgressPage;
