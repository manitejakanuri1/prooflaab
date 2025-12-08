import { useState } from "react";
import { Trophy, Medal, Flame, Sparkles, Filter, Crown, Award } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface LeaderboardEntry {
  id: string;
  rank: number;
  name: string;
  profilePhotoUrl?: string;
  college?: string;
  batch?: string;
  packsCompleted: number;
  xpFromPacks: number;
  badges: string[];
  score: number;
}

// Mock data for leaderboard
const generateMockData = (): LeaderboardEntry[] => {
  const names = [
    "Arjun Sharma", "Priya Patel", "Rahul Verma", "Ananya Singh", "Vikram Reddy",
    "Sneha Gupta", "Aditya Kumar", "Kavya Nair", "Rohan Mehta", "Ishita Joshi",
    "Karan Malhotra", "Divya Rao", "Siddharth Chopra", "Neha Agarwal", "Amit Saxena"
  ];
  
  const colleges = ["IIT Delhi", "IIT Bombay", "NIT Trichy", "BITS Pilani", "VIT Vellore"];
  const batches = ["2024", "2025", "2026"];
  const badgeOptions = ["🏆 Pack Master", "⚡ Speed Learner", "🌟 Top Performer", "🔥 Streak King", "💎 Elite Completer"];
  
  const entries = names.map((name, index) => {
    const packsCompleted = Math.floor(Math.random() * 8) + 1;
    const xpFromPacks = packsCompleted * (Math.floor(Math.random() * 200) + 100);
    const score = (packsCompleted * 10) + (xpFromPacks * 1);
    const numBadges = Math.min(packsCompleted, Math.floor(Math.random() * 3) + 1);
    const badges = badgeOptions.slice(0, numBadges);
    
    return {
      id: `student-${index}`,
      rank: 0,
      name,
      profilePhotoUrl: undefined,
      college: colleges[Math.floor(Math.random() * colleges.length)],
      batch: batches[Math.floor(Math.random() * batches.length)],
      packsCompleted,
      xpFromPacks,
      badges,
      score,
    };
  });
  
  // Sort by score and assign ranks
  entries.sort((a, b) => b.score - a.score);
  entries.forEach((entry, index) => {
    entry.rank = index + 1;
  });
  
  return entries;
};

const mockLeaderboardData = generateMockData();

const StudentPackLeaderboardPage = () => {
  const [filter, setFilter] = useState<"global" | "college" | "batch">("global");
  
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getRankStyle = (rank: number) => {
    switch (rank) {
      case 1:
        return "bg-gradient-to-r from-yellow-400 to-amber-500 text-white shadow-lg shadow-yellow-500/30";
      case 2:
        return "bg-gradient-to-r from-gray-300 to-gray-400 text-gray-800 shadow-lg shadow-gray-400/30";
      case 3:
        return "bg-gradient-to-r from-amber-600 to-orange-700 text-white shadow-lg shadow-orange-500/30";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Crown className="h-5 w-5 text-yellow-400" />;
      case 2:
        return <Medal className="h-5 w-5 text-gray-400" />;
      case 3:
        return <Medal className="h-5 w-5 text-amber-600" />;
      default:
        return null;
    }
  };

  const getRowStyle = (rank: number) => {
    switch (rank) {
      case 1:
        return "bg-gradient-to-r from-yellow-50 to-amber-50 dark:from-yellow-950/30 dark:to-amber-950/30 border-yellow-200 dark:border-yellow-800";
      case 2:
        return "bg-gradient-to-r from-gray-50 to-slate-50 dark:from-gray-950/30 dark:to-slate-950/30 border-gray-200 dark:border-gray-700";
      case 3:
        return "bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30 border-orange-200 dark:border-orange-800";
      default:
        return "bg-card hover:bg-muted/50";
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground flex items-center gap-2">
            <Trophy className="h-7 w-7 text-yellow-500" />
            Pack Leaderboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Top students ranked by Task Pack completions and XP earned
          </p>
        </div>
        
        {/* Filter */}
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global">🌍 Global Leaderboard</SelectItem>
              <SelectItem value="college">🏫 My College Only</SelectItem>
              <SelectItem value="batch">📅 My Batch Only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Top 3 Podium */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-6">
        {mockLeaderboardData.slice(0, 3).map((entry, index) => {
          const positions = [1, 0, 2]; // Display order: 2nd, 1st, 3rd
          const reorderedEntry = mockLeaderboardData[positions[index]];
          const isFirst = positions[index] === 0;
          
          return (
            <Card 
              key={reorderedEntry.id}
              className={cn(
                "text-center border-2 transition-all duration-300 hover:scale-105",
                isFirst ? "sm:-mt-4" : "",
                getRowStyle(reorderedEntry.rank)
              )}
            >
              <CardContent className="p-3 sm:p-6">
                <div className="flex justify-center mb-2 sm:mb-3">
                  <div className={cn(
                    "w-8 h-8 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-sm sm:text-xl font-bold",
                    getRankStyle(reorderedEntry.rank)
                  )}>
                    {reorderedEntry.rank === 1 ? "🥇" : reorderedEntry.rank === 2 ? "🥈" : "🥉"}
                  </div>
                </div>
                
                <Avatar className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-2 border-2 border-primary/20">
                  <AvatarImage src={reorderedEntry.profilePhotoUrl} />
                  <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/10 text-primary text-sm sm:text-lg font-semibold">
                    {getInitials(reorderedEntry.name)}
                  </AvatarFallback>
                </Avatar>
                
                <h3 className="font-semibold text-xs sm:text-sm text-foreground truncate">
                  {reorderedEntry.name}
                </h3>
                <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
                  {reorderedEntry.college}
                </p>
                
                <div className="mt-2 sm:mt-3 space-y-1">
                  <div className="flex items-center justify-center gap-1 text-xs sm:text-sm">
                    <Award className="h-3 w-3 sm:h-4 sm:w-4 text-primary" />
                    <span className="font-semibold">{reorderedEntry.packsCompleted}</span>
                    <span className="text-muted-foreground text-[10px] sm:text-xs">packs</span>
                  </div>
                  <div className="text-xs sm:text-sm font-bold text-primary">
                    {reorderedEntry.xpFromPacks.toLocaleString()} XP
                  </div>
                </div>
                
                {reorderedEntry.packsCompleted > 2 && (
                  <div className="mt-2 flex justify-center">
                    <Flame className="h-4 w-4 sm:h-5 sm:w-5 text-orange-500 animate-pulse" />
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Full Leaderboard Table */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Medal className="h-5 w-5 text-primary" />
            Full Rankings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {mockLeaderboardData.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  "flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border transition-all duration-200",
                  getRowStyle(entry.rank)
                )}
              >
                {/* Rank */}
                <div className={cn(
                  "w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-sm sm:text-base font-bold shrink-0",
                  getRankStyle(entry.rank)
                )}>
                  {entry.rank <= 3 ? getRankIcon(entry.rank) : `#${entry.rank}`}
                </div>
                
                {/* Avatar */}
                <Avatar className="h-10 w-10 sm:h-12 sm:w-12 shrink-0 border-2 border-border">
                  <AvatarImage src={entry.profilePhotoUrl} />
                  <AvatarFallback className="bg-gradient-to-br from-primary/20 to-primary/10 text-primary text-xs sm:text-sm font-semibold">
                    {getInitials(entry.name)}
                  </AvatarFallback>
                </Avatar>
                
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-sm sm:text-base text-foreground truncate">
                      {entry.name}
                    </h4>
                    {entry.packsCompleted > 2 && (
                      <Flame className="h-4 w-4 text-orange-500 shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {entry.college} • Batch {entry.batch}
                  </p>
                  
                  {/* Badges - Hidden on mobile, visible on larger screens */}
                  <div className="hidden sm:flex flex-wrap gap-1 mt-1">
                    {entry.badges.slice(0, 2).map((badge, idx) => (
                      <Badge key={idx} variant="secondary" className="text-[10px] px-1.5 py-0">
                        {badge}
                      </Badge>
                    ))}
                    {entry.badges.length > 2 && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        +{entry.badges.length - 2}
                      </Badge>
                    )}
                  </div>
                </div>
                
                {/* Stats */}
                <div className="text-right shrink-0">
                  <div className="flex items-center justify-end gap-1 text-sm sm:text-base font-semibold text-foreground">
                    <Award className="h-4 w-4 text-primary" />
                    <span>{entry.packsCompleted}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">packs</p>
                </div>
                
                <div className="text-right shrink-0">
                  <div className="flex items-center justify-end gap-1">
                    <Sparkles className="h-4 w-4 text-yellow-500" />
                    <span className="text-sm sm:text-base font-bold text-primary">
                      {entry.xpFromPacks.toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">XP</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="bg-muted/50 border-dashed">
        <CardContent className="p-4 text-center text-sm text-muted-foreground">
          <p>
            📊 Rankings are calculated using: <span className="font-medium">(Packs Completed × 10) + (XP Earned × 1)</span>
          </p>
          <p className="mt-1">
            Complete more packs to climb the leaderboard! 🚀
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default StudentPackLeaderboardPage;
