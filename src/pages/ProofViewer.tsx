import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { 
  ArrowLeft, 
  Calendar, 
  FileText, 
  CheckCircle, 
  XCircle, 
  Clock,
  ExternalLink,
  User,
  Award
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

interface ProofData {
  id: string;
  task_id: string;
  student_id: string;
  file_url: string | null;
  submission_notes: string | null;
  ai_summary: string | null;
  status: string;
  submitted_at: string;
  is_public: boolean;
  tasks?: {
    title: string;
    description: string | null;
    xp_reward: number | null;
    required_skills: string[] | null;
  };
  student_profiles?: {
    full_name: string;
    profile_photo_url: string | null;
    branch: string | null;
  };
}

const ProofViewer = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [proof, setProof] = useState<ProofData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      fetchProof();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fetchProof = async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('proof_uploads')
        .select(`
          *,
          tasks!inner (
            title,
            description,
            xp_reward,
            required_skills
          ),
          student_profiles!inner (
            full_name,
            profile_photo_url,
            branch
          )
        `)
        .eq('id', id)
        .single();

      if (error) throw error;

      setProof(data);
    } catch (error) {
      console.error('Error fetching proof:', error);
      toast.error('Failed to load proof details');
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Verified': return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'Under Review': return <Clock className="h-5 w-5 text-yellow-500" />;
      case 'Rejected': return <XCircle className="h-5 w-5 text-red-500" />;
      default: return <Clock className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Verified': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      case 'Under Review': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
      case 'Rejected': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading proof details...</p>
        </div>
      </div>
    );
  }

  if (!proof) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-6 text-center">
            <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Proof Not Found</h2>
            <p className="text-muted-foreground mb-6">
              The proof you're looking for doesn't exist or you don't have access to it.
            </p>
            <Button onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const task = Array.isArray(proof.tasks) ? proof.tasks[0] : proof.tasks;
  const student = Array.isArray(proof.student_profiles) ? proof.student_profiles[0] : proof.student_profiles;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <Button
            variant="ghost"
            onClick={() => navigate(-1)}
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div className="flex items-center gap-3">
            {getStatusIcon(proof.status)}
            <h1 className="text-2xl font-bold text-foreground">Proof Submission</h1>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="space-y-6">
          {/* Status Badge */}
          <div className="flex items-center gap-3">
            <Badge className={getStatusColor(proof.status)}>
              {proof.status}
            </Badge>
            {proof.is_public && (
              <Badge variant="outline">Public</Badge>
            )}
          </div>

          {/* Task Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Task Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold mb-2">{task?.title || 'Untitled Task'}</h3>
                {task?.description && (
                  <p className="text-muted-foreground">{task.description}</p>
                )}
              </div>

              {task?.required_skills && task.required_skills.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Required Skills:</p>
                  <div className="flex flex-wrap gap-2">
                    {task.required_skills.map((skill, index) => (
                      <Badge key={index} variant="secondary">
                        {skill}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {task?.xp_reward && (
                <div className="flex items-center gap-2 text-primary">
                  <Award className="h-5 w-5" />
                  <span className="font-semibold">{task.xp_reward} XP</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Student Info */}
          {student && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Student Information
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <img
                    src={student.profile_photo_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${proof.student_id}`}
                    alt={student.full_name}
                    className="w-12 h-12 rounded-full"
                  />
                  <div>
                    <p className="font-semibold">{student.full_name}</p>
                    {student.branch && (
                      <p className="text-sm text-muted-foreground">{student.branch}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Submission Details */}
          <Card>
            <CardHeader>
              <CardTitle>Submission Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span className="text-sm">
                  Submitted on {format(new Date(proof.submitted_at), 'MMMM dd, yyyy • hh:mm a')}
                </span>
              </div>

              <Separator />

              {proof.ai_summary && (
                <div>
                  <h4 className="font-semibold mb-2">AI Summary</h4>
                  <p className="text-muted-foreground">{proof.ai_summary}</p>
                </div>
              )}

              {proof.submission_notes && (
                <div>
                  <h4 className="font-semibold mb-2">Student Notes</h4>
                  <p className="text-muted-foreground whitespace-pre-wrap">{proof.submission_notes}</p>
                </div>
              )}

              {proof.file_url && (
                <div>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => window.open(proof.file_url!, '_blank')}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    View Submitted File
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default ProofViewer;
