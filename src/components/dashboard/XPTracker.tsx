
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMonthlyXP } from "@/hooks/useMonthlyXP";

export default function XPTracker() {
  const { monthlyXP, loading, error } = useMonthlyXP();
  
  const maxXP = 1000; // Monthly target
  const percentage = Math.min((monthlyXP / maxXP) * 100, 100);
  const circumference = 2 * Math.PI * 45; // radius = 45
  const strokeDasharray = circumference;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  if (loading) {
    return (
      <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold text-gray-900">This Month's XP</CardTitle>
            <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center space-y-4 h-full">
          <div className="text-sm text-gray-600">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl h-full">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold text-gray-900">This Month's XP</CardTitle>
            <div className="w-2 h-2 bg-red-500 rounded-full"></div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center space-y-4 h-full">
          <div className="text-sm text-red-600">Error loading XP data</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold text-gray-900">This Month's XP</CardTitle>
          <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col items-center justify-center space-y-4 h-full">
        {/* Circular Progress */}
        <div className="relative flex-1 flex items-center justify-center">
          <svg className="w-24 h-24 transform -rotate-90" viewBox="0 0 100 100">
            {/* Background circle */}
            <circle 
              cx="50" 
              cy="50" 
              r="45" 
              stroke="#f3f4f6" 
              strokeWidth="8" 
              fill="none" 
            />
            {/* Progress circle */}
            <circle 
              cx="50" 
              cy="50" 
              r="45" 
              stroke="#fbbf24" 
              strokeWidth="8" 
              fill="none" 
              strokeLinecap="round" 
              strokeDasharray={strokeDasharray} 
              strokeDashoffset={strokeDashoffset} 
              className="transition-all duration-300" 
            />
          </svg>
          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-xl font-bold text-gray-900">{monthlyXP}</div>
            <div className="text-xs text-gray-600">XP</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
