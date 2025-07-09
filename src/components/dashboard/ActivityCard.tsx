
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, TrendingUp, Clock, Calendar } from "lucide-react";

export default function ActivityCard() {
  const activities = [
    { icon: TrendingUp, label: "XP Gained", value: "125", color: "text-green-600" },
    { icon: Clock, label: "Hours Spent", value: "8.5", color: "text-blue-600" },
    { icon: Calendar, label: "Days Active", value: "12", color: "text-purple-600" },
  ];

  return (
    <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg font-semibold text-gray-900 text-center flex items-center justify-center gap-2">
          <Activity className="h-5 w-5" />
          Activity Overview
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Activity Items */}
        <div className="space-y-3">
          {activities.map((activity, index) => (
            <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
              <div className="flex items-center space-x-3">
                <div className={`p-2 rounded-lg bg-white shadow-sm`}>
                  <activity.icon className={`h-4 w-4 ${activity.color}`} />
                </div>
                <span className="text-sm font-medium text-gray-700">{activity.label}</span>
              </div>
              <div className={`text-lg font-bold ${activity.color}`}>
                {activity.value}
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="mt-4 p-3 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl">
          <div className="text-center">
            <div className="text-sm text-gray-600 mb-1">This Week</div>
            <div className="text-xl font-bold text-gray-900">Great Progress!</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
