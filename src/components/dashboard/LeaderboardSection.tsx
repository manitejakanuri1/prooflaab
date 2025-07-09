
import { Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { useAuth } from "@/contexts/AuthContext";
import LeaderboardList from "./LeaderboardList";

export default function LeaderboardSection() {
  const { user } = useAuth();
  const { 
    topStudents, 
    currentUserRank, 
    currentUserXP, 
    totalStudents, 
    loading, 
    error 
  } = useLeaderboard();

  const isCurrentUserInTop10 = topStudents.some(student => 
    user && student.id === user.id
  );

  const getPerformanceBadge = (rank: number | null, total: number) => {
    if (!rank || total === 0) return { text: "🎯 Getting Started", color: "from-gray-100 to-gray-200 text-gray-800" };
    
    const percentage = (rank / total) * 100;
    if (percentage <= 10) return { text: "🌟 Top 10%", color: "from-yellow-100 to-yellow-200 text-yellow-800" };
    if (percentage <= 25) return { text: "🥉 Top 25%", color: "from-orange-100 to-orange-200 text-orange-800" };
    if (percentage <= 50) return { text: "📈 Above Average", color: "from-blue-100 to-blue-200 text-blue-800" };
    return { text: "🎯 Keep Going!", color: "from-gray-100 to-gray-200 text-gray-800" };
  };

  const badge = getPerformanceBadge(currentUserRank, totalStudents);

  if (error) {
    return (
      <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl">
        <CardHeader className="text-center pb-4">
          <CardTitle className="text-lg font-semibold text-gray-800 flex items-center justify-center gap-2">
            🏆 Leaderboard
            <Trophy className="h-5 w-5 text-yellow-600" />
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center text-red-600">
          <p className="text-sm">Unable to load leaderboard</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl">
      <CardHeader className="text-center pb-4">
        <CardTitle className="text-lg font-semibold text-gray-800 flex items-center justify-center gap-2">
          🏆 Leaderboard
          <Trophy className="h-5 w-5 text-yellow-600" />
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Top 10 Students List */}
        <div className="max-h-64 overflow-y-auto">
          <LeaderboardList 
            students={topStudents} 
            currentUserId={user?.id}
            loading={loading}
          />
        </div>

        {/* Current User's Position (if not in top 10) */}
        {!loading && currentUserRank && !isCurrentUserInTop10 && (
          <div className="border-t pt-4 mt-4">
            <div className="bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200 rounded-lg p-3">
              <div className="text-center">
                <p className="text-sm font-medium text-orange-800">Your Position</p>
                <div className="flex items-center justify-center gap-4 mt-2">
                  <span className="text-lg font-bold text-orange-600">
                    #{currentUserRank}
                  </span>
                  <span className="text-sm text-gray-600">|</span>
                  <span className="text-sm font-semibold text-gray-700">
                    {currentUserXP?.toLocaleString() || 0} XP
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Performance Badge */}
        {!loading && (
          <div className="text-center">
            <div className={`inline-block px-4 py-2 rounded-full text-sm font-medium bg-gradient-to-r ${badge.color} border shadow-sm`}>
              {badge.text}
            </div>
            {totalStudents > 0 && (
              <p className="text-xs text-gray-500 mt-2">
                out of {totalStudents.toLocaleString()} students
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
