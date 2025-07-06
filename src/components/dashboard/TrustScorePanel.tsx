
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Info, Shield } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TrustScorePanelProps {
  trustScore: number;
}

export default function TrustScorePanel({ trustScore }: TrustScorePanelProps) {
  const maxScore = 100;
  const percentage = (trustScore / maxScore) * 100;

  return (
    <Card className="bg-white/60 backdrop-blur-sm border-0 shadow-lg rounded-3xl">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CardTitle className="text-lg font-semibold text-gray-900">Trust Score</CardTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-gray-500 cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">
                    Based on timely submissions, task quality, and plagiarism checks. 
                    Higher scores unlock more opportunities.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Shield className="h-4 w-4 text-gray-600" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Trust Score Display */}
        <div className="text-center">
          <div className="text-3xl font-bold text-gray-900">{trustScore}/100</div>
          <div className="text-sm text-gray-600">Excellent performance</div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div 
              className={`h-3 rounded-full transition-all duration-300 ${
                trustScore >= 80 ? 'bg-green-500' : 
                trustScore >= 60 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${percentage}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-xs text-gray-500">
            <span>0</span>
            <span>100</span>
          </div>
        </div>

        {/* Trust Level Badge */}
        <div className="flex justify-center">
          <div className={`px-3 py-1 rounded-full text-xs font-medium ${
            trustScore >= 80 ? 'bg-green-100 text-green-800' : 
            trustScore >= 60 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
          }`}>
            {trustScore >= 80 ? 'Highly Trusted' : 
             trustScore >= 60 ? 'Trusted' : 'Building Trust'}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
