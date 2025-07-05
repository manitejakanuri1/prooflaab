
import { Award, Medal } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface LeaderboardData {
  rank: number;
  badge: string;
  totalStudents: number;
}

interface LeaderboardCardProps {
  data: LeaderboardData;
}

export default function LeaderboardCard({ data }: LeaderboardCardProps) {
  const getBadgeColor = (badge: string) => {
    if (badge.includes('Top')) return 'bg-gold-100 text-gold-800 border-gold-200';
    return 'bg-blue-100 text-blue-800 border-blue-200';
  };

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <CardTitle className="text-xl font-semibold flex items-center gap-2">
          🏆 Leaderboard Position
          <Medal className="h-5 w-5 text-yellow-600" />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center space-y-4">
          <div>
            <div className="text-3xl font-bold text-blue-600">#{data.rank}</div>
            <p className="text-sm text-gray-600">out of {data.totalStudents} students</p>
          </div>
          <div className={`inline-block px-3 py-1 rounded-full text-sm font-medium border ${getBadgeColor(data.badge)}`}>
            {data.badge}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
