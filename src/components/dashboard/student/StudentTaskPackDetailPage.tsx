import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Package, Clock } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

const StudentTaskPackDetailPage = () => {
  const navigate = useNavigate();
  const { packId } = useParams<{ packId: string }>();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button 
          variant="ghost" 
          size="icon"
          onClick={() => navigate("/student/task-packs")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h2 className="text-2xl font-bold">Task Pack Details</h2>
          <p className="text-muted-foreground">Pack ID: {packId}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold flex items-center gap-2">
            <Package className="h-5 w-5" />
            Coming Soon
            <Badge variant="outline" className="ml-auto bg-primary/10 text-primary border-primary/20">
              <Clock className="h-3 w-3 mr-1" />
              In Development
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-16">
            <div className="relative inline-block mb-6">
              <Package className="h-20 w-20 text-muted-foreground mx-auto opacity-50" />
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-3">
              Pack details coming soon!
            </h3>
            <p className="text-muted-foreground max-w-md mx-auto mb-6">
              This page will display the full task list for this pack, allowing you to work through tasks sequentially and track your progress.
            </p>
            <Button variant="outline" onClick={() => navigate("/student/task-packs")}>
              Back to Task Packs
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default StudentTaskPackDetailPage;
