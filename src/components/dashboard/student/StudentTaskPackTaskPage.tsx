import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Package, Clock, Zap, Upload, CheckCircle, Loader2, Calendar, Award } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import UploadProofModal from "@/components/dashboard/UploadProofModal";
import { format } from "date-fns";

interface TaskDetails {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  xp_reward: number | null;
  xp: number | null;
  status: string | null;
  required_skills: string[] | null;
}

interface PackInfo {
  packId: string;
  packName: string;
  packDifficulty: string;
}

interface ProofStatus {
  hasSubmission: boolean;
  submissionStatus: string | null;
  isCompleted: boolean;
}

const StudentTaskPackTaskPage = () => {
  const navigate = useNavigate();
  const { packId, taskId } = useParams<{ packId: string; taskId: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [task, setTask] = useState<TaskDetails | null>(null);
  const [packInfo, setPackInfo] = useState<PackInfo | null>(null);
  const [proofStatus, setProofStatus] = useState<ProofStatus>({ hasSubmission: false, submissionStatus: null, isCompleted: false });
  const [isLoading, setIsLoading] = useState(true);
  const [showUploadModal, setShowUploadModal] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      if (!packId || !taskId || !user) return;
      
      setIsLoading(true);
      try {
        // Fetch pack info
        const { data: packData } = await supabase
          .rpc('get_task_pack_with_tasks', { p_pack_id: packId });
        
        if (packData && packData.length > 0) {
          setPackInfo({
            packId: packData[0].pack_id,
            packName: packData[0].pack_name,
            packDifficulty: packData[0].pack_difficulty,
          });
        }

        // Fetch task details
        const { data: taskData, error: taskError } = await supabase
          .from('tasks')
          .select('id, title, description, due_date, xp_reward, xp, status, required_skills')
          .eq('id', taskId)
          .single();

        if (taskError) throw taskError;
        setTask(taskData);

        // Fetch student profile and check for existing submission
        const { data: profile } = await supabase
          .from('student_profiles')
          .select('id')
          .eq('user_id', user.id)
          .single();

        if (profile) {
          const { data: proofData } = await supabase
            .from('proof_uploads')
            .select('id, status')
            .eq('task_id', taskId)
            .eq('student_id', profile.id)
            .order('submitted_at', { ascending: false })
            .limit(1);

          if (proofData && proofData.length > 0) {
            setProofStatus({
              hasSubmission: true,
              submissionStatus: proofData[0].status,
              isCompleted: proofData[0].status === 'Verified',
            });
          }
        }
      } catch (error) {
        console.error('Error fetching task data:', error);
        toast({
          title: "Error",
          description: "Failed to load task details.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [packId, taskId, user, toast]);

  const handleUploadSuccess = () => {
    toast({
      title: "Task Completed!",
      description: "Your pack progress has been updated.",
    });
    // Pass state to trigger celebration modal if pack is now complete
    navigate(`/student/task-packs/${packId}`, { state: { taskCompleted: true } });
  };

  const formatDueDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), "MMMM dd, yyyy");
    } catch {
      return dateStr;
    }
  };

  const getStatusBadge = () => {
    if (proofStatus.isCompleted) {
      return (
        <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
          <CheckCircle className="h-3 w-3 mr-1" />
          Completed
        </Badge>
      );
    }
    if (proofStatus.hasSubmission) {
      return (
        <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
          <Clock className="h-3 w-3 mr-1" />
          {proofStatus.submissionStatus || "Under Review"}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
        <Clock className="h-3 w-3 mr-1" />
        Not Started
      </Badge>
    );
  };

  if (isLoading) {
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
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!task) {
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
            <Package className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-xl font-semibold mb-2">Task Not Found</h3>
            <p className="text-muted-foreground">The task you're looking for doesn't exist.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const xpReward = task.xp_reward || task.xp || 0;

  return (
    <div className="space-y-6">
      {/* Back Navigation */}
      <Button 
        variant="ghost" 
        onClick={() => navigate(`/student/task-packs/${packId}`)}
        className="gap-2"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Pack
      </Button>

      {/* Pack Context Breadcrumb */}
      {packInfo && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Package className="h-4 w-4" />
          <span>Part of Task Pack:</span>
          <Button 
            variant="link" 
            className="p-0 h-auto text-primary"
            onClick={() => navigate(`/student/task-packs/${packId}`)}
          >
            {packInfo.packName}
          </Button>
        </div>
      )}

      {/* Task Header Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <CardTitle className="text-2xl">{task.title}</CardTitle>
                {getStatusBadge()}
              </div>
              {task.required_skills && task.required_skills.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {task.required_skills.map((skill, index) => (
                    <Badge key={index} variant="secondary" className="text-xs">
                      {skill}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Task Description */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">Description</h3>
            <p className="text-foreground whitespace-pre-wrap">
              {task.description || "No description provided."}
            </p>
          </div>

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-4 pt-4 border-t">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Due Date</p>
                <p className="text-sm font-medium">{formatDueDate(task.due_date)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Award className="h-5 w-5 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">XP Reward</p>
                <p className="text-sm font-medium text-primary">{xpReward} XP</p>
              </div>
            </div>
          </div>

          {/* Action Button */}
          <div className="pt-4 border-t">
            {proofStatus.isCompleted ? (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">You have completed this task!</span>
              </div>
            ) : proofStatus.hasSubmission ? (
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  Your submission is currently <span className="font-medium">{proofStatus.submissionStatus}</span>.
                </div>
                <Button onClick={() => setShowUploadModal(true)} variant="outline">
                  <Upload className="h-4 w-4 mr-2" />
                  Resubmit Proof
                </Button>
              </div>
            ) : (
              <Button onClick={() => setShowUploadModal(true)} className="w-full sm:w-auto">
                <Upload className="h-4 w-4 mr-2" />
                Submit Proof
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Upload Proof Modal */}
      <UploadProofModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        taskId={taskId || ''}
        taskTitle={task.title}
        onSuccess={handleUploadSuccess}
      />
    </div>
  );
};

export default StudentTaskPackTaskPage;
