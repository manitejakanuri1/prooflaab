
import { Trophy, Medal, Star } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface LeaderboardSectionProps {
  rank: number;
  totalStudents: number;
}

export default function LeaderboardSection({ rank, totalStudents }: LeaderboardSectionProps) {
  const getPerformanceBadge = (rank: number, total: number) => {
    const percentage = (rank / total) * 100;
    if (percentage <= 10) return { text: "🌟 Top 10%", color: "from-yellow-100 to-yellow-200 text-yellow-800" };
    if (percentage <= 25) return { text: "🥉 Top 25%", color: "from-orange-100 to-orange-200 text-orange-800" };
    if (percentage <= 50) return { text: "📈 Above Average", color: "from-blue-100 to-blue-200 text-blue-800" };
    return { text: "🎯 Keep Going!", color: "from-gray-100 to-gray-200 text-gray-800" };
  };

  const badge = getPerformanceBadge(rank, totalStudents);

  // Mock top 3 leaderboard data
  const topThree = [
    { name: "Sarah Chen", score: 3450, avatar: null },
    { name: "Alex Kumar", score: 3210, avatar: null },
    { name: "Maria Garcia", score: 2980, avatar: null }
  ];

  return (
    <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl">
      <CardHeader className="text-center pb-4">
        <CardTitle className="text-lg font-semibold text-gray-800 flex items-center justify-center gap-2">
          🏆 Leaderboard
          <Trophy className="h-5 w-5 text-yellow-600" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Your Rank */}
        <div className="text-center space-y-2 pb-4 border-b border-gray-100">
          <div className="text-3xl font-bold bg-gradient-to-r from-yellow-600 to-orange-600 bg-clip-text text-transparent">
            #{rank}
          </div>
          <p className="text-sm text-gray-600">Your Rank</p>
          <p className="text-xs text-gray-500">out of {totalStudents.toLocaleString()} students</p>
          
          <div className={`inline-block px-4 py-2 rounded-full text-sm font-medium bg-gradient-to-r ${badge.color} border shadow-sm`}>
            {badge.text}
          </div>
        </div>
        
        {/* Top 3 */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-700 text-center">Top Performers</h4>
          {topThree.map((student, index) => (
            <div key={index} className="flex items-center space-x-3 p-2 bg-gray-50 rounded-xl">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-yellow-100 text-yellow-600 text-xs font-bold">
                {index + 1}
              </div>
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-gray-200 text-gray-600 text-xs">
                  {student.name.split(' ').map(n => n[0]).join('')}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">{student.name}</div>
                <div className="text-xs text-gray-500">{student.score} XP</div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
