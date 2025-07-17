import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { CalendarIcon, Users, Wand2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Student {
  id: string;
  full_name: string;
  email: string;
  branch: string | null;
  batch: string | null;
}

const AssignTasks = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [useAI, setUseAI] = useState(false);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState<Date>();
  const { toast } = useToast();

  // Manual form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [xpReward, setXpReward] = useState("");

  // AI form state
  const [selectedBranch, setSelectedBranch] = useState("");
  const [topicArea, setTopicArea] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

  useEffect(() => {
    fetchStudents();
  }, []);

  const fetchStudents = async () => {
    try {
      const { data: studentsData, error } = await supabase
        .from('student_profiles')
        .select('id, full_name, email, branch, batch')
        .order('full_name');

      if (error) throw error;
      setStudents(studentsData || []);
    } catch (error) {
      console.error('Error fetching students:', error);
      toast({
        title: "Error",
        description: "Failed to fetch students",
        variant: "destructive",
      });
    }
  };

  const handleStudentSelect = (studentId: string, checked: boolean) => {
    if (checked) {
      setSelectedStudents([...selectedStudents, studentId]);
    } else {
      setSelectedStudents(selectedStudents.filter(id => id !== studentId));
    }
  };

  const handleSelectAll = () => {
    if (selectedStudents.length === students.length) {
      setSelectedStudents([]);
    } else {
      setSelectedStudents(students.map(s => s.id));
    }
  };

  const generateAITask = async () => {
    if (!selectedBranch) {
      toast({
        title: "Error",
        description: "Please select a branch",
        variant: "destructive",
      });
      return null;
    }

    setAiGenerating(true);
    try {
      // Mock AI generation for now - you can replace with actual AI API call
      const aiPrompt = `Generate a programming task for ${selectedBranch} students${topicArea ? ` focusing on ${topicArea}` : ''}`;
      
      // For now, return a mock task - replace with actual AI API call
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate API delay
      
      const generatedTask = {
        title: `${selectedBranch} Programming Challenge: ${topicArea || 'Algorithm Design'}`,
        description: `Create a comprehensive solution that demonstrates your understanding of ${topicArea || 'fundamental programming concepts'}. Your solution should include proper documentation, error handling, and efficient algorithms. This task is designed specifically for ${selectedBranch} students to enhance their problem-solving skills.`,
      };

      return generatedTask;
    } catch (error) {
      console.error('Error generating AI task:', error);
      toast({
        title: "Error",
        description: "Failed to generate AI task",
        variant: "destructive",
      });
      return null;
    } finally {
      setAiGenerating(false);
    }
  };

  const handleSubmit = async () => {
    if (selectedStudents.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one student",
        variant: "destructive",
      });
      return;
    }

    if (!dueDate) {
      toast({
        title: "Error",
        description: "Please select a due date",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      let taskData = { title: "", description: "" };

      if (useAI) {
        const aiTask = await generateAITask();
        if (!aiTask) {
          setLoading(false);
          return;
        }
        taskData = aiTask;
      } else {
        if (!title || !description || !xpReward) {
          toast({
            title: "Error",
            description: "Please fill in all required fields",
            variant: "destructive",
          });
          setLoading(false);
          return;
        }
        taskData = { title, description };
      }

      // Create tasks for each selected student
      const tasksToInsert = selectedStudents.map(studentId => ({
        student_id: studentId,
        title: taskData.title,
        description: taskData.description,
        due_date: dueDate.toISOString(),
        xp_reward: useAI ? 100 : parseInt(xpReward), // Default 100 XP for AI tasks
        status: 'Pending'
      }));

      const { error } = await supabase
        .from('tasks')
        .insert(tasksToInsert);

      if (error) throw error;

      toast({
        title: "Success",
        description: `Successfully assigned tasks to ${selectedStudents.length} student(s)`,
      });

      // Reset form
      setTitle("");
      setDescription("");
      setXpReward("");
      setSelectedBranch("");
      setTopicArea("");
      setSelectedStudents([]);
      setDueDate(undefined);
      setUseAI(false);

    } catch (error) {
      console.error('Error assigning tasks:', error);
      toast({
        title: "Error",
        description: "Failed to assign tasks",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const uniqueBranches = [...new Set(students.map(s => s.branch).filter(Boolean))];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground">Assign Tasks</h2>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Task Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {useAI ? <Wand2 className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
              {useAI ? "AI Task Generator" : "Manual Task Entry"}
            </CardTitle>
            <div className="flex items-center space-x-2">
              <Switch
                id="use-ai"
                checked={useAI}
                onCheckedChange={setUseAI}
              />
              <Label htmlFor="use-ai">Use AI to generate task</Label>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {useAI ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="branch">Student Branch *</Label>
                  <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select branch" />
                    </SelectTrigger>
                    <SelectContent>
                      {uniqueBranches.map(branch => (
                        <SelectItem key={branch} value={branch!}>
                          {branch}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="topic">Topic Area (Optional)</Label>
                  <Input
                    id="topic"
                    placeholder="e.g., Data Structures, Web Development"
                    value={topicArea}
                    onChange={(e) => setTopicArea(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="title">Task Title *</Label>
                  <Input
                    id="title"
                    placeholder="Enter task title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description *</Label>
                  <Textarea
                    id="description"
                    placeholder="Enter task description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="xp">XP Reward *</Label>
                  <Input
                    id="xp"
                    type="number"
                    placeholder="Enter XP reward"
                    value={xpReward}
                    onChange={(e) => setXpReward(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label>Due Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !dueDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dueDate ? format(dueDate, "PPP") : "Select due date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dueDate}
                    onSelect={setDueDate}
                    initialFocus
                    disabled={(date) => date < new Date()}
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </CardContent>
        </Card>

        {/* Student Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Select Students ({selectedStudents.length}/{students.length})
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSelectAll}
              className="w-fit"
            >
              {selectedStudents.length === students.length ? "Deselect All" : "Select All"}
            </Button>
          </CardHeader>
          <CardContent>
            <div className="max-h-96 overflow-y-auto space-y-2">
              {students.map((student) => (
                <div key={student.id} className="flex items-center space-x-2 p-2 rounded border">
                  <Checkbox
                    id={student.id}
                    checked={selectedStudents.includes(student.id)}
                    onCheckedChange={(checked) => 
                      handleStudentSelect(student.id, checked as boolean)
                    }
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {student.full_name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {student.email} • {student.branch} • {student.batch}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Submit Button */}
      <div className="flex justify-end">
        <Button 
          onClick={handleSubmit} 
          disabled={loading || aiGenerating}
          className="min-w-32"
        >
          {loading ? "Assigning..." : aiGenerating ? "Generating..." : "Assign Tasks"}
        </Button>
      </div>
    </div>
  );
};

export default AssignTasks;