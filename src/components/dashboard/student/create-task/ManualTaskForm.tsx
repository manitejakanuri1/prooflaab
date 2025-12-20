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
import { Loader2 } from "lucide-react";

interface ManualTaskFormProps {
  studentId: string | undefined;
  deductCredits: (amount?: number) => Promise<boolean>;
  refreshCredits: () => Promise<void>;
}

const ManualTaskForm = ({ studentId, deductCredits, refreshCredits }: ManualTaskFormProps) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [durationWeeks, setDurationWeeks] = useState("1");
  const [category, setCategory] = useState("General");
  const [isPublic, setIsPublic] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!studentId) {
      toast({
        title: "Error",
        description: "Student profile not found",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      // Check and deduct credits
      const creditsDeducted = await deductCredits(10);
      if (!creditsDeducted) {
        setLoading(false);
        return;
      }

      // Calculate due date (current date + duration in weeks)
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + parseInt(durationWeeks) * 7);

      // Insert task
      const { error } = await supabase
        .from('tasks')
        .insert({
          title,
          description,
          student_id: studentId,
          created_by_type: 'student',
          is_ai_generated: false,
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
        description: "Task created successfully and sent for review.",
      });

      navigate('/student/dashboard?tab=tasks');
    } catch (error) {
      console.error('Error creating task:', error);
      toast({
        title: "Error",
        description: "Failed to create task. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="title">Task Title *</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., Build a Todo App with React"
          required
          maxLength={100}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Task Description *</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe what you'll learn and accomplish..."
          required
          rows={5}
          maxLength={1000}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="duration">Duration (Weeks) *</Label>
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
          <Label htmlFor="category">Category *</Label>
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
          <Label htmlFor="visibility">Show on My Portfolio</Label>
          <p className="text-sm text-muted-foreground">
            Make this task visible on your public profile
          </p>
        </div>
        <Switch
          id="visibility"
          checked={isPublic}
          onCheckedChange={setIsPublic}
        />
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>💎 Cost: 10 credits</span>
        <span>•</span>
        <span>📊 XP: Set by admin after approval (max 50 XP)</span>
      </div>

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Creating Task...
          </>
        ) : (
          "Create Task"
        )}
      </Button>
    </form>
  );
};

export default ManualTaskForm;