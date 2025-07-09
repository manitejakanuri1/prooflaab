
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, TrendingUp, Clock } from "lucide-react";

export default function ActivityCard() {
  const activityData = {
    totalActivities: 24,
    todayActivities: 8,
    completionRate: 75,
    averageTime: "2.5h"
  };

  return (
    <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg font-semibold text-gray-900 text-center">Activity Overview</CardTitle>
        <div className="text-3xl font-bold text-gray-900">{activityData.completionRate}%</div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Activity Stats */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Daily Progress</span>
            <span className="font-medium text-gray-900">{activityData.todayActivities}/{activityData.totalActivities}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className="bg-blue-500 h-2 rounded-full transition-all duration-300" 
              style={{ width: `${(activityData.todayActivities / activityData.totalActivities) * 100}%` }}
            ></div>
          </div>
        </div>

        {/* Activity Breakdown */}
        <div className="grid grid-cols-3 gap-3 pt-2">
          <div className="text-center p-3 bg-blue-50 rounded-xl">
            <div className="flex items-center justify-center space-x-1 mb-1">
              <Activity className="w-3 h-3 text-blue-500" />
              <span className="text-xs font-medium text-blue-700">Active</span>
            </div>
            <div className="text-lg font-bold text-blue-600">{activityData.todayActivities}</div>
          </div>
          <div className="text-center p-3 bg-green-50 rounded-xl">
            <div className="flex items-center justify-center space-x-1 mb-1">
              <TrendingUp className="w-3 h-3 text-green-500" />
              <span className="text-xs font-medium text-green-700">Rate</span>
            </div>
            <div className="text-lg font-bold text-green-600">{activityData.completionRate}%</div>
          </div>
          <div className="text-center p-3 bg-purple-50 rounded-xl">
            <div className="flex items-center justify-center space-x-1 mb-1">
              <Clock className="w-3 h-3 text-purple-500" />
              <span className="text-xs font-medium text-purple-700">Avg Time</span>
            </div>
            <div className="text-lg font-bold text-purple-600">{activityData.averageTime}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
