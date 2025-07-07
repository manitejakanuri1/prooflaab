
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";

export default function ProgressChart() {
  // Mock data for weekly task completion
  const weeklyData = [
    { day: 'M', tasks: 3, height: '30%', name: 'Dashboard Setup' },
    { day: 'T', tasks: 5, height: '50%', name: 'API Integration' },
    { day: 'W', tasks: 4, height: '40%', name: 'UI Components' },
    { day: 'T', tasks: 7, height: '70%', name: 'Database Schema' },
    { day: 'F', tasks: 6, height: '60%', name: 'Testing' },
    { day: 'S', tasks: 2, height: '20%', name: 'Documentation' }
  ];

  return (
    <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold text-gray-900">Progress</CardTitle>
          <TrendingUp className="h-4 w-4 text-gray-600" />
        </div>
        <div>
          <div className="text-2xl font-bold text-gray-900">6.1 h</div>
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
          {weeklyData.map((data, index) => (
            <div key={index} className="flex flex-col items-center space-y-2 flex-1 group relative">
              <div 
                className={`w-6 rounded-t-lg transition-all hover:opacity-80 cursor-pointer relative ${
                  index === 4 ? 'bg-yellow-400' : 'bg-gray-300'
                }`}
                style={{ height: data.height }}
              />
              {/* Tooltip */}
              <div className="absolute -top-12 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                {data.name}
              </div>
              <span className="text-xs text-gray-500 font-medium">{data.day}</span>
            </div>
          ))}
        </div>
        
        {/* Active indicator */}
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 bg-yellow-400 rounded-full"></div>
          <span className="text-xs text-gray-600">5h 23m active today</span>
        </div>
      </CardContent>
    </Card>
  );
}
