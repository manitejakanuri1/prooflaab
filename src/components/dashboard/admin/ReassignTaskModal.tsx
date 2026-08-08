import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ReassignTaskModalProps {
  task: any;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ReassignTaskModal({ task, open, onClose, onSuccess }: ReassignTaskModalProps) {
  const { toast } = useToast();
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");

  const { data: students } = useQuery({
    queryKey: ['students-for-reassign'],
    queryFn: async () => {
      // email moved to student_contact; admins can still read it there.
      const { data, error } = await supabase
        .from('student_profiles')
        .select('id, full_name, student_contact (email)')
        .order('full_name');

      if (error) throw error;
      return (data ?? []).map((s: any) => ({
        id: s.id,
        full_name: s.full_name,
        email: s.student_contact?.email ?? '',
      }));
    },
    enabled: open
  });

  useEffect(() => {
    if (task?.student_id) {
      setSelectedStudentId(task.student_id);
    }
  }, [task]);

  const reassignMutation = useMutation({
    mutationFn: async (studentId: string) => {
      const { error } = await supabase
        .from('tasks')
        .update({ 
          student_id: studentId,
          status: 'Assigned',
          updated_at: new Date().toISOString()
        })
        .eq('id', task.id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Task reassigned successfully" });
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
    if (selectedStudentId) {
      reassignMutation.mutate(selectedStudentId);
    }
  };

  if (!task) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reassign Task</DialogTitle>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="student">Select Student</Label>
            <Select value={selectedStudentId} onValueChange={setSelectedStudentId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a student..." />
              </SelectTrigger>
              <SelectContent>
                {students?.map((student) => (
                  <SelectItem key={student.id} value={student.id}>
                    {student.full_name} ({student.email})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!selectedStudentId || reassignMutation.isPending}>
              {reassignMutation.isPending ? "Reassigning..." : "Reassign Task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
