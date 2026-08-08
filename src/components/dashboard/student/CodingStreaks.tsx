import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Flame, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface StreakRow {
  platform: "leetcode" | "hackerrank";
  username: string | null;
  current_streak: number;
  longest_streak: number;
  last_active_date: string | null;
}

const todayStr = () => new Date().toISOString().slice(0, 10);
const yesterdayStr = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

const CodingStreaks = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, StreakRow>>({});
  const [leetcodeUsername, setLeetcodeUsername] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);

  const loadStreaks = async (sid: string) => {
    const { data } = await supabase
      .from("coding_streaks")
      .select("platform, username, current_streak, longest_streak, last_active_date")
      .eq("student_id", sid);
    const byPlatform: Record<string, StreakRow> = {};
    (data || []).forEach((r) => { byPlatform[r.platform] = r as StreakRow; });
    setRows(byPlatform);
  };

  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: profile } = await supabase.from("student_profiles").select("id").eq("user_id", user.id).maybeSingle();
      if (!profile) return;
      setStudentId(profile.id);
      loadStreaks(profile.id);
    })();
  }, [user]);

  const syncLeetcode = async () => {
    const username = leetcodeUsername || rows.leetcode?.username;
    if (!username) return;
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("leetcode-streak-sync", { body: { username } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (studentId) loadStreaks(studentId);
      toast({ title: "LeetCode streak synced" });
    } catch (err: any) {
      toast({ title: "Couldn't sync LeetCode", description: err.message || "Check the username and try again.", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const checkInHackerrank = async () => {
    if (!studentId) return;
    const existing = rows.hackerrank;
    if (existing?.last_active_date === todayStr()) return; // already checked in today

    let nextStreak = 1;
    if (existing?.last_active_date === yesterdayStr()) {
      nextStreak = existing.current_streak + 1;
    }
    const nextLongest = Math.max(nextStreak, existing?.longest_streak ?? 0);

    setCheckingIn(true);
    try {
      const { error } = await supabase.from("coding_streaks").upsert({
        student_id: studentId,
        platform: "hackerrank",
        current_streak: nextStreak,
        longest_streak: nextLongest,
        last_active_date: todayStr(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "student_id,platform" });
      if (error) throw error;
      loadStreaks(studentId);
      toast({ title: "Streak day logged", description: `${nextStreak} day streak on HackerRank.` });
    } catch (err: any) {
      toast({ title: "Couldn't log check-in", description: err.message, variant: "destructive" });
    } finally {
      setCheckingIn(false);
    }
  };

  const leetcode = rows.leetcode;
  const hackerrank = rows.hackerrank;
  const checkedInToday = hackerrank?.last_active_date === todayStr();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Flame className="h-4 w-4 text-orange-500" />
            LeetCode
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {leetcode ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-base">{leetcode.current_streak} day streak</Badge>
              <span className="text-xs text-muted-foreground">best {leetcode.longest_streak} · @{leetcode.username}</span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Connect your LeetCode username to auto-track your streak.</p>
          )}
          <div className="flex gap-2">
            <Input
              placeholder="leetcode username"
              value={leetcodeUsername}
              onChange={(e) => setLeetcodeUsername(e.target.value)}
              className="h-9"
            />
            <Button size="sm" onClick={syncLeetcode} disabled={syncing || (!leetcodeUsername && !leetcode)}>
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Flame className="h-4 w-4 text-green-600" />
            HackerRank
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {hackerrank ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-base">{hackerrank.current_streak} day streak</Badge>
              <span className="text-xs text-muted-foreground">best {hackerrank.longest_streak}</span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No public API for HackerRank — check in yourself each day you practice.</p>
          )}
          <Button size="sm" variant={checkedInToday ? "outline" : "default"} onClick={checkInHackerrank} disabled={checkingIn || checkedInToday}>
            {checkingIn ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            {checkedInToday ? "Checked in today" : "I coded on HackerRank today"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default CodingStreaks;
