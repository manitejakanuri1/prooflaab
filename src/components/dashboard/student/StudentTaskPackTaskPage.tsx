import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileText, Clock } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

const StudentTaskPackTaskPage = () => {
  const navigate = useNavigate();
  const { packId, taskId } = useParams<{ packId: string; taskId: string }>();

  return (
    <div className="space-y-6">
      <Button 
        variant="ghost" 
        onClick={() => navigate(`/student/task-packs/${packId}`)}
        className="gap-2"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Pack
      </Button>

      <Card>
        <CardContent className="text-center py-16">
          <div className="relative inline-block mb-6">
            <FileText className="h-20 w-20 text-muted-foreground mx-auto opacity-50" />
          </div>
          <Badge variant="outline" className="mb-4 bg-primary/10 text-primary border-primary/20">
            <Clock className="h-3 w-3 mr-1" />
            Coming Soon
          </Badge>
          <h3 className="text-xl font-semibold text-foreground mb-3">
            Task Details Coming Soon
          </h3>
          <p className="text-muted-foreground max-w-md mx-auto mb-2">
            This page will display the full task instructions, submission form, and progress tracking.
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            Pack ID: {packId} • Task ID: {taskId}
          </p>
          <Button variant="outline" onClick={() => navigate(`/student/task-packs/${packId}`)}>
            Back to Pack
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default StudentTaskPackTaskPage;
