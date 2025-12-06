import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { 
  ArrowLeft, 
  Package, 
  Plus, 
  Trash2, 
  ChevronUp, 
  ChevronDown,
  GripVertical,
  Save,
  Send
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface PackTask {
  id: string;
  title: string;
  description: string;
  difficulty: "Beginner" | "Intermediate" | "Advanced";
  order: number;
}

interface PackData {
  id?: string;
  title: string;
  description: string;
  difficulty: "Beginner" | "Intermediate" | "Advanced";
  isPublished: boolean;
  tasks: PackTask[];
}

interface AdminTaskPackFormProps {
  mode: "create" | "edit";
  initialData?: PackData;
  packId?: string;
}

const defaultPackData: PackData = {
  title: "",
  description: "",
  difficulty: "Beginner",
  isPublished: false,
  tasks: [],
};

const getDifficultyColor = (difficulty: PackTask["difficulty"]) => {
  switch (difficulty) {
    case "Beginner":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
    case "Intermediate":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    case "Advanced":
      return "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400";
    default:
      return "bg-muted text-muted-foreground";
  }
};

const AdminTaskPackForm = ({ mode, initialData, packId }: AdminTaskPackFormProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [packData, setPackData] = useState<PackData>(initialData || defaultPackData);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);

  const generateTaskId = () => `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const handleAddTask = () => {
    const newTask: PackTask = {
      id: generateTaskId(),
      title: "",
      description: "",
      difficulty: "Beginner",
      order: packData.tasks.length + 1,
    };
    setPackData(prev => ({
      ...prev,
      tasks: [...prev.tasks, newTask],
    }));
    setEditingTaskId(newTask.id);
  };

  const handleUpdateTask = (taskId: string, updates: Partial<PackTask>) => {
    setPackData(prev => ({
      ...prev,
      tasks: prev.tasks.map(task => 
        task.id === taskId ? { ...task, ...updates } : task
      ),
    }));
  };

  const handleDeleteTask = (taskId: string) => {
    setPackData(prev => ({
      ...prev,
      tasks: prev.tasks
        .filter(task => task.id !== taskId)
        .map((task, index) => ({ ...task, order: index + 1 })),
    }));
  };

  const handleMoveTask = (taskId: string, direction: "up" | "down") => {
    const taskIndex = packData.tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;
    
    const newIndex = direction === "up" ? taskIndex - 1 : taskIndex + 1;
    if (newIndex < 0 || newIndex >= packData.tasks.length) return;

    const newTasks = [...packData.tasks];
    [newTasks[taskIndex], newTasks[newIndex]] = [newTasks[newIndex], newTasks[taskIndex]];
    
    // Update order numbers
    const reorderedTasks = newTasks.map((task, index) => ({
      ...task,
      order: index + 1,
    }));

    setPackData(prev => ({ ...prev, tasks: reorderedTasks }));
  };

  const handleSave = (publish: boolean) => {
    // Validation
    if (!packData.title.trim()) {
      toast({
        title: "Validation Error",
        description: "Pack name is required.",
        variant: "destructive",
      });
      return;
    }

    if (packData.tasks.length === 0) {
      toast({
        title: "Validation Error",
        description: "Add at least one task to the pack.",
        variant: "destructive",
      });
      return;
    }

    const hasEmptyTasks = packData.tasks.some(task => !task.title.trim());
    if (hasEmptyTasks) {
      toast({
        title: "Validation Error",
        description: "All tasks must have a title.",
        variant: "destructive",
      });
      return;
    }

    const finalData = {
      ...packData,
      isPublished: publish,
    };

    // Log to console for now (will be replaced with API call)
    console.log(`${mode === "create" ? "Creating" : "Updating"} Task Pack:`, finalData);

    toast({
      title: publish ? "Pack Published!" : "Draft Saved!",
      description: `Task pack "${packData.title}" has been ${publish ? "published" : "saved as draft"}.`,
    });

    navigate("/admin/task-packs");
  };

  return (
    <div className="space-y-6">
      {/* Header with Back Button */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/admin/task-packs")}
          className="h-9 w-9"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2">
            <Package className="h-7 w-7 text-primary" />
            {mode === "create" ? "Create Task Pack" : "Edit Task Pack"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {mode === "create" 
              ? "Create a new task pack for students" 
              : `Editing: ${packData.title || packId}`}
          </p>
        </div>
      </div>

      {/* Pack Information Section */}
      <Card>
        <CardHeader>
          <CardTitle>Pack Information</CardTitle>
          <CardDescription>
            Define the basic details of this task pack
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pack-title">Pack Name *</Label>
              <Input
                id="pack-title"
                placeholder="e.g., Full Stack Beginner Pack"
                value={packData.title}
                onChange={(e) => setPackData(prev => ({ ...prev, title: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pack-difficulty">Difficulty Level</Label>
              <Select
                value={packData.difficulty}
                onValueChange={(value: PackData["difficulty"]) => 
                  setPackData(prev => ({ ...prev, difficulty: value }))
                }
              >
                <SelectTrigger id="pack-difficulty">
                  <SelectValue placeholder="Select difficulty" />
                </SelectTrigger>
                <SelectContent className="bg-popover border shadow-md z-50">
                  <SelectItem value="Beginner">Beginner</SelectItem>
                  <SelectItem value="Intermediate">Intermediate</SelectItem>
                  <SelectItem value="Advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pack-description">Description</Label>
            <Textarea
              id="pack-description"
              placeholder="Describe what students will learn in this pack..."
              rows={3}
              value={packData.description}
              onChange={(e) => setPackData(prev => ({ ...prev, description: e.target.value }))}
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Switch
              id="pack-status"
              checked={packData.isPublished}
              onCheckedChange={(checked) => 
                setPackData(prev => ({ ...prev, isPublished: checked }))
              }
            />
            <Label htmlFor="pack-status" className="cursor-pointer">
              {packData.isPublished ? (
                <span className="text-green-600 dark:text-green-400 font-medium">Published</span>
              ) : (
                <span className="text-muted-foreground">Draft</span>
              )}
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Task Items Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Tasks in Pack</CardTitle>
            <CardDescription>
              Add and organize the tasks included in this pack ({packData.tasks.length} tasks)
            </CardDescription>
          </div>
          <Button onClick={handleAddTask} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Add Task
          </Button>
        </CardHeader>
        <CardContent>
          {packData.tasks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
              <Package className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>No tasks added yet</p>
              <p className="text-sm">Click "Add Task" to create your first task</p>
            </div>
          ) : (
            <div className="space-y-3">
              {packData.tasks.map((task, index) => (
                <div
                  key={task.id}
                  className="flex items-start gap-3 p-4 border rounded-lg bg-card hover:bg-muted/30 transition-colors"
                >
                  {/* Drag Handle & Order */}
                  <div className="flex flex-col items-center gap-1 pt-1">
                    <GripVertical className="h-4 w-4 text-muted-foreground/50" />
                    <span className="text-xs font-medium text-muted-foreground">
                      #{task.order}
                    </span>
                  </div>

                  {/* Task Content */}
                  <div className="flex-1 space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Task Title *</Label>
                        <Input
                          placeholder="Task title"
                          value={task.title}
                          onChange={(e) => handleUpdateTask(task.id, { title: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Difficulty</Label>
                        <Select
                          value={task.difficulty}
                          onValueChange={(value: PackTask["difficulty"]) => 
                            handleUpdateTask(task.id, { difficulty: value })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-popover border shadow-md z-50">
                            <SelectItem value="Beginner">Beginner</SelectItem>
                            <SelectItem value="Intermediate">Intermediate</SelectItem>
                            <SelectItem value="Advanced">Advanced</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Short Description</Label>
                      <Textarea
                        placeholder="Brief description of this task..."
                        rows={2}
                        value={task.description}
                        onChange={(e) => handleUpdateTask(task.id, { description: e.target.value })}
                      />
                    </div>
                    <Badge variant="secondary" className={getDifficultyColor(task.difficulty)}>
                      {task.difficulty}
                    </Badge>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleMoveTask(task.id, "up")}
                      disabled={index === 0}
                      title="Move up"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleMoveTask(task.id, "down")}
                      disabled={index === packData.tasks.length - 1}
                      title="Move down"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => handleDeleteTask(task.id)}
                      title="Delete task"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-3 justify-end pt-4 border-t">
        <Button
          variant="outline"
          onClick={() => navigate("/admin/task-packs")}
        >
          Cancel
        </Button>
        <Button
          variant="secondary"
          onClick={() => handleSave(false)}
          className="gap-2"
        >
          <Save className="h-4 w-4" />
          Save as Draft
        </Button>
        <Button
          onClick={() => handleSave(true)}
          className="gap-2"
        >
          <Send className="h-4 w-4" />
          Publish Pack
        </Button>
      </div>
    </div>
  );
};

export default AdminTaskPackForm;
