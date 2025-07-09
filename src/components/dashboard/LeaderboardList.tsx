
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";

interface LeaderboardEntry {
  id: string;
  full_name: string;
  total_xp: number;
  rank: number;
}

interface LeaderboardListProps {
  students: LeaderboardEntry[];
  currentUserId?: string;
  loading: boolean;
}

export default function LeaderboardList({ students, currentUserId, loading }: LeaderboardListProps) {
  const getRankEmoji = (rank: number) => {
    switch (rank) {
      case 1: return "🥇";
      case 2: return "🥈"; 
      case 3: return "🥉";
      default: return `#${rank}`;
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center space-x-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-4 w-24 mb-1" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-4 w-12" />
          </div>
        ))}
      </div>
    );
  }

  if (students.length === 0) {
    return (
      <div className="text-center py-6 text-gray-500">
        <p className="text-sm">No students found</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {students.map((student) => {
        const isCurrentUser = currentUserId === student.id;
        
        return (
          <div
            key={student.id}
            className={`flex items-center space-x-3 p-2 rounded-lg transition-colors ${
              isCurrentUser 
                ? 'bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200' 
                : 'hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center justify-center w-8 h-8 text-sm font-semibold">
              {getRankEmoji(student.rank)}
            </div>
            
            <Avatar className="h-8 w-8">
              <AvatarFallback className="text-xs bg-gradient-to-br from-orange-100 to-yellow-100 text-orange-800">
                {getInitials(student.full_name)}
              </AvatarFallback>
            </Avatar>
            
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium truncate ${
                isCurrentUser ? 'text-orange-800' : 'text-gray-900'
              }`}>
                {student.full_name}
                {isCurrentUser && <span className="ml-1 text-xs">(You)</span>}
              </p>
            </div>
            
            <div className="text-right">
              <p className={`text-sm font-semibold ${
                isCurrentUser ? 'text-orange-600' : 'text-gray-700'
              }`}>
                {student.total_xp?.toLocaleString() || 0}
              </p>
              <p className="text-xs text-gray-500">XP</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
