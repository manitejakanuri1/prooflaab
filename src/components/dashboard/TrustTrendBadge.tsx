import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface TrustTrendBadgeProps {
  currentScore: number;
  previousScore?: number;
  source?: string;
  change?: number;
}

const TrustTrendBadge = ({ 
  currentScore, 
  previousScore, 
  source = "Manual Review",
  change 
}: TrustTrendBadgeProps) => {
  // Calculate trend
  const trend = change !== undefined 
    ? change 
    : previousScore !== undefined 
    ? currentScore - previousScore 
    : 0;

  const getTrendIcon = () => {
    if (trend > 0) return <TrendingUp className="h-3 w-3" />;
    if (trend < 0) return <TrendingDown className="h-3 w-3" />;
    return <Minus className="h-3 w-3" />;
  };

  const getTrendColor = () => {
    if (trend > 0) return "bg-green-500 text-white";
    if (trend < 0) return "bg-red-500 text-white";
    return "bg-gray-500 text-white";
  };

  const getTrendText = () => {
    if (trend > 0) return `+${trend}`;
    if (trend < 0) return `${trend}`;
    return "0";
  };

  const getScoreBadgeColor = () => {
    if (currentScore >= 80) return "bg-green-100 text-green-800 border-green-300";
    if (currentScore >= 60) return "bg-blue-100 text-blue-800 border-blue-300";
    if (currentScore >= 40) return "bg-yellow-100 text-yellow-800 border-yellow-300";
    return "bg-red-100 text-red-800 border-red-300";
  };

  return (
    <div className="flex items-center gap-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className={getScoreBadgeColor()}>
              {currentScore}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">Current Trust Score</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {trend !== 0 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge className={`${getTrendColor()} flex items-center gap-1 text-xs`}>
                {getTrendIcon()}
                {getTrendText()}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <div className="text-xs">
                <p className="font-semibold">Source: {source}</p>
                <p>Change: {getTrendText()} points</p>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
};

export default TrustTrendBadge;
