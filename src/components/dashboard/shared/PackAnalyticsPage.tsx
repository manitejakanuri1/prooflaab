import React, { useState } from "react";
import { 
  Package, 
  Users, 
  Trophy, 
  TrendingUp, 
  ChevronDown, 
  ChevronUp,
  Award,
  BarChart3,
  Flame
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface PackAnalyticsPageProps {
  userRole: "admin" | "college";
}

// Mock data for analytics
const mockOverviewMetrics = {
  totalPacks: 12,
  totalAssigned: 8,
  totalCompletions: 156,
  avgCompletionRate: 72,
};

const mockPackSummary = [
  {
    id: "1",
    name: "Web Development Fundamentals",
    taskCount: 8,
    studentsAssigned: 45,
    studentsStarted: 42,
    studentsCompleted: 28,
    avgProgress: 68,
    difficulty: "Beginner",
  },
  {
    id: "2",
    name: "React Mastery",
    taskCount: 10,
    studentsAssigned: 32,
    studentsStarted: 30,
    studentsCompleted: 18,
    avgProgress: 55,
    difficulty: "Intermediate",
  },
  {
    id: "3",
    name: "Data Structures & Algorithms",
    taskCount: 12,
    studentsAssigned: 56,
    studentsStarted: 48,
    studentsCompleted: 35,
    avgProgress: 78,
    difficulty: "Advanced",
  },
  {
    id: "4",
    name: "Python for ML",
    taskCount: 6,
    studentsAssigned: 28,
    studentsStarted: 25,
    studentsCompleted: 20,
    avgProgress: 82,
    difficulty: "Intermediate",
  },
];

const mockBatchAnalytics = [
  {
    batch: "2024",
    studentsCount: 120,
    startedPercent: 85,
    inProgressPercent: 45,
    completedPercent: 40,
    avgXP: 1250,
  },
  {
    batch: "2025",
    studentsCount: 95,
    startedPercent: 78,
    inProgressPercent: 52,
    completedPercent: 26,
    avgXP: 890,
  },
  {
    batch: "2026",
    studentsCount: 88,
    startedPercent: 65,
    inProgressPercent: 48,
    completedPercent: 17,
    avgXP: 620,
  },
];

const mockStudentDetails = [
  {
    id: "s1",
    name: "Arjun Sharma",
    avatar: null,
    progress: 100,
    completedTasks: 8,
    totalTasks: 8,
    xpEarned: 850,
    badgeAwarded: "🏆 Web Dev Master",
  },
  {
    id: "s2",
    name: "Priya Patel",
    avatar: null,
    progress: 75,
    completedTasks: 6,
    totalTasks: 8,
    xpEarned: 640,
    badgeAwarded: null,
  },
  {
    id: "s3",
    name: "Rahul Kumar",
    avatar: null,
    progress: 62,
    completedTasks: 5,
    totalTasks: 8,
    xpEarned: 520,
    badgeAwarded: null,
  },
  {
    id: "s4",
    name: "Sneha Reddy",
    avatar: null,
    progress: 50,
    completedTasks: 4,
    totalTasks: 8,
    xpEarned: 420,
    badgeAwarded: null,
  },
  {
    id: "s5",
    name: "Vikram Singh",
    avatar: null,
    progress: 38,
    completedTasks: 3,
    totalTasks: 8,
    xpEarned: 310,
    badgeAwarded: null,
  },
];

const getDifficultyColor = (difficulty: string) => {
  switch (difficulty) {
    case "Beginner":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
    case "Intermediate":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    case "Advanced":
      return "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const PackAnalyticsPage = ({ userRole }: PackAnalyticsPageProps) => {
  const [filterPack, setFilterPack] = useState<string>("all");
  const [filterBatch, setFilterBatch] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("completion");
  const [expandedPacks, setExpandedPacks] = useState<string[]>([]);

  const togglePackExpand = (packId: string) => {
    setExpandedPacks((prev) =>
      prev.includes(packId) ? prev.filter((id) => id !== packId) : [...prev, packId]
    );
  };

  const sortedPacks = [...mockPackSummary].sort((a, b) => {
    if (sortBy === "completion") return b.avgProgress - a.avgProgress;
    if (sortBy === "xp") return b.studentsCompleted - a.studentsCompleted;
    return 0;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2">
          <BarChart3 className="h-7 w-7 text-primary" />
          Pack Analytics
        </h1>
        <p className="text-muted-foreground mt-1">
          Track student progress and engagement across Task Packs
        </p>
      </div>

      {/* Overview Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Package className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{mockOverviewMetrics.totalPacks}</p>
                <p className="text-xs text-muted-foreground">Total Packs</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {userRole === "college" && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                  <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{mockOverviewMetrics.totalAssigned}</p>
                  <p className="text-xs text-muted-foreground">Packs Assigned</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
                <Trophy className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{mockOverviewMetrics.totalCompletions}</p>
                <p className="text-xs text-muted-foreground">Completions</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                <TrendingUp className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{mockOverviewMetrics.avgCompletionRate}%</p>
                <p className="text-xs text-muted-foreground">Avg Completion</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Filters & Sorting</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="w-48">
              <label className="text-sm text-muted-foreground mb-1 block">Filter by Pack</label>
              <Select value={filterPack} onValueChange={setFilterPack}>
                <SelectTrigger>
                  <SelectValue placeholder="All Packs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Packs</SelectItem>
                  {mockPackSummary.map((pack) => (
                    <SelectItem key={pack.id} value={pack.id}>
                      {pack.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {userRole === "college" && (
              <div className="w-48">
                <label className="text-sm text-muted-foreground mb-1 block">Filter by Batch</label>
                <Select value={filterBatch} onValueChange={setFilterBatch}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Batches" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Batches</SelectItem>
                    <SelectItem value="2024">Batch 2024</SelectItem>
                    <SelectItem value="2025">Batch 2025</SelectItem>
                    <SelectItem value="2026">Batch 2026</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="w-48">
              <label className="text-sm text-muted-foreground mb-1 block">Sort by</label>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger>
                  <SelectValue placeholder="Completion %" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="completion">Completion %</SelectItem>
                  <SelectItem value="xp">XP Earned</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pack-wise Completion Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Pack-wise Completion Summary</CardTitle>
          <CardDescription>Click on a pack row to see student-level details</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {sortedPacks.map((pack) => {
              const isExpanded = expandedPacks.includes(pack.id);
              return (
                <Collapsible
                  key={pack.id}
                  open={isExpanded}
                  onOpenChange={() => togglePackExpand(pack.id)}
                >
                  <div className="border rounded-lg overflow-hidden">
                    <CollapsibleTrigger asChild>
                      <div className="flex items-center justify-between p-4 hover:bg-muted/50 cursor-pointer transition-colors">
                        <div className="flex items-center gap-4 flex-1">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium">{pack.name}</h4>
                              <Badge variant="secondary" className={getDifficultyColor(pack.difficulty)}>
                                {pack.difficulty}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">
                              {pack.taskCount} tasks • {pack.studentsAssigned} students assigned
                            </p>
                          </div>
                          <div className="hidden md:flex items-center gap-6 text-sm">
                            <div className="text-center">
                              <p className="font-medium text-blue-600 dark:text-blue-400">{pack.studentsStarted}</p>
                              <p className="text-xs text-muted-foreground">Started</p>
                            </div>
                            <div className="text-center">
                              <p className="font-medium text-emerald-600 dark:text-emerald-400">{pack.studentsCompleted}</p>
                              <p className="text-xs text-muted-foreground">Completed</p>
                            </div>
                            <div className="w-32">
                              <div className="flex items-center justify-between text-xs mb-1">
                                <span className="text-muted-foreground">Progress</span>
                                <span className="font-medium">{pack.avgProgress}%</span>
                              </div>
                              <Progress value={pack.avgProgress} className="h-2" />
                            </div>
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" className="ml-2">
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="border-t bg-muted/30 p-4">
                        <h5 className="text-sm font-medium mb-3">Student Progress Details</h5>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Student</TableHead>
                              <TableHead>Progress</TableHead>
                              <TableHead className="text-center">Tasks</TableHead>
                              <TableHead className="text-center">XP Earned</TableHead>
                              <TableHead>Badge</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {mockStudentDetails.map((student) => (
                              <TableRow key={student.id}>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    <Avatar className="h-8 w-8">
                                      <AvatarImage src={student.avatar || ""} />
                                      <AvatarFallback className="text-xs">
                                        {student.name.split(" ").map((n) => n[0]).join("")}
                                      </AvatarFallback>
                                    </Avatar>
                                    <span className="font-medium">{student.name}</span>
                                    {student.progress === 100 && (
                                      <Flame className="h-4 w-4 text-orange-500" />
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-2 w-32">
                                    <Progress value={student.progress} className="h-2" />
                                    <span className="text-sm font-medium">{student.progress}%</span>
                                  </div>
                                </TableCell>
                                <TableCell className="text-center">
                                  {student.completedTasks}/{student.totalTasks}
                                </TableCell>
                                <TableCell className="text-center font-medium text-primary">
                                  +{student.xpEarned} XP
                                </TableCell>
                                <TableCell>
                                  {student.badgeAwarded ? (
                                    <Badge variant="secondary" className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                      {student.badgeAwarded}
                                    </Badge>
                                  ) : (
                                    <span className="text-muted-foreground text-sm">—</span>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Batch-wise Analytics (College Only) */}
      {userRole === "college" && (
        <Card>
          <CardHeader>
            <CardTitle>Batch-wise Analytics</CardTitle>
            <CardDescription>Pack progress breakdown by student batch</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {mockBatchAnalytics.map((batch) => (
                <div key={batch.batch} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h4 className="font-medium">Batch {batch.batch}</h4>
                      <p className="text-sm text-muted-foreground">{batch.studentsCount} students</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-primary">+{batch.avgXP} XP</p>
                      <p className="text-xs text-muted-foreground">Avg XP earned</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-muted-foreground">Started</span>
                        <span className="font-medium text-blue-600 dark:text-blue-400">{batch.startedPercent}%</span>
                      </div>
                      <div className="h-3 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${batch.startedPercent}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-muted-foreground">In Progress</span>
                        <span className="font-medium text-amber-600 dark:text-amber-400">{batch.inProgressPercent}%</span>
                      </div>
                      <div className="h-3 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500 rounded-full transition-all"
                          style={{ width: `${batch.inProgressPercent}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-muted-foreground">Completed</span>
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">{batch.completedPercent}%</span>
                      </div>
                      <div className="h-3 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full transition-all"
                          style={{ width: `${batch.completedPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default PackAnalyticsPage;
