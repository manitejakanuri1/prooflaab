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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { CalendarIcon, Users, Wand2, FileText, Filter, Eye, Globe, Lock, Save, Copy, CheckCircle, Building2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface Student {
  id: string;
  full_name: string;
  email: string;
  branch: string | null;
  batch: string | null;
  year_of_study: string | null;
  college_id: string | null;
  college_name?: string;
  trust_score: number;
  total_xp: number;
}

interface TaskTemplate {
  id: string;
  title: string;
  description: string;
  branch: string;
  skills: string[];
  difficulty: string;
  xp_reward: number;
}

interface College {
  id: string;
  name: string;
  email: string;
}

const AdminAssignTasks = () => {
  // Core state
  const [students, setStudents] = useState<Student[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
  const [colleges, setColleges] = useState<College[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("manual");
  const { toast } = useToast();

  // Task form state
  const [taskForm, setTaskForm] = useState({
    title: "",
    description: "",
    xpReward: "",
    dueDate: undefined as Date | undefined,
    category: "Coding",
    visibility: "Public",
    autoApproved: true,
  });

  // AI generation state
  const [aiForm, setAiForm] = useState({
    branch: "",
    topicArea: "",
    generating: false,
  });

  // Template state
  const [selectedTemplate, setSelectedTemplate] = useState("");

  // Audience filters
  const [audienceType, setAudienceType] = useState("all"); // all, college, custom
  const [selectedColleges, setSelectedColleges] = useState<string[]>([]);
  const [branchFilters, setBranchFilters] = useState<string[]>([]);
  const [yearFilters, setYearFilters] = useState<string[]>([]);
  const [trustScoreMin, setTrustScoreMin] = useState("");
  const [trustScoreMax, setTrustScoreMax] = useState("");
  const [xpMin, setXpMin] = useState("");
  const [xpMax, setXpMax] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Confirmation modal
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    fetchColleges();
    fetchTemplates();
  }, []);

  useEffect(() => {
    fetchStudents();
  }, [audienceType, selectedColleges]);

  useEffect(() => {
    filterStudents();
  }, [students, branchFilters, yearFilters, trustScoreMin, trustScoreMax, xpMin, xpMax]);

  const fetchColleges = async () => {
    try {
      const { data, error } = await supabase
        .from('colleges')
        .select('id, name, email')
        .order('name');

      if (error) throw error;
      setColleges(data || []);
    } catch (error) {
      console.error('Error fetching colleges:', error);
      toast({
        title: "Error",
        description: "Failed to fetch colleges",
        variant: "destructive",
      });
    }
  };

  const fetchStudents = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('student_profiles')
        .select(`
          id, full_name, email, branch, batch, year_of_study,
          trust_score, total_xp, college_id,
          colleges!student_profiles_college_id_fkey (name)
        `)
        .eq('status', 'active');

      // Filter by college if specific colleges are selected
      if (audienceType === "college" && selectedColleges.length > 0) {
        query = query.in('college_id', selectedColleges);
      }

      const { data, error } = await query.order('full_name');

      if (error) throw error;
      
      const studentsWithCollegeName = (data || []).map(s => ({
        ...s,
        college_name: (s as any).colleges?.name || "Direct Registration"
      }));
      
      setStudents(studentsWithCollegeName);
    } catch (error) {
      console.error('Error fetching students:', error);
      toast({
        title: "Error",
        description: "Failed to fetch students",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchTemplates = async () => {
    // Mock templates - implement when task_templates table is ready
    setTemplates([
      {
        id: '1',
        title: 'Basic Programming Challenge',
        description: 'A fundamental programming task focusing on core concepts and problem-solving skills.',
        branch: 'CSE',
        skills: ['Programming', 'Problem Solving'],
        difficulty: 'Beginner',
        xp_reward: 50
      },
      {
        id: '2',
        title: 'Web Development Project',
        description: 'Build a responsive web application using modern frameworks.',
        branch: 'IT',
        skills: ['HTML', 'CSS', 'JavaScript'],
        difficulty: 'Intermediate',
        xp_reward: 100
      }
    ]);
  };

  const filterStudents = () => {
    let filtered = [...students];

    if (branchFilters.length > 0) {
      filtered = filtered.filter(s => s.branch && branchFilters.includes(s.branch));
    }
    if (yearFilters.length > 0) {
      filtered = filtered.filter(s => s.year_of_study && yearFilters.includes(s.year_of_study));
    }
    if (trustScoreMin) {
      filtered = filtered.filter(s => s.trust_score >= parseInt(trustScoreMin));
    }
    if (trustScoreMax) {
      filtered = filtered.filter(s => s.trust_score <= parseInt(trustScoreMax));
    }
    if (xpMin) {
      filtered = filtered.filter(s => s.total_xp >= parseInt(xpMin));
    }
    if (xpMax) {
      filtered = filtered.filter(s => s.total_xp <= parseInt(xpMax));
    }

    setFilteredStudents(filtered);
    setSelectedStudents(prev => prev.filter(id => filtered.some(s => s.id === id)));
  };

  const handleStudentSelect = (studentId: string, checked: boolean) => {
    if (checked) {
      setSelectedStudents([...selectedStudents, studentId]);
    } else {
      setSelectedStudents(selectedStudents.filter(id => id !== studentId));
    }
  };

  const handleSelectAll = () => {
    if (selectedStudents.length === filteredStudents.length) {
      setSelectedStudents([]);
    } else {
      setSelectedStudents(filteredStudents.map(s => s.id));
    }
  };

  const handleBranchToggle = (branch: string) => {
    setBranchFilters(prev =>
      prev.includes(branch) ? prev.filter(b => b !== branch) : [...prev, branch]
    );
  };

  const handleYearToggle = (year: string) => {
    setYearFilters(prev =>
      prev.includes(year) ? prev.filter(y => y !== year) : [...prev, year]
    );
  };

  const generateAITask = async () => {
    if (!aiForm.branch || !aiForm.topicArea.trim()) {
      toast({
        title: "Error",
        description: "Please select branch and enter topic keywords",
        variant: "destructive",
      });
      return;
    }

    setAiForm(prev => ({ ...prev, generating: true }));
    try {
      const { data, error } = await supabase.functions.invoke('assign_tasks', {
        body: {
          mode: 'ai',
          keywords: aiForm.topicArea,
          branch: aiForm.branch,
        }
      });

      if (error) throw error;

      if (data?.tasks?.[0]) {
        const task = data.tasks[0];
        setTaskForm(prev => ({
          ...prev,
          title: task.title,
          description: task.description,
          xpReward: task.xp_reward?.toString() || '50',
        }));

        toast({
          title: "Success",
          description: "AI task generated successfully!",
        });
      }
    } catch (error) {
      console.error('AI generation error:', error);
      toast({
        title: "Error",
        description: "Failed to generate AI task",
        variant: "destructive",
      });
    } finally {
      setAiForm(prev => ({ ...prev, generating: false }));
    }
  };

  const handleTemplateSelect = (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (template) {
      setSelectedTemplate(templateId);
      setTaskForm(prev => ({
        ...prev,
        title: template.title,
        description: template.description,
        xpReward: template.xp_reward?.toString() || '50',
      }));
    }
  };

  const handlePreview = () => {
    if (!taskForm.title.trim() || !taskForm.description.trim() || !taskForm.xpReward || !taskForm.dueDate) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    if (audienceType !== "all" && selectedStudents.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one student",
        variant: "destructive",
      });
      return;
    }

    setShowPreview(true);
  };

  const handleConfirmAssign = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      const tasksToCreate = selectedStudents.map(studentId => ({
        title: taskForm.title,
        description: taskForm.description,
        xp_reward: parseInt(taskForm.xpReward),
        xp: parseInt(taskForm.xpReward),
        due_date: taskForm.dueDate?.toISOString() || new Date().toISOString(),
        category: taskForm.category,
        visibility: taskForm.visibility.toLowerCase(),
        student_id: studentId,
        status: 'Assigned',
        created_by_admin_id: user.id,
        source: activeTab === 'ai' ? 'ai' : activeTab === 'template' ? 'template' : 'manual',
        approved_by_admin: taskForm.autoApproved,
      }));

      const { error } = await supabase
        .from('tasks')
        .insert(tasksToCreate);

      if (error) throw error;

      const totalColleges = [...new Set(
        students.filter(s => selectedStudents.includes(s.id)).map(s => s.college_id)
      )].length;

      toast({
        title: "Success",
        description: `✅ Task assigned to ${selectedStudents.length} students across ${totalColleges} colleges.`,
      });

      // Reset form
      setTaskForm({
        title: "",
        description: "",
        xpReward: "",
        dueDate: undefined,
        category: "Coding",
        visibility: "Public",
        autoApproved: true,
      });
      setSelectedStudents([]);
      setShowPreview(false);
      setActiveTab("manual");
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

  const handleSaveTemplate = async () => {
    if (!taskForm.title.trim() || !taskForm.description.trim()) {
      toast({
        title: "Error",
        description: "Title and description are required",
        variant: "destructive",
      });
      return;
    }

    try {
      // Save to templates array (implement DB save when task_templates table is ready)
      const newTemplate: TaskTemplate = {
        id: Date.now().toString(),
        title: taskForm.title,
        description: taskForm.description,
        xp_reward: parseInt(taskForm.xpReward) || 50,
        branch: "ALL",
        skills: [],
        difficulty: "Intermediate"
      };

      setTemplates(prev => [...prev, newTemplate]);

      toast({
        title: "Success",
        description: "Task saved as template",
      });
    } catch (error) {
      console.error('Error saving template:', error);
      toast({
        title: "Error",
        description: "Failed to save template",
        variant: "destructive",
      });
    }
  };

  const branches = ["CSE", "ECE", "ME", "CE", "EEE", "IT"];
  const years = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
  const categories = ["Coding", "Research", "Soft Skills", "Design", "Management", "General"];

  const getCollegeCount = () => {
    return [...new Set(students.filter(s => selectedStudents.includes(s.id)).map(s => s.college_id))].length;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Assign Tasks (Admin)</h1>
        <p className="text-muted-foreground">Create and assign tasks across colleges</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Task Configuration Panel */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Task Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="manual">Manual</TabsTrigger>
                  <TabsTrigger value="ai">AI</TabsTrigger>
                  <TabsTrigger value="template">Template</TabsTrigger>
                  <TabsTrigger value="personalized">Personalized</TabsTrigger>
                </TabsList>

                <TabsContent value="manual" className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label>Title *</Label>
                    <Input
                      value={taskForm.title}
                      onChange={(e) => setTaskForm(prev => ({ ...prev, title: e.target.value }))}
                      placeholder="Enter task title"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Description *</Label>
                    <Textarea
                      value={taskForm.description}
                      onChange={(e) => setTaskForm(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Enter task description"
                      rows={5}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>XP Reward *</Label>
                      <Input
                        type="number"
                        value={taskForm.xpReward}
                        onChange={(e) => setTaskForm(prev => ({ ...prev, xpReward: e.target.value }))}
                        placeholder="50"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Due Date *</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !taskForm.dueDate && "text-muted-foreground")}>
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {taskForm.dueDate ? format(taskForm.dueDate, "PPP") : "Pick a date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={taskForm.dueDate}
                            onSelect={(date) => setTaskForm(prev => ({ ...prev, dueDate: date }))}
                            initialFocus
                            className="pointer-events-auto"
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Select value={taskForm.category} onValueChange={(v) => setTaskForm(prev => ({ ...prev, category: v }))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map(cat => (
                            <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Visibility</Label>
                      <Select value={taskForm.visibility} onValueChange={(v) => setTaskForm(prev => ({ ...prev, visibility: v }))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Public">Public</SelectItem>
                          <SelectItem value="Restricted">Restricted</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      checked={taskForm.autoApproved}
                      onCheckedChange={(checked) => setTaskForm(prev => ({ ...prev, autoApproved: checked }))}
                    />
                    <Label>Mark as Auto-Approved</Label>
                  </div>
                </TabsContent>

                <TabsContent value="ai" className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label>Branch *</Label>
                    <Select value={aiForm.branch} onValueChange={(v) => setAiForm(prev => ({ ...prev, branch: v }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select branch" />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.map(branch => (
                          <SelectItem key={branch} value={branch}>{branch}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Topic Area *</Label>
                    <Input
                      value={aiForm.topicArea}
                      onChange={(e) => setAiForm(prev => ({ ...prev, topicArea: e.target.value }))}
                      placeholder="e.g., Machine Learning, Data Structures"
                    />
                  </div>

                  <Button onClick={generateAITask} disabled={aiForm.generating} className="w-full">
                    <Wand2 className="mr-2 h-4 w-4" />
                    {aiForm.generating ? "Generating..." : "Generate Task"}
                  </Button>

                  {taskForm.title && (
                    <div className="space-y-4 pt-4 border-t">
                      <div className="space-y-2">
                        <Label>Generated Title</Label>
                        <Input value={taskForm.title} onChange={(e) => setTaskForm(prev => ({ ...prev, title: e.target.value }))} />
                      </div>
                      <div className="space-y-2">
                        <Label>Generated Description</Label>
                        <Textarea value={taskForm.description} onChange={(e) => setTaskForm(prev => ({ ...prev, description: e.target.value }))} rows={5} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>XP Reward</Label>
                          <Input type="number" value={taskForm.xpReward} onChange={(e) => setTaskForm(prev => ({ ...prev, xpReward: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>Due Date</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !taskForm.dueDate && "text-muted-foreground")}>
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {taskForm.dueDate ? format(taskForm.dueDate, "PPP") : "Pick a date"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={taskForm.dueDate}
                                onSelect={(date) => setTaskForm(prev => ({ ...prev, dueDate: date }))}
                                initialFocus
                                className="pointer-events-auto"
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="template" className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label>Select Template *</Label>
                    <Select value={selectedTemplate} onValueChange={handleTemplateSelect}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a template" />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map(template => (
                          <SelectItem key={template.id} value={template.id}>
                            {template.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedTemplate && (
                    <div className="space-y-4 pt-4 border-t">
                      <div className="space-y-2">
                        <Label>Title</Label>
                        <Input value={taskForm.title} onChange={(e) => setTaskForm(prev => ({ ...prev, title: e.target.value }))} />
                      </div>
                      <div className="space-y-2">
                        <Label>Description</Label>
                        <Textarea value={taskForm.description} onChange={(e) => setTaskForm(prev => ({ ...prev, description: e.target.value }))} rows={5} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>XP Reward</Label>
                          <Input type="number" value={taskForm.xpReward} onChange={(e) => setTaskForm(prev => ({ ...prev, xpReward: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>Due Date</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !taskForm.dueDate && "text-muted-foreground")}>
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {taskForm.dueDate ? format(taskForm.dueDate, "PPP") : "Pick a date"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={taskForm.dueDate}
                                onSelect={(date) => setTaskForm(prev => ({ ...prev, dueDate: date }))}
                                initialFocus
                                className="pointer-events-auto"
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="personalized" className="space-y-4 mt-4">
                  <div className="text-center py-8 text-muted-foreground">
                    <Wand2 className="h-12 w-12 mx-auto mb-4" />
                    <p>Personalized AI tasks coming soon!</p>
                    <p className="text-sm">Generate unique tasks for each student based on their profile</p>
                  </div>
                </TabsContent>
              </Tabs>

              <div className="flex gap-2 mt-6">
                <Button onClick={handlePreview} className="flex-1 bg-orange-600 hover:bg-orange-700">
                  <Eye className="mr-2 h-4 w-4" />
                  Preview & Confirm
                </Button>
                <Button onClick={handleSaveTemplate} variant="outline">
                  <Save className="mr-2 h-4 w-4" />
                  Save Template
                </Button>
                <Button variant="outline">
                  <Copy className="mr-2 h-4 w-4" />
                  Duplicate
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Audience Selection Panel */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Target Audience</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Audience Type</Label>
                <Select value={audienceType} onValueChange={setAudienceType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Students</SelectItem>
                    <SelectItem value="college">By College</SelectItem>
                    <SelectItem value="custom">Custom Filters</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {audienceType === "college" && (
                <div className="space-y-2">
                  <Label>Select Colleges</Label>
                  <div className="max-h-48 overflow-y-auto space-y-2 border rounded-md p-3">
                    {colleges.map(college => (
                      <div key={college.id} className="flex items-center space-x-2">
                        <Checkbox
                          checked={selectedColleges.includes(college.id)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedColleges([...selectedColleges, college.id]);
                            } else {
                              setSelectedColleges(selectedColleges.filter(id => id !== college.id));
                            }
                          }}
                        />
                        <Label className="text-sm font-normal">{college.name}</Label>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {audienceType === "custom" && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="w-full">
                    <Filter className="mr-2 h-4 w-4" />
                    {showFilters ? "Hide Filters" : "Show Filters"}
                  </Button>

                  {showFilters && (
                    <div className="space-y-4 p-4 border rounded-md">
                      <div className="space-y-2">
                        <Label>Branch</Label>
                        <div className="flex flex-wrap gap-2">
                          {branches.map(branch => (
                            <Badge
                              key={branch}
                              variant={branchFilters.includes(branch) ? "default" : "outline"}
                              className="cursor-pointer"
                              onClick={() => handleBranchToggle(branch)}
                            >
                              {branch}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Year of Study</Label>
                        <div className="flex flex-wrap gap-2">
                          {years.map(year => (
                            <Badge
                              key={year}
                              variant={yearFilters.includes(year) ? "default" : "outline"}
                              className="cursor-pointer"
                              onClick={() => handleYearToggle(year)}
                            >
                              {year}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Trust Score Range</Label>
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            type="number"
                            placeholder="Min"
                            value={trustScoreMin}
                            onChange={(e) => setTrustScoreMin(e.target.value)}
                          />
                          <Input
                            type="number"
                            placeholder="Max"
                            value={trustScoreMax}
                            onChange={(e) => setTrustScoreMax(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>XP Range</Label>
                        <div className="grid grid-cols-2 gap-2">
                          <Input
                            type="number"
                            placeholder="Min"
                            value={xpMin}
                            onChange={(e) => setXpMin(e.target.value)}
                          />
                          <Input
                            type="number"
                            placeholder="Max"
                            value={xpMax}
                            onChange={(e) => setXpMax(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {audienceType !== "all" && (
                <>
                  <div className="flex items-center justify-between pt-4 border-t">
                    <Label>Students ({filteredStudents.length})</Label>
                    <Button variant="outline" size="sm" onClick={handleSelectAll}>
                      {selectedStudents.length === filteredStudents.length ? "Deselect All" : "Select All"}
                    </Button>
                  </div>

                  <div className="max-h-96 overflow-y-auto space-y-2 border rounded-md p-3">
                    {loading ? (
                      <p className="text-sm text-muted-foreground text-center">Loading students...</p>
                    ) : filteredStudents.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center">No students found</p>
                    ) : (
                      filteredStudents.map(student => (
                        <div key={student.id} className="flex items-start space-x-2 p-2 hover:bg-muted rounded">
                          <Checkbox
                            checked={selectedStudents.includes(student.id)}
                            onCheckedChange={(checked) => handleStudentSelect(student.id, !!checked)}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{student.full_name}</p>
                            <p className="text-xs text-muted-foreground">{student.branch} • {student.year_of_study}</p>
                            {student.college_name && (
                              <p className="text-xs text-muted-foreground">{student.college_name}</p>
                            )}
                            <div className="flex gap-2 mt-1">
                              <Badge variant="secondary" className="text-xs">XP: {student.total_xp}</Badge>
                              <Badge variant="secondary" className="text-xs">Trust: {student.trust_score}</Badge>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}

              <div className="pt-4 border-t">
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary">{selectedStudents.length}</p>
                  <p className="text-sm text-muted-foreground">Students Selected</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Preview & Confirmation Modal */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Task Preview & Confirmation</DialogTitle>
            <DialogDescription>Review the task details before assigning</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground">Task Title</Label>
              <p className="font-medium">{taskForm.title}</p>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">Description</Label>
              <p className="text-sm">{taskForm.description}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">XP Reward</Label>
                <p className="font-medium">{taskForm.xpReward} XP</p>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">Due Date</Label>
                <p className="font-medium">{taskForm.dueDate ? format(taskForm.dueDate, "PPP") : "Not set"}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">Category</Label>
                <Badge>{taskForm.category}</Badge>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">Visibility</Label>
                <Badge variant="outline">
                  {taskForm.visibility === "Public" ? <Globe className="h-3 w-3 mr-1" /> : <Lock className="h-3 w-3 mr-1" />}
                  {taskForm.visibility}
                </Badge>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">Source</Label>
                <Badge variant="secondary">{activeTab === 'ai' ? 'AI' : activeTab === 'template' ? 'Template' : 'Admin'}</Badge>
              </div>
            </div>

            <div className="pt-4 border-t">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-primary">{selectedStudents.length}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      Students
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-primary">{getCollegeCount()}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Building2 className="h-3 w-3" />
                      Colleges
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle className={cn("h-4 w-4", taskForm.autoApproved ? "text-green-600" : "text-muted-foreground")} />
                  <span className={taskForm.autoApproved ? "text-green-600" : "text-muted-foreground"}>
                    {taskForm.autoApproved ? "Auto-Approved" : "Requires Approval"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPreview(false)}>
              Edit Task
            </Button>
            <Button onClick={handleConfirmAssign} disabled={loading} className="bg-orange-600 hover:bg-orange-700">
              <CheckCircle className="mr-2 h-4 w-4" />
              {loading ? "Assigning..." : "Confirm Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminAssignTasks;
