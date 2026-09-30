import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { User } from "lucide-react";
import { SCRATCH_LANGUAGES, scratchLabel, scratchLanguage } from "@/lib/scratchpad";

interface EditTaskModalProps {
  task: any;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditTaskModal({ task, open, onClose, onSuccess }: EditTaskModalProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "General",
    due_date: "",
    xp_reward: 0,
    status: "Pending"
  });
  // Written tasks only: the optional scratchpad language lives on the task's rubric config
  // (migration 48). "none" = no scratchpad. The shared generic fallback config is never changed.
  const [scratch, setScratch] = useState<{ loaded: string; value: string; fallback: boolean } | null>(null);

  useEffect(() => {
    setScratch(null);
    if (!task?.rubric_config_id) return;
    let cancelled = false;
    supabase.from("task_rubric_config").select("scratch_language, is_generic_fallback")
      .eq("id", task.rubric_config_id).maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        const v = scratchLanguage(data.scratch_language) ?? "none";
        setScratch({ loaded: v, value: v, fallback: !!data.is_generic_fallback });
      });
    return () => { cancelled = true; };
  }, [task?.rubric_config_id]);

  useEffect(() => {
    if (task) {
      setFormData({
        title: task.title || "",
        description: task.description || "",
        category: task.category || "General",
        due_date: task.due_date ? new Date(task.due_date).toISOString().split('T')[0] : "",
        xp_reward: task.xp_reward || task.xp || 0,
        status: task.status || "Pending"
      });
    }
  }, [task]);

  const updateTaskMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase
        .from('tasks')
        .update(data)
        .eq('id', task.id);
      
      if (error) throw error;
      if (scratch && !scratch.fallback && scratch.value !== scratch.loaded) {
        const { error: scratchError } = await supabase
          .from("task_rubric_config")
          .update({ scratch_language: scratch.value === "none" ? null : scratch.value })
          .eq("id", task.rubric_config_id);
        if (scratchError) throw scratchError;
      }
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Task updated successfully" });
      onSuccess();
      onClose();
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message, 
        variant: "destructive" 
      });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateTaskMutation.mutate(formData);
  };

  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Task</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="title">Task Title</Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              required
            />
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="category">Category</Label>
              <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Development">Development</SelectItem>
                  <SelectItem value="Design">Design</SelectItem>
                  <SelectItem value="Marketing">Marketing</SelectItem>
                  <SelectItem value="General">General</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="status">Status</Label>
              <Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Pending">Pending</SelectItem>
                  <SelectItem value="Assigned">Assigned</SelectItem>
                  <SelectItem value="In Progress">In Progress</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="due_date">Due Date</Label>
              <Input
                id="due_date"
                type="date"
                value={formData.due_date}
                onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                required
              />
            </div>

            <div>
              <Label htmlFor="xp_reward">XP Reward</Label>
              <Input
                id="xp_reward"
                type="number"
                value={formData.xp_reward}
                onChange={(e) => setFormData({ ...formData, xp_reward: parseInt(e.target.value) })}
                required
              />
            </div>
          </div>

          {scratch && (
            <div>
              <Label htmlFor="scratch_language">Scratch language</Label>
              <Select
                value={scratch.value}
                disabled={scratch.fallback}
                onValueChange={(value) => setScratch({ ...scratch, value })}
              >
                <SelectTrigger id="scratch_language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {SCRATCH_LANGUAGES.map((l) => (
                    <SelectItem key={l} value={l}>{scratchLabel(l)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                {scratch.fallback
                  ? "This task uses the shared default checklist, so it cannot have a scratchpad."
                  : "Written task only. Shows a try-your-code box; nothing in it is saved or marked. Applies to every copy of this task."}
              </p>
            </div>
          )}

          {/* Assigned Students Section (Read-Only) */}
          {task.task_assignments && task.task_assignments.length > 0 && (
            <div className="border rounded-lg p-4 bg-muted/20">
              <Label className="mb-3 block">Currently Assigned Students</Label>
              <div className="space-y-2">
                {task.task_assignments.map((assignment: any) => (
                  <div key={assignment.id} className="flex items-center justify-between p-2 bg-background rounded border">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{assignment.student_profiles?.full_name || 'Unknown'}</p>
                        <p className="text-xs text-muted-foreground">{assignment.student_profiles?.student_contact?.email || 'N/A'}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs">{assignment.status || 'Assigned'}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateTaskMutation.isPending}>
              {updateTaskMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
