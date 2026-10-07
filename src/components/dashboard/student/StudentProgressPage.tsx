import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { supabase } from "@/integrations/supabase/client";
import { Target, Award, FileCheck } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

interface WeekPoint { week: number; points: number }
interface EarnedBadge { name: string; emoji: string }

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

  useEffect(() => {
    if (!profile?.id) return;
    (async () => {
      const [{ data: weekly }, { data: earned }, { data: proofs }] = await Promise.all([
        supabase.from("student_weekly_scores").select("week, points")
          .eq("student_id", profile.id).order("week", { ascending: true }).limit(8),
        supabase.from("student_badges").select("awarded_at, badges(name, emoji)")
          .eq("student_id", profile.id).order("awarded_at", { ascending: false }).limit(3),
        supabase.from("task_submissions").select("status").eq("student_id", profile.id),
      ]);

      setWeeklyPoints((weekly ?? []).map((w) => ({ week: w.week as number, points: w.points as number })));
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
  const thisWeek = weeklyPoints.length > 0 ? weeklyPoints[weeklyPoints.length - 1].points : 0;
  const lastWeek = weeklyPoints.length > 1 ? weeklyPoints[weeklyPoints.length - 2].points : null;
  const weekChange = lastWeek != null
    ? (lastWeek === 0 ? (thisWeek > 0 ? "up from a quiet week" : null)
       : `${thisWeek >= lastWeek ? "+" : ""}${Math.round(((thisWeek - lastWeek) / lastWeek) * 100)}% vs last week`)
    : null;

  const submissionData = [
    { name: "Passed", value: submissions.passed, color: "#22c55e" },
    { name: "Needs review", value: submissions.review, color: "#f59e0b" },
    { name: "Not passed", value: submissions.total - submissions.passed - submissions.review, color: "#ef4444" },
  ];

  const progressCards = [
    { title: "This Week's Points", value: thisWeek.toString(), icon: Award,
      color: "text-green-600", bgColor: "bg-green-50", change: weekChange },
    { title: "Pass Rate", value: `${passRate}%`, icon: Target,
      color: "text-blue-600", bgColor: "bg-blue-50", change: null },
    { title: "Total Submissions", value: submissions.total.toString(), icon: FileCheck,
      color: "text-orange-600", bgColor: "bg-orange-50", change: null },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {progressCards.map((card, index) => {
          const Icon = card.icon;
          return (
            <Card key={index} className="transition-all hover:shadow-md">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-gray-600">{card.title}</CardTitle>
                <div className={`p-2 rounded-lg ${card.bgColor}`}>
                  <Icon className={`h-4 w-4 ${card.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{card.value}</div>
                {card.change && <div className="text-sm text-green-600">{card.change}</div>}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <Card>
          <CardHeader className="p-4 sm:p-6">
            <CardTitle className="text-base sm:text-lg font-semibold">Points — Recent Weeks</CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 pt-0">
            {weeklyPoints.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={weeklyPoints}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="week" tickFormatter={(w) => `Wk ${w}`} />
                  <YAxis />
                  <Tooltip labelFormatter={(w) => `Week ${w}`} />
                  <Bar dataKey="points" fill="#ea580c" />
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
                         paddingAngle={5} dataKey="value">
                      {submissionData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap justify-center gap-4 mt-4">
                  {submissionData.map((entry, index) => (
                    <div key={index} className="flex items-center space-x-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }}></div>
                      <span className="text-sm text-gray-600">{entry.name}: {entry.value}</span>
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
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">Pass Rate</span>
                <span className="text-sm font-bold">{passRate}%</span>
              </div>
              <Progress value={passRate} className="h-2" />
            </div>

            <div className="pt-4">
              <h4 className="text-sm font-medium mb-3">Most Recent Badges</h4>
              {badges && badges.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {badges.map((b, i) => (
                    <Badge key={i} className="bg-yellow-100 text-yellow-800">{b.emoji} {b.name}</Badge>
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
