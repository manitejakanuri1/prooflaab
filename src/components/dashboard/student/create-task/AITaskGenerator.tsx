import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useStudentCredits } from "@/hooks/useStudentCredits";
import { Loader2, Sparkles } from "lucide-react";

interface AITaskGeneratorProps {
  studentId: string | undefined;
}

const AITaskGenerator = ({ studentId }: AITaskGeneratorProps) => {
  const [prompt, setPrompt] = useState("");
  const [generatedTitle, setGeneratedTitle] = useState("");
  const [generatedDescription, setGeneratedDescription] = useState("");
  const [durationWeeks, setDurationWeeks] = useState("1");
  const [category, setCategory] = useState("General");
  const [isPublic, setIsPublic] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { deductCredits } = useStudentCredits(studentId);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast({
        title: "Input Required",
        description: "Please describe what you want to learn",
        variant: "destructive",
      });
      return;
    }

    setGenerating(true);

    try {
      const { data, error } = await supabase.functions.invoke('generate-task-ai', {
        body: { prompt }
      });

      if (error) throw error;

      setGeneratedTitle(data.title);
      setGeneratedDescription(data.description);

      toast({
        title: "Task Generated!",
        description: "Review and edit the generated task below",
      });
    } catch (error) {
      console.error('Error generating task:', error);
      toast({
        title: "Generation Failed",
        description: "Failed to generate task. Please try again.",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleCreate = async () => {
    if (!studentId) {
      toast({
        title: "Error",
        description: "Student profile not found",
        variant: "destructive",
      });
      return;
    }

    if (!generatedTitle || !generatedDescription) {
      toast({
        title: "Generate First",
        description: "Please generate a task before creating",
        variant: "destructive",
      });
      return;
    }

    setCreating(true);

    try {
      // Check and deduct credits
      const creditsDeducted = await deductCredits(10);
      if (!creditsDeducted) {
        setCreating(false);
        return;
      }

      // Calculate due date
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + parseInt(durationWeeks) * 7);

      // Insert task
      const { error } = await supabase
        .from('tasks')
        .insert({
          title: generatedTitle,
          description: generatedDescription,
          student_id: studentId,
          created_by_type: 'student',
          is_ai_generated: true,
          source: 'ai',
          visibility: isPublic ? 'public' : 'private',
          status: 'Pending Review',
          xp_reward: 0,
          suggested_xp: 50,
          category,
          due_date: dueDate.toISOString(),
          duration_days: parseInt(durationWeeks) * 7,
        });

      if (error) throw error;

      toast({
        title: "Success!",
        description: "AI-generated task created successfully and sent for review.",
      });

      navigate('/student-dashboard?tab=tasks');
    } catch (error) {
      console.error('Error creating task:', error);
      toast({
        title: "Error",
        description: "Failed to create task. Please try again.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="prompt">What do you want to learn today?</Label>
          <Input
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g., I want to learn how to build REST APIs with Node.js"
            disabled={generating}
          />
        </div>

        <Button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="w-full"
        >
          {generating ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating Task...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              Generate Task
            </>
          )}
        </Button>
      </div>

      {generatedTitle && generatedDescription && (
        <>
          <div className="border-t pt-6 space-y-4">
            <h3 className="font-semibold text-lg">Generated Task (You can edit)</h3>

            <div className="space-y-2">
              <Label htmlFor="generated-title">Task Title</Label>
              <Input
                id="generated-title"
                value={generatedTitle}
                onChange={(e) => setGeneratedTitle(e.target.value)}
                maxLength={100}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="generated-description">Task Description</Label>
              <Textarea
                id="generated-description"
                value={generatedDescription}
                onChange={(e) => setGeneratedDescription(e.target.value)}
                rows={5}
                maxLength={1000}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ai-duration">Duration (Weeks)</Label>
                <Select value={durationWeeks} onValueChange={setDurationWeeks}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 Week</SelectItem>
                    <SelectItem value="2">2 Weeks</SelectItem>
                    <SelectItem value="3">3 Weeks</SelectItem>
                    <SelectItem value="4">4 Weeks</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-category">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="General">General</SelectItem>
                    <SelectItem value="Programming">Programming</SelectItem>
                    <SelectItem value="Design">Design</SelectItem>
                    <SelectItem value="Data Science">Data Science</SelectItem>
                    <SelectItem value="Marketing">Marketing</SelectItem>
                    <SelectItem value="Business">Business</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg border bg-muted/50">
              <div className="space-y-0.5">
                <Label htmlFor="ai-visibility">Show on My Portfolio</Label>
                <p className="text-sm text-muted-foreground">
                  Make this task visible on your public profile
                </p>
              </div>
              <Switch
                id="ai-visibility"
                checked={isPublic}
                onCheckedChange={setIsPublic}
              />
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>💎 Cost: 10 credits</span>
              <span>•</span>
              <span>📊 XP: Set by admin after approval (max 50 XP)</span>
            </div>

            <Button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="w-full"
            >
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating Task...
                </>
              ) : (
                "Create Task"
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

export default AITaskGenerator;