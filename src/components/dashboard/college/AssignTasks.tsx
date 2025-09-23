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
import { CalendarIcon, Users, Wand2, Plus, FileText, User, Filter, Eye, Globe, Lock, Sliders, Upload, X, Link } from "lucide-react";
import { cn } from "@/lib/utils";

interface Student {
  id: string;
  full_name: string;
  email: string;
  branch: string | null;
  batch: string | null;
  year_of_study: string | null;
  key_interests: string[] | null;
  preferred_skills: string[] | null;
  trust_score: number;
}

interface TaskTemplate {
  id: string;
  title: string;
  description: string;
  branch: string;
  skills: string[];
  difficulty: string;
}

interface ConfirmationData {
  title: string;
  description: string;
  dueDate: Date;
  xpReward: number;
  selectedStudents: Student[];
  category: string;
  visibility: string;
  attachmentUrl?: string;
  attachmentName?: string;
}

interface FormErrors {
  title?: string;
  description?: string;
  xpReward?: string;
  dueDate?: string;
}

const AssignTasks = () => {
  // Core state
  const [students, setStudents] = useState<Student[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("manual");
  const { toast } = useToast();

  // Task form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [xpReward, setXpReward] = useState("");
  const [dueDate, setDueDate] = useState<Date>();
  const [category, setCategory] = useState("Coding");
  const [visibility, setVisibility] = useState("Public");

  // AI form state
  const [selectedBranch, setSelectedBranch] = useState("");
  const [topicArea, setTopicArea] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

  // Template state
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");

  // Filter state
  const [branchFilter, setBranchFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [trustScoreMin, setTrustScoreMin] = useState("");
  const [trustScoreMax, setTrustScoreMax] = useState("");
  const [skillsFilter, setSkillsFilter] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  // Confirmation modal state
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmationData, setConfirmationData] = useState<ConfirmationData | null>(null);

  // Form validation state
  const [formErrors, setFormErrors] = useState<FormErrors>({});

  // Attachment state
  const [attachmentType, setAttachmentType] = useState<'url' | 'file'>('url');
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchStudents();
    fetchTemplates();
  }, []);

  useEffect(() => {
    filterStudents();
  }, [students, branchFilter, yearFilter, trustScoreMin, trustScoreMax, skillsFilter]);

  const fetchStudents = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: collegeData } = await supabase
        .from('colleges')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!collegeData) return;

      const { data: studentsData, error } = await supabase
        .from('student_profiles')
        .select(`
          id, full_name, email, branch, batch, year_of_study,
          key_interests, preferred_skills, trust_score, college_id
        `)
        .eq('college_id', collegeData.id)
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

  const fetchTemplates = async () => {
    // Placeholder for templates - can be implemented when task_templates table exists
    setTemplates([
      {
        id: '1',
        title: 'Basic Programming Challenge',
        description: 'A fundamental programming task focusing on core concepts',
        branch: 'CSE',
        skills: ['Programming', 'Problem Solving'],
        difficulty: 'Beginner'
      }
    ]);
  };

  const filterStudents = () => {
    let filtered = [...students];

    if (branchFilter && branchFilter !== "all-branches") {
      filtered = filtered.filter(s => s.branch === branchFilter);
    }
    if (yearFilter && yearFilter !== "all-years") {
      filtered = filtered.filter(s => s.year_of_study === yearFilter);
    }
    if (trustScoreMin) {
      filtered = filtered.filter(s => s.trust_score >= parseInt(trustScoreMin));
    }
    if (trustScoreMax) {
      filtered = filtered.filter(s => s.trust_score <= parseInt(trustScoreMax));
    }
    if (skillsFilter.length > 0) {
      filtered = filtered.filter(s => 
        s.preferred_skills?.some(skill => 
          skillsFilter.some(filter => skill.toLowerCase().includes(filter.toLowerCase()))
        )
      );
    }

    setFilteredStudents(filtered);
    // Clear invalid selections
    setSelectedStudents(prev => 
      prev.filter(id => filtered.some(s => s.id === id))
    );
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

  const handleTemplateSelect = (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (template) {
      setTitle(template.title);
      setDescription(template.description);
      setXpReward("100"); // Default XP for template tasks
    }
  };

  const generatePersonalizedTasks = async () => {
    if (selectedStudents.length === 0) {
      toast({
        title: "Error",
        description: "Please select students first",
        variant: "destructive",
      });
      return;
    }

    // Generate tasks based on student interests
    const selectedStudentData = filteredStudents.filter(s => selectedStudents.includes(s.id));
    const commonInterests = selectedStudentData.reduce((acc, student) => {
      student.key_interests?.forEach(interest => {
        acc[interest] = (acc[interest] || 0) + 1;
      });
      return acc;
    }, {} as Record<string, number>);

    const topInterest = Object.entries(commonInterests)
      .sort(([,a], [,b]) => b - a)[0]?.[0] || "Programming";

    setTitle(`Personalized ${topInterest} Challenge`);
    setDescription(`A customized task focusing on ${topInterest} skills, designed based on the selected students' interests and skill levels.`);
    setXpReward("120");
  };

  const generateAITask = async () => {
    if (!selectedBranch || !dueDate) {
      toast({
        title: "Error",
        description: "Please select branch and due date",
        variant: "destructive",
      });
      return;
    }

    setAiGenerating(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const difficulties = ['Beginner', 'Intermediate', 'Advanced'];
      const difficulty = difficulties[Math.floor(Math.random() * difficulties.length)];
      const xpMapping = { 'Beginner': 50, 'Intermediate': 100, 'Advanced': 150 };
      
      setTitle(`${selectedBranch} AI Challenge: ${topicArea || 'Advanced Problem Solving'}`);
      setDescription(`An AI-generated task for ${selectedBranch} students focusing on ${topicArea || 'core concepts'}. This challenge includes practical implementation, testing, and documentation requirements.`);
      setXpReward(xpMapping[difficulty as keyof typeof xpMapping].toString());

      toast({
        title: "Success",
        description: "AI task generated successfully!",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate AI task",
        variant: "destructive",
      });
    } finally {
      setAiGenerating(false);
    }
  };

  const validateForm = () => {
    const errors: FormErrors = {};
    
    if (!title.trim()) {
      errors.title = "Task title is required";
    }
    
    if (!description.trim()) {
      errors.description = "Task description is required";
    }
    
    const xpNum = parseInt(xpReward);
    if (!xpReward || isNaN(xpNum) || xpNum <= 0) {
      errors.xpReward = "XP Reward must be greater than 0";
    }
    
    if (!dueDate) {
      errors.dueDate = "Due date is required";
    }
    
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleAttachmentUpload = async (file: File): Promise<string | null> => {
    try {
      setUploading(true);
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `task-attachments/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('profile-photos')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('profile-photos')
        .getPublicUrl(filePath);

      return data.publicUrl;
    } catch (error) {
      console.error('Error uploading file:', error);
      toast({
        title: "Error",
        description: "Failed to upload attachment",
        variant: "destructive",
      });
      return null;
    } finally {
      setUploading(false);
    }
  };

  const handlePreviewAssignment = async () => {
    if (!validateForm() || selectedStudents.length === 0) {
      if (selectedStudents.length === 0) {
        toast({
          title: "Error",
          description: "Please select at least one student",
          variant: "destructive",
        });
      }
      return;
    }

    let finalAttachmentUrl = attachmentUrl;
    let finalAttachmentName = "";

    // Handle file upload if a file is selected
    if (attachmentFile) {
      const uploadedUrl = await handleAttachmentUpload(attachmentFile);
      if (uploadedUrl) {
        finalAttachmentUrl = uploadedUrl;
        finalAttachmentName = attachmentFile.name;
      }
    }

    const selectedStudentData = filteredStudents.filter(s => selectedStudents.includes(s.id));
    setConfirmationData({
      title,
      description,
      dueDate: dueDate!,
      xpReward: parseInt(xpReward),
      selectedStudents: selectedStudentData,
      category,
      visibility,
      attachmentUrl: finalAttachmentUrl || undefined,
      attachmentName: finalAttachmentName || undefined
    });
    setShowConfirmation(true);
  };

  const handleConfirmAssignment = async () => {
    if (!confirmationData) return;
    
    setLoading(true);
    try {
      const tasksToInsert = selectedStudents.map(studentId => ({
        student_id: studentId,
        title: confirmationData.title,
        description: confirmationData.description,
        due_date: confirmationData.dueDate.toISOString(),
        xp_reward: confirmationData.xpReward,
        category: confirmationData.category,
        visibility: confirmationData.visibility.toLowerCase(),
        status: 'Pending'
      }));

      const { data: insertedTasks, error } = await supabase
        .from('tasks')
        .insert(tasksToInsert)
        .select('id');

      if (error) throw error;

      // Create audit log entries for each task
      if (insertedTasks && insertedTasks.length > 0) {
        const currentUser = await supabase.auth.getUser();
        const auditLogs = insertedTasks.map(task => ({
          table_name: 'tasks',
          action: 'Task Created',
          record_id: task.id,
          user_id: currentUser.data.user?.id,
          new_values: {
            title: confirmationData.title,
            description: confirmationData.description,
            xp_reward: confirmationData.xpReward,
            category: confirmationData.category
          }
        }));

        const { error: auditError } = await supabase
          .from('audit_logs')
          .insert(auditLogs);

        if (auditError) {
          console.error('Error creating audit logs:', auditError);
        }
      }

      toast({
        title: "Success",
        description: `Tasks assigned to ${selectedStudents.length} student(s)`,
      });

      // Reset form
      setTitle("");
      setDescription("");
      setXpReward("");
      setSelectedStudents([]);
      setDueDate(undefined);
      setSelectedBranch("");
      setTopicArea("");
      setSelectedTemplate("");
      setAttachmentUrl("");
      setAttachmentFile(null);
      setFormErrors({});
      setShowConfirmation(false);

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
  const uniqueYears = [...new Set(students.map(s => s.year_of_study).filter(Boolean))];
  const allSkills = [...new Set(students.flatMap(s => s.preferred_skills || []))];

  const getTabIcon = (tab: string) => {
    switch(tab) {
      case 'manual': return <Plus className="h-4 w-4" />;
      case 'ai': return <Wand2 className="h-4 w-4" />;
      case 'template': return <FileText className="h-4 w-4" />;
      case 'personalized': return <User className="h-4 w-4" />;
      default: return <Plus className="h-4 w-4" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground">Assign Tasks</h2>
        <Button
          variant="outline"
          onClick={handlePreviewAssignment}
          className="flex items-center gap-2"
          disabled={!title.trim() || !description.trim() || !xpReward || parseInt(xpReward) <= 0 || !dueDate || selectedStudents.length === 0}
        >
          <Eye className="h-4 w-4" />
          Preview Assignment
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Task Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Task Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="manual" className="flex items-center gap-2">
                  {getTabIcon('manual')}
                  <span className="hidden sm:inline">Manual</span>
                </TabsTrigger>
                <TabsTrigger value="ai" className="flex items-center gap-2">
                  {getTabIcon('ai')}
                  <span className="hidden sm:inline">AI</span>
                </TabsTrigger>
                <TabsTrigger value="template" className="flex items-center gap-2">
                  {getTabIcon('template')}
                  <span className="hidden sm:inline">Template</span>
                </TabsTrigger>
                <TabsTrigger value="personalized" className="flex items-center gap-2">
                  {getTabIcon('personalized')}
                  <span className="hidden sm:inline">Personal</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="manual" className="space-y-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">Task Title *</Label>
                    <Input
                      id="title"
                      placeholder="Enter task title"
                      value={title}
                      onChange={(e) => {
                        setTitle(e.target.value);
                        if (formErrors.title) {
                          setFormErrors({...formErrors, title: undefined});
                        }
                      }}
                      className={formErrors.title ? "border-destructive" : ""}
                    />
                    {formErrors.title && (
                      <p className="text-sm text-destructive">{formErrors.title}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description *</Label>
                    <Textarea
                      id="description"
                      placeholder="Enter task description"
                      value={description}
                      onChange={(e) => {
                        setDescription(e.target.value);
                        if (formErrors.description) {
                          setFormErrors({...formErrors, description: undefined});
                        }
                      }}
                      rows={4}
                      className={formErrors.description ? "border-destructive" : ""}
                    />
                    {formErrors.description && (
                      <p className="text-sm text-destructive">{formErrors.description}</p>
                    )}
                  </div>

                  {/* Attachments Section */}
                  <div className="space-y-2">
                    <Label>Attachments (optional)</Label>
                    <div className="space-y-3">
                      <Tabs value={attachmentType} onValueChange={(value) => setAttachmentType(value as 'url' | 'file')} className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                          <TabsTrigger value="url" className="flex items-center gap-2">
                            <Link className="h-4 w-4" />
                            URL
                          </TabsTrigger>
                          <TabsTrigger value="file" className="flex items-center gap-2">
                            <Upload className="h-4 w-4" />
                            File
                          </TabsTrigger>
                        </TabsList>
                        <TabsContent value="url" className="mt-3">
                          <Input
                            placeholder="https://example.com/resource"
                            value={attachmentUrl}
                            onChange={(e) => setAttachmentUrl(e.target.value)}
                          />
                        </TabsContent>
                        <TabsContent value="file" className="mt-3">
                          <div className="space-y-2">
                            <Input
                              type="file"
                              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.txt"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  setAttachmentFile(file);
                                }
                              }}
                            />
                            {attachmentFile && (
                              <div className="flex items-center gap-2 p-2 bg-muted/50 rounded">
                                <FileText className="h-4 w-4" />
                                <span className="text-sm flex-1">{attachmentFile.name}</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setAttachmentFile(null)}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </div>
                        </TabsContent>
                      </Tabs>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="xp">XP Reward *</Label>
                      <Input
                        id="xp"
                        type="number"
                        placeholder="100"
                        value={xpReward}
                        onChange={(e) => {
                          setXpReward(e.target.value);
                          if (formErrors.xpReward) {
                            setFormErrors({...formErrors, xpReward: undefined});
                          }
                        }}
                        className={formErrors.xpReward ? "border-destructive" : ""}
                      />
                      {formErrors.xpReward && (
                        <p className="text-sm text-destructive">{formErrors.xpReward}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="category">Category</Label>
                      <Select value={category} onValueChange={setCategory}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Coding">Coding</SelectItem>
                          <SelectItem value="Design">Design</SelectItem>
                          <SelectItem value="Research">Research</SelectItem>
                          <SelectItem value="Writing">Writing</SelectItem>
                          <SelectItem value="Analysis">Analysis</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="ai" className="space-y-4">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="branch">Branch *</Label>
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
                      <Label htmlFor="topic">Topic Keywords</Label>
                      <Input
                        id="topic"
                        placeholder="e.g., algorithms, web dev"
                        value={topicArea}
                        onChange={(e) => setTopicArea(e.target.value)}
                      />
                    </div>
                  </div>
                  
                  <Button
                    onClick={generateAITask}
                    disabled={aiGenerating || !selectedBranch}
                    className="w-full"
                  >
                    {aiGenerating ? "Generating..." : "Generate AI Task"}
                  </Button>

                  {title && (
                    <div className="p-4 bg-muted/50 rounded-lg space-y-3">
                      <div>
                        <Label className="text-sm font-medium">Generated Title</Label>
                        <Input
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Generated Description</Label>
                        <Textarea
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          rows={4}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium">XP Reward</Label>
                        <Input
                          type="number"
                          value={xpReward}
                          onChange={(e) => setXpReward(e.target.value)}
                          className="mt-1"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="template" className="space-y-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="template">Select Template</Label>
                    <Select value={selectedTemplate} onValueChange={(value) => {
                      setSelectedTemplate(value);
                      handleTemplateSelect(value);
                    }}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a template" />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map(template => (
                          <SelectItem key={template.id} value={template.id}>
                            {template.title} ({template.difficulty})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedTemplate && (
                    <div className="p-4 bg-muted/50 rounded-lg space-y-3">
                      <div>
                        <Label className="text-sm font-medium">Title (Editable)</Label>
                        <Input
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Description (Editable)</Label>
                        <Textarea
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          rows={4}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium">XP Reward</Label>
                        <Input
                          type="number"
                          value={xpReward}
                          onChange={(e) => setXpReward(e.target.value)}
                          className="mt-1"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="personalized" className="space-y-4">
                <div className="space-y-4">
                  <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      Select students first, then generate personalized tasks based on their interests and skills.
                    </p>
                  </div>
                  
                  <Button
                    onClick={generatePersonalizedTasks}
                    disabled={selectedStudents.length === 0}
                    className="w-full"
                  >
                    Generate Personalized Task
                  </Button>

                  {title && (
                    <div className="p-4 bg-muted/50 rounded-lg space-y-3">
                      <div>
                        <Label className="text-sm font-medium">Personalized Title</Label>
                        <Input
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Personalized Description</Label>
                        <Textarea
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          rows={4}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium">XP Reward</Label>
                        <Input
                          type="number"
                          value={xpReward}
                          onChange={(e) => setXpReward(e.target.value)}
                          className="mt-1"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Common fields */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Due Date *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !dueDate && "text-muted-foreground",
                          formErrors.dueDate && "border-destructive"
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
                        onSelect={(date) => {
                          setDueDate(date);
                          if (formErrors.dueDate) {
                            setFormErrors({...formErrors, dueDate: undefined});
                          }
                        }}
                        initialFocus
                        disabled={(date) => date < new Date()}
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                  {formErrors.dueDate && (
                    <p className="text-sm text-destructive">{formErrors.dueDate}</p>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {visibility === "Public" ? <Globe className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                    <Label>Visibility</Label>
                  </div>
                  <Switch
                    checked={visibility === "Public"}
                    onCheckedChange={(checked) => setVisibility(checked ? "Public" : "Private")}
                  />
                </div>
              </div>
            </Tabs>
          </CardContent>
        </Card>

        {/* Student Selection */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Select Students ({selectedStudents.length}/{filteredStudents.length})
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-2"
              >
                <Filter className="h-4 w-4" />
                Filters
              </Button>
            </div>
            
            {showFilters && (
              <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Branch</Label>
                    <Select value={branchFilter} onValueChange={setBranchFilter}>
                      <SelectTrigger>
                        <SelectValue placeholder="All branches" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all-branches">All branches</SelectItem>
                        {uniqueBranches.map(branch => (
                          <SelectItem key={branch} value={branch!}>
                            {branch}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Year of Study</Label>
                    <Select value={yearFilter} onValueChange={setYearFilter}>
                      <SelectTrigger>
                        <SelectValue placeholder="All years" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all-years">All years</SelectItem>
                        {uniqueYears.map(year => (
                          <SelectItem key={year} value={year!}>
                            {year}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Trust Score Range</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Min"
                      type="number"
                      value={trustScoreMin}
                      onChange={(e) => setTrustScoreMin(e.target.value)}
                      className="w-24"
                    />
                    <span>to</span>
                    <Input
                      placeholder="Max"
                      type="number"
                      value={trustScoreMax}
                      onChange={(e) => setTrustScoreMax(e.target.value)}
                      className="w-24"
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => {
                      setBranchFilter("all-branches");
                      setYearFilter("all-years");
                      setTrustScoreMin("");
                      setTrustScoreMax("");
                      setSkillsFilter([]);
                    }}
                  >
                    Clear Filters
                  </Button>
                </div>
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={handleSelectAll}
              className="w-fit"
            >
              {selectedStudents.length === filteredStudents.length ? "Deselect All" : "Select All"}
            </Button>
          </CardHeader>
          <CardContent>
            <div className="max-h-96 overflow-y-auto space-y-2">
              {filteredStudents.map((student) => (
                <div key={student.id} className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-accent/50">
                  <Checkbox
                    id={student.id}
                    checked={selectedStudents.includes(student.id)}
                    onCheckedChange={(checked) => 
                      handleStudentSelect(student.id, checked as boolean)
                    }
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-foreground truncate">
                        {student.full_name}
                      </p>
                      <Badge variant="secondary" className="ml-2">
                        {student.trust_score}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {student.email}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {student.branch && (
                        <Badge variant="outline" className="text-xs">
                          {student.branch}
                        </Badge>
                      )}
                      {student.year_of_study && (
                        <Badge variant="outline" className="text-xs">
                          Year {student.year_of_study}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {filteredStudents.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-8 w-8 mx-auto mb-2" />
                  <p>No students match your filters</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Confirmation Modal */}
      <Dialog open={showConfirmation} onOpenChange={setShowConfirmation}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm Task Assignment</DialogTitle>
            <DialogDescription>
              Please review the task details before assigning.
            </DialogDescription>
          </DialogHeader>
          
          {confirmationData && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium">Task Title</Label>
                  <p className="text-sm text-muted-foreground mt-1">{confirmationData.title}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Due Date</Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    {format(confirmationData.dueDate, "PPP")}
                  </p>
                </div>
              </div>
              
              <div>
                <Label className="text-sm font-medium">Description</Label>
                <p className="text-sm text-muted-foreground mt-1 max-h-24 overflow-y-auto">
                  {confirmationData.description}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-sm font-medium">XP Reward</Label>
                  <p className="text-sm text-muted-foreground mt-1">{confirmationData.xpReward}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Category</Label>
                  <p className="text-sm text-muted-foreground mt-1">{confirmationData.category}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Visibility</Label>
                  <div className="flex items-center gap-1 mt-1">
                    {confirmationData.visibility === "Public" ? (
                      <Globe className="h-3 w-3" />
                    ) : (
                      <Lock className="h-3 w-3" />
                    )}
                    <span className="text-sm text-muted-foreground">{confirmationData.visibility}</span>
                  </div>
                </div>
              </div>

              {/* Attachment Display */}
              {(confirmationData.attachmentUrl || confirmationData.attachmentName) && (
                <div>
                  <Label className="text-sm font-medium">Attachment</Label>
                  <div className="flex items-center gap-2 mt-1 p-2 bg-muted/50 rounded">
                    <FileText className="h-4 w-4" />
                    <span className="text-sm text-muted-foreground">
                      {confirmationData.attachmentName || "Attachment URL"}
                    </span>
                  </div>
                </div>
              )}

              <div>
                <Label className="text-sm font-medium">
                  Selected Students ({confirmationData.selectedStudents.length})
                </Label>
                <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
                  {confirmationData.selectedStudents.map(student => (
                    <div key={student.id} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                      <span className="text-sm">{student.full_name}</span>
                      <Badge variant="outline" className="text-xs">
                        {student.branch}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmation(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmAssignment} disabled={loading}>
              {loading ? "Assigning..." : "Confirm Assignment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AssignTasks;