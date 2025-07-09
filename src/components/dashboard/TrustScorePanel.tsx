
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield } from "lucide-react";
import { useTrustScore } from "@/hooks/useTrustScore";

export default function TrustScorePanel() {
  const { trustScore, loading, error } = useTrustScore();

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreRing = (score: number) => {
    if (score >= 80) return "stroke-green-500";
    if (score >= 60) return "stroke-yellow-500";
    return "stroke-red-500";
  };

  const getStatus = (score: number) => {
    if (score >= 80) return "Highly Trusted";
    if (score >= 60) return "Trusted";
    return "Building Trust";
  };

  const circumference = 2 * Math.PI * 45;
  const strokeDasharray = circumference;
  const strokeDashoffset = circumference - (trustScore / 100) * circumference;

  if (loading) {
    return (
      <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl h-full flex flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold text-gray-900">Trust Score</CardTitle>
            <Shield className="h-5 w-5 text-gray-600" />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center space-y-6 flex-1">
          <div className="animate-pulse">
            <div className="w-28 h-28 bg-gray-200 rounded-full"></div>
          </div>
          <div className="text-center space-y-2">
            <div className="w-20 h-4 bg-gray-200 rounded animate-pulse"></div>
            <div className="w-32 h-3 bg-gray-200 rounded animate-pulse"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl h-full flex flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold text-gray-900">Trust Score</CardTitle>
            <Shield className="h-5 w-5 text-gray-600" />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center space-y-6 flex-1">
          <div className="text-center text-red-600">
            <p className="text-sm">Unable to load trust score</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold text-gray-900">Trust Score</CardTitle>
          <Shield className="h-5 w-5 text-gray-600" />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col items-center justify-center space-y-6 flex-1">
        {/* Circular Progress */}
        <div className="relative">
          <svg className="w-28 h-28 transform -rotate-90" viewBox="0 0 100 100">
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
              stroke="currentColor"
              strokeWidth="8"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={strokeDasharray}
              strokeDashoffset={strokeDashoffset}
              className={`transition-all duration-300 ${getScoreRing(trustScore)}`}
            />
          </svg>
          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className={`text-2xl font-bold ${getScoreColor(trustScore)}`}>{trustScore}</div>
            <div className="text-sm text-gray-600">Score</div>
          </div>
        </div>
        
        <div className="text-center space-y-2">
          <div className={`text-sm font-medium ${getScoreColor(trustScore)}`}>
            {getStatus(trustScore)}
          </div>
          <div className="text-xs text-gray-500">
            Based on task submissions and quality
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
