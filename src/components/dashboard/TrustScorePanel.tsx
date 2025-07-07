
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield } from "lucide-react";

interface TrustScorePanelProps {
  trustScore: number;
}

export default function TrustScorePanel({ trustScore }: TrustScorePanelProps) {
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

  return (
    <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold text-gray-900">Trust Score</CardTitle>
          <Shield className="h-5 w-5 text-gray-600" />
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
            <div className={`text-xl font-bold ${getScoreColor(trustScore)}`}>{trustScore}</div>
            <div className="text-xs text-gray-600">Score</div>
          </div>
        </div>
        
        <div className="text-center">
          <div className="text-sm font-medium text-gray-900">Trust Status</div>
          <div className={`text-xs font-medium ${getScoreColor(trustScore)}`}>
            {getStatus(trustScore)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
