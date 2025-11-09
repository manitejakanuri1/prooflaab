import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { 
  Brain, 
  Github, 
  Shield, 
  TrendingUp,
  CheckCircle,
  XCircle,
  Clock
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface DetailedVerificationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: {
    ai_score: number | null;
    conceptual_score: number | null;
    authenticity_score: number | null;
    trust_score: number | null;
    ai_summary: string | null;
    status: string;
  } | null;
  historicalData?: Array<{
    date: string;
    trust_score: number;
  }>;
}

const DetailedVerificationModal = ({ 
  open, 
  onOpenChange, 
  data,
  historicalData = []
}: DetailedVerificationModalProps) => {
  if (!data) return null;

  const getScoreColor = (score: number | null) => {
    if (!score) return 'text-muted-foreground';
    if (score >= 70) return 'text-green-600';
    if (score >= 40) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Verified':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'Rejected':
        return <XCircle className="h-5 w-5 text-red-600" />;
      default:
        return <Clock className="h-5 w-5 text-yellow-600" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Detailed Verification Analysis
            <Badge variant="outline" className="ml-2">
              {getStatusIcon(data.status)}
              <span className="ml-1">{data.status}</span>
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* AI Analysis */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="h-5 w-5 text-purple-600" />
                <h3 className="font-semibold">AI Authorship Check</h3>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Human Likelihood</span>
                  <span className={`font-bold ${getScoreColor(data.ai_score ? 100 - data.ai_score : null)}`}>
                    {data.ai_score ? `${100 - data.ai_score}%` : 'N/A'}
                  </span>
                </div>
                <Progress value={data.ai_score ? 100 - data.ai_score : 0} className="h-3" />
              </div>
            </CardContent>
          </Card>

          {/* Conceptual Score */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="h-5 w-5 text-blue-600" />
                <h3 className="font-semibold">Conceptual Understanding</h3>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Score</span>
                  <span className={`font-bold ${getScoreColor(data.conceptual_score)}`}>
                    {data.conceptual_score ?? 'N/A'} / 100
                  </span>
                </div>
                <Progress value={data.conceptual_score ?? 0} className="h-3" />
              </div>
            </CardContent>
          </Card>

          {/* GitHub Authenticity */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Github className="h-5 w-5 text-gray-600" />
                <h3 className="font-semibold">Commit Authenticity</h3>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Score</span>
                  <span className={`font-bold ${getScoreColor(data.authenticity_score)}`}>
                    {data.authenticity_score ?? 'N/A'} / 100
                  </span>
                </div>
                <Progress value={data.authenticity_score ?? 0} className="h-3" />
              </div>
            </CardContent>
          </Card>

          {/* Trust Score */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="h-5 w-5 text-primary" />
                <h3 className="font-semibold">Cognitive Integrity</h3>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Score</span>
                  <span className={`font-bold ${getScoreColor(data.trust_score)}`}>
                    {data.trust_score ?? 'N/A'} / 100
                  </span>
                </div>
                <Progress value={data.trust_score ?? 0} className="h-3" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* AI Summary */}
        {data.ai_summary && (
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold mb-2">AI Analysis Summary</h3>
              <p className="text-sm text-muted-foreground">{data.ai_summary}</p>
            </CardContent>
          </Card>
        )}

        {/* Historical Trend */}
        {historicalData.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="h-5 w-5 text-primary" />
                <h3 className="font-semibold">Trust Score Trend</h3>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={historicalData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <Line 
                    type="monotone" 
                    dataKey="trust_score" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default DetailedVerificationModal;
