
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import { useActivityLogs } from "@/hooks/useActivityLogs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function ProgressChart() {
  const { 
    weeklyData, 
    totalWeeklyMinutes, 
    todayMinutes, 
    loading, 
    error,
    formatMinutesToHours,
    formatMinutesToDecimalHours
  } = useActivityLogs();

  if (loading) {
    return (
      <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold text-gray-900">Progress</CardTitle>
            <TrendingUp className="h-4 w-4 text-gray-600" />
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="text-center py-8">
            <div className="text-sm text-gray-600">Loading activity data...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold text-gray-900">Progress</CardTitle>
            <TrendingUp className="h-4 w-4 text-gray-600" />
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="text-center py-8">
            <div className="text-sm text-red-600">Error loading activity data</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate the maximum value for scaling the bars
  const maxMinutes = Math.max(...weeklyData.map(day => day.active_minutes), 1);

  return (
    <TooltipProvider>
      <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold text-gray-900">Progress</CardTitle>
            <TrendingUp className="h-4 w-4 text-gray-600" />
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">
              {formatMinutesToDecimalHours(totalWeeklyMinutes)} h
            </div>
            <div className="text-sm text-gray-600">
              <span className="font-medium">Work Time</span>
              <br />
              <span className="text-xs">This week</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {/* Bar Chart */}
          <div className="flex items-end justify-between h-20 mb-4">
            {weeklyData.map((dayData, index) => {
              const height = dayData.active_minutes > 0 
                ? Math.max((dayData.active_minutes / maxMinutes) * 100, 5)
                : 5;
              
              const isToday = dayData.date === new Date().toISOString().split('T')[0];
              
              return (
                <div key={dayData.date} className="flex flex-col items-center space-y-2 flex-1 group relative">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div 
                        className={`w-6 rounded-t-lg transition-all hover:opacity-80 cursor-pointer ${
                          isToday ? 'bg-yellow-400' : 'bg-gray-300'
                        }`}
                        style={{ height: `${height}%` }}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{dayData.dayName}: {formatMinutesToHours(dayData.active_minutes)}</p>
                    </TooltipContent>
                  </Tooltip>
                  <span className="text-xs text-gray-500 font-medium">{dayData.dayName}</span>
                </div>
              );
            })}
          </div>
          
          {/* Active indicator */}
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-yellow-400 rounded-full"></div>
            <span className="text-xs text-gray-600">
              {formatMinutesToHours(todayMinutes)} active today
            </span>
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
