import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { CalendarIcon, Plus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useStartupTasks } from "@/hooks/useStartupTasks";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Eye } from "lucide-react";

const taskSchema = z.object({
  title: z.string().min(1, "Task title is required"),
  description: z.string().min(10, "Description must be at least 10 characters"),
  duration: z.number().min(1, "Duration must be at least 1 week").max(12, "Duration cannot exceed 12 weeks"),
  isPaid: z.boolean(),
  deadline: z.date({
    message: "Deadline is required",
  }),
  requiredSkills: z.array(z.string()).min(1, "At least one skill is required"),
  xpReward: z.number().min(10, "XP reward must be at least 10").max(1000, "XP reward cannot exceed 1000"),
  category: z.string().min(1, "Category is required"),
  visibility: z.enum(["public", "restricted"]),
});

type TaskFormData = z.infer<typeof taskSchema>;

export function StartupPostTaskPage({ onNavigateToApplications }: { onNavigateToApplications?: () => void } = {}) {
  const [skills, setSkills] = useState<string[]>([]);
  const [newSkill, setNewSkill] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { tasks, loading, error, refetch } = useStartupTasks();

  const form = useForm<TaskFormData>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: "",
      description: "",
      duration: 1,
      isPaid: false,
      requiredSkills: [],
      xpReward: 50,
      category: "General",
      visibility: "public" as const,
    },
  });

  const addSkill = () => {
    if (newSkill.trim() && !skills.includes(newSkill.trim())) {
      const updatedSkills = [...skills, newSkill.trim()];
      setSkills(updatedSkills);
      form.setValue("requiredSkills", updatedSkills);
      setNewSkill("");
    }
  };

  const removeSkill = (skillToRemove: string) => {
    const updatedSkills = skills.filter(skill => skill !== skillToRemove);
    setSkills(updatedSkills);
    form.setValue("requiredSkills", updatedSkills);
  };

  const onSubmit = async (data: TaskFormData) => {
    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("You must be logged in to post a task");
        return;
      }

      const { error } = await supabase
        .from("tasks")
        .insert({
          title: data.title,
          description: data.description,
          duration_days: data.duration * 7, // Convert weeks to days
          due_date: data.deadline.toISOString(),
          is_paid: data.isPaid,
          required_skills: data.requiredSkills,
          created_by_startup_id: user.id,
          status: 'Pending',
          xp_reward: data.xpReward,
          category: data.category,
          visibility: data.visibility,
          approved_by_admin: true, // Auto-approve startup tasks
        });

      if (error) {
        toast.error("Failed to post task: " + error.message);
      } else {
        toast.success("✅ Your task has been posted successfully and is now visible to students!");
        form.reset();
        setSkills([]);
        refetch(); // Refresh the tasks list
      }
    } catch (error) {
      toast.error("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <div className="mb-6">
        <h2 className="text-3xl font-bold">Post New Task</h2>
        <p className="text-muted-foreground mt-1">Create a new internship task for students</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Form - 2 columns on large screens */}
        <div className="lg:col-span-2">
          <Card className="shadow-md">
            <CardHeader className="border-b">
              <CardTitle>Task Details</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Task Title</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Build a Weather App using React" {...field} className="w-full" />
                        </FormControl>
                        <p className="text-xs text-muted-foreground mt-1">
                          Keep it clear and skill-oriented (e.g., Build a Weather App using React)
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Task Description</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Describe the task, requirements, and expected deliverables..."
                            className="min-h-32 w-full resize-none"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="duration"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Duration (weeks)</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              placeholder="1" 
                              min="1"
                              max="12"
                              className="w-full"
                              {...field}
                              onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="xpReward"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>XP Reward</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              placeholder="50" 
                              min="10"
                              max="1000"
                              className="w-full"
                              {...field}
                              onChange={(e) => field.onChange(parseInt(e.target.value) || 50)}
                            />
                          </FormControl>
                          <p className="text-xs text-muted-foreground mt-1">
                            This is the XP students earn upon verification
                          </p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="isPaid"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 bg-muted/30">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base font-medium">Paid Position</FormLabel>
                          <div className="text-sm text-muted-foreground">
                            Is this a paid internship opportunity?
                          </div>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="deadline"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Application Deadline</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant={"outline"}
                                  className={cn(
                                    "w-full pl-3 text-left font-normal",
                                    !field.value && "text-muted-foreground"
                                  )}
                                >
                                  {field.value ? (
                                    format(field.value, "PPP")
                                  ) : (
                                    <span>Pick a date</span>
                                  )}
                                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={field.value}
                                onSelect={field.onChange}
                                disabled={(date) =>
                                  date < new Date() || date < new Date("1900-01-01")
                                }
                                initialFocus
                                className={cn("p-3 pointer-events-auto")}
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select category" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="General">General</SelectItem>
                              <SelectItem value="Frontend">Frontend</SelectItem>
                              <SelectItem value="Backend">Backend</SelectItem>
                              <SelectItem value="Design">Design</SelectItem>
                              <SelectItem value="Mobile">Mobile</SelectItem>
                              <SelectItem value="Data Science">Data Science</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="visibility"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Visibility</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select visibility" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="public">Public - All students can see this task</SelectItem>
                            <SelectItem value="restricted">Restricted - Only invited students</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="space-y-2">
                    <Label>Required Skills</Label>
                    <div className="flex gap-2 mb-2">
                      <Input
                        value={newSkill}
                        onChange={(e) => setNewSkill(e.target.value)}
                        placeholder="Add a skill (e.g., React, Node.js)"
                        className="w-full"
                        onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addSkill())}
                      />
                      <Button type="button" onClick={addSkill} variant="outline" size="icon">
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {skills.map((skill) => (
                        <Badge key={skill} variant="secondary" className="gap-1">
                          {skill}
                          <X 
                            className="h-3 w-3 cursor-pointer" 
                            onClick={() => removeSkill(skill)}
                          />
                        </Badge>
                      ))}
                    </div>
                    {form.formState.errors.requiredSkills && (
                      <p className="text-sm font-medium text-destructive">
                        {form.formState.errors.requiredSkills.message}
                      </p>
                    )}
                  </div>

                  <div className="flex justify-end gap-4 pt-4 border-t">
                    <Button type="button" variant="outline" disabled={isSubmitting}>
                      Save as Draft
                    </Button>
                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting ? "Posting..." : "Post Task"}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>

        {/* Preview Panel - 1 column on large screens */}
        <div className="lg:col-span-1">
          <Card className="shadow-md sticky top-6">
            <CardHeader className="border-b">
              <CardTitle className="text-lg">Task Preview</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase font-semibold mb-1">Title</p>
                <p className="font-medium text-sm">
                  {form.watch("title") || "Task title will appear here"}
                </p>
              </div>
              
              <div>
                <p className="text-xs text-muted-foreground uppercase font-semibold mb-1">Duration</p>
                <p className="text-sm">{form.watch("duration") || 0} weeks</p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground uppercase font-semibold mb-1">XP Reward</p>
                <p className="text-sm font-bold text-primary">{form.watch("xpReward") || 0} XP</p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground uppercase font-semibold mb-1">Category</p>
                <Badge variant="outline">{form.watch("category") || "General"}</Badge>
              </div>

              <div>
                <p className="text-xs text-muted-foreground uppercase font-semibold mb-1">Visibility</p>
                <Badge variant={form.watch("visibility") === "public" ? "default" : "secondary"}>
                  {form.watch("visibility") === "public" ? "Public" : "Restricted"}
                </Badge>
              </div>

              <div>
                <p className="text-xs text-muted-foreground uppercase font-semibold mb-1">Paid Position</p>
                <Badge variant={form.watch("isPaid") ? "default" : "secondary"}>
                  {form.watch("isPaid") ? "Yes" : "No"}
                </Badge>
              </div>

              <div>
                <p className="text-xs text-muted-foreground uppercase font-semibold mb-1">Required Skills</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {skills.length > 0 ? (
                    skills.map((skill) => (
                      <Badge key={skill} variant="secondary" className="text-xs">
                        {skill}
                      </Badge>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground">No skills added yet</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Posted Tasks Table */}
      <div className="mt-8">
        <Card className="shadow-md">
          <CardHeader className="border-b">
            <CardTitle>Your Posted Tasks</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {loading ? (
              <div className="text-center py-8">Loading tasks...</div>
            ) : error ? (
              <div className="text-center py-8 text-destructive">Error: {error}</div>
            ) : tasks.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p className="text-lg font-medium">No tasks posted yet</p>
                <p className="text-sm mt-1">Create your first task above to get started!</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task Title</TableHead>
                      <TableHead>Applicants</TableHead>
                      <TableHead>Deadline</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tasks.map((task) => (
                      <TableRow key={task.id}>
                        <TableCell className="font-medium">{task.title}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{task.applicant_count || 0}</Badge>
                        </TableCell>
                        <TableCell>{format(new Date(task.deadline), "MMM dd, yyyy")}</TableCell>
                        <TableCell>
                          <Badge variant={task.status === 'Pending' ? 'default' : 'secondary'}>
                            {task.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => onNavigateToApplications?.()}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}