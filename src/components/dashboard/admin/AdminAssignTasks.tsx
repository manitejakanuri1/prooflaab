import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { CalendarIcon, Users, Wand2, Plus, FileText, User, Filter, Eye, Globe, Lock, Upload, X, Link, Building2, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { filterStudents as applyStudentFilters, filterStudentsByColleges } from "@/lib/studentFilters";
import { useTaskForms, type PersonalizedTask } from "@/components/dashboard/assignTasks/useTaskForms";

interface Student {
  id: string;
  full_name: string;
  email: string;
  branch: string | null;
  batch: string | null;
  year_of_study: string | null;
  college_id: string | null;
  college_name?: string;
  key_interests: string[] | null;
  preferred_skills: string[] | null;
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
}

interface College {
  id: string;
  name: string;
  email: string;
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


const AdminAssignTasks = () => {
  // Core state
  const [students, setStudents] = useState<Student[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
  const [colleges, setColleges] = useState<College[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("manual");
  const { toast } = useToast();

  // The four tab drafts, their accessors and the clear buttons live in
  // useTaskForms — they were byte-identical in this file and the other
  // assign-tasks screen.
  const {
    manualForm, setManualForm,
    aiForm, setAiForm,
    templateForm, setTemplateForm,
    personalForm, setPersonalForm,
    getActiveForm, updateActiveForm,
    title, description, xpReward, dueDate, visibility, category,
    selectedBranch, topicArea, selectedTemplate,
    attachmentType, attachmentUrl, attachmentFile,
    clearManualTask, clearAITask, clearTemplate, clearPersonalForm,
  } = useTaskForms(activeTab);

  // Personalized tasks state
  const [personalizedTasks, setPersonalizedTasks] = useState<PersonalizedTask[]>([]);
  const [showPersonalPreview, setShowPersonalPreview] = useState(false);

  // Template state
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [aiGenerating, setAiGenerating] = useState(false);

  // Audience filters - Admin specific: college selection
  const [audienceType, setAudienceType] = useState("custom"); // all, college, custom
  const [selectedColleges, setSelectedColleges] = useState<string[]>([]);
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
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchColleges();
    fetchStudents();
    fetchTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    filterStudents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, branchFilter, yearFilter, trustScoreMin, trustScoreMax, skillsFilter, audienceType, selectedColleges]);

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
      const query = supabase
        .from('student_profiles')
        // email lives in student_contact now, so that a signed-in student
        // cannot read every other student's address off the directory.
        .select(`
          id, full_name, branch, batch, year_of_study,
          key_interests, preferred_skills, trust_score, college_id, total_xp,
          colleges!student_profiles_college_id_fkey (name),
          student_contact (email)
        `)
        .eq('status', 'active');

      const { data, error } = await query.order('full_name');

      if (error) throw error;

      const studentsWithCollegeName = (data || []).map(s => ({
        ...s,
        email: (s as any).student_contact?.email ?? '',
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
    }
  };

  // Real rows. This used to return one invented template with the id '1', which
  // the assign function then failed to find, so the whole tab could only ever
  // produce "Template not found".
  const fetchTemplates = async () => {
    const { data, error } = await supabase
      .from('task_templates')
      .select('id, title, description, branch, skills, difficulty')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Could not load templates:', error.message);
      setTemplates([]);
      return;
    }
    setTemplates((data ?? []) as TaskTemplate[]);
  };

  // Saving one is how the library gets filled: an admin writing a task they
  // will want again ticks the box, and it is there next time.
  const saveAsTemplate = async () => {
    const name = title.trim();
    if (!name || !description.trim()) {
      toast({
        title: "Nothing to save yet",
        description: "A template needs a title and a description.",
        variant: "destructive",
      });
      return;
    }

    const { error } = await supabase.from('task_templates').insert({
      title: name,
      description: description.trim(),
      branch: branchFilter || null,
      difficulty: 'Medium',
      xp_reward: Number(xpReward) || 0,
    });

    if (error) {
      toast({
        title: "Not saved",
        description: error.message.includes('duplicate')
          ? "A template with that title already exists."
          : error.message,
        variant: "destructive",
      });
      return;
    }

    toast({ title: `Saved "${name}" as a template` });
    void fetchTemplates();
  };

  const filterStudents = () => {
    // Only the admin screen can target specific colleges.
    const scoped = audienceType === "college"
      ? filterStudentsByColleges(students, selectedColleges)
      : students;

    const filtered = applyStudentFilters(scoped, {
      branch: branchFilter,
      year: yearFilter,
      trustScoreMin,
      trustScoreMax,
      skills: skillsFilter,
    });

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
      setTemplateForm(prev => ({
        ...prev,
        selectedTemplate: templateId,
        title: template.title,
        description: template.description,
        xpReward: "100"
      }));
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

    // Generate unique tasks for each selected student
    const selectedStudentData = filteredStudents.filter(s => selectedStudents.includes(s.id));
    
    const tasks: PersonalizedTask[] = selectedStudentData.map((student, index) => {
      // Mock personalized task based on student interests
      const interests = student.key_interests?.join(', ') || 'general development';
      const skills = student.preferred_skills?.slice(0, 2).join(' and ') || 'core skills';
      
      return {
        id: `task-${student.id}-${Date.now()}`,
        studentId: student.id,
        studentName: student.full_name,
        studentBranch: student.branch,
        studentYear: student.year_of_study,
        title: `Personalized ${interests.split(',')[0]} Challenge for ${student.full_name.split(' ')[0]}`,
        description: `A customized task focusing on ${skills}, designed specifically for ${student.full_name} based on their interests in ${interests} and current skill level.`,
        selected: true,
        isEditing: false
      };
    });

    setPersonalizedTasks(tasks);
    setShowPersonalPreview(true);
    
    toast({
      title: "Success",
      description: `Generated ${tasks.length} personalized tasks`,
    });
  };




  const clearPersonalTask = () => {
    clearPersonalForm();
    setPersonalizedTasks([]);
    setShowPersonalPreview(false);
  };

  const toggleTaskSelection = (taskId: string) => {
    setPersonalizedTasks(prev => 
      prev.map(task => 
        task.id === taskId ? { ...task, selected: !task.selected } : task
      )
    );
  };

  const toggleTaskEditing = (taskId: string) => {
    setPersonalizedTasks(prev => 
      prev.map(task => 
        task.id === taskId ? { ...task, isEditing: !task.isEditing } : task
      )
    );
  };

  const updatePersonalizedTask = (taskId: string, updates: Partial<PersonalizedTask>) => {
    setPersonalizedTasks(prev => 
      prev.map(task => 
        task.id === taskId ? { ...task, ...updates } : task
      )
    );
  };

  const selectAllPersonalizedTasks = () => {
    const allSelected = personalizedTasks.every(task => task.selected);
    setPersonalizedTasks(prev => 
      prev.map(task => ({ ...task, selected: !allSelected }))
    );
  };

  const generateAITask = async () => {
    if (!aiForm.selectedBranch || !aiForm.topicArea.trim()) {
      toast({
        title: "Error",
        description: "Please select branch and enter topic keywords",
        variant: "destructive",
      });
      return;
    }

    setAiGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('assign_tasks', {
        body: {
          mode: 'ai',
          keywords: aiForm.topicArea,
          branch: aiForm.selectedBranch,
          due_date: aiForm.dueDate?.toISOString(),
          selected_students: [],
          category: 'Coding',
          visibility: aiForm.visibility.toLowerCase()
        }
      });

      if (error) throw error;

      if (data?.tasks?.[0]) {
        const generatedTask = data.tasks[0];
        setAiForm(prev => ({
          ...prev,
          title: generatedTask.title,
          description: generatedTask.description,
          xpReward: generatedTask.xp_reward?.toString() || '50',
          generated: true
        }));

        toast({
          title: "Success",
          description: "AI task generated successfully!",
        });
      } else {
        throw new Error('No task generated');
      }
    } catch (error) {
      console.error('AI generation error:', error);
      toast({
        title: "Error",
        description: "Failed to generate AI task. Please try again.",
        variant: "destructive",
      });
    } finally {
      setAiGenerating(false);
    }
  };

  const validateForm = () => {
    const errors: FormErrors = {};
    
    // Skip title/description validation for personalized mode
    if (activeTab !== "personalized") {
      const trimmedTitle = title.trim();
      const trimmedDescription = description.trim();
      
      if (!trimmedTitle) {
        errors.title = "Task title is required";
      } else if (trimmedTitle.length < 3) {
        errors.title = "Task title must be at least 3 characters long";
      } else if (trimmedTitle.length > 200) {
        errors.title = "Task title must not exceed 200 characters";
      }
      
      if (!trimmedDescription) {
        errors.description = "Task description is required";
      } else if (trimmedDescription.length < 20) {
        errors.description = "Task description must be at least 20 characters long";
      }
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
    // For personalized mode, check personalizedTasks instead of selectedStudents
    if (activeTab === "personalized") {
      const selectedTasks = personalizedTasks.filter(t => t.selected);
      if (!validateForm() || selectedTasks.length === 0) {
        if (selectedTasks.length === 0) {
          toast({
            title: "Error",
            description: "Please select at least one task to assign",
            variant: "destructive",
          });
        }
        return;
      }

      setConfirmationData({
        title: `${selectedTasks.length} Personalized Task${selectedTasks.length > 1 ? 's' : ''}`,
        description: `Assigning personalized tasks to ${selectedTasks.length} student${selectedTasks.length > 1 ? 's' : ''}`,
        dueDate: dueDate!,
        xpReward: parseInt(xpReward),
        selectedStudents: selectedTasks.map(t => ({
          id: t.studentId,
          full_name: t.studentName,
          branch: t.studentBranch,
          email: '',
          batch: null,
          year_of_study: t.studentYear,
          key_interests: null,
          preferred_skills: null,
          trust_score: 0,
          college_id: null,
          total_xp: 0
        })),
        category,
        visibility
      });
      setShowConfirmation(true);
      return;
    }

    // Standard validation for other modes
    if (!validateForm() || (audienceType !== "all" && selectedStudents.length === 0)) {
      if (audienceType !== "all" && selectedStudents.length === 0) {
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

    const selectedStudentData = audienceType === "all" 
      ? filteredStudents 
      : filteredStudents.filter(s => selectedStudents.includes(s.id));
      
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not authenticated");

      let insertedTasks;

      // Determine target students
      const targetStudents = audienceType === "all" 
        ? filteredStudents.map(s => s.id)
        : selectedStudents;

      // Prepare request body based on mode
      const requestBody: any = {
        mode: activeTab,
        due_date: confirmationData.dueDate.toISOString(),
        selected_students: targetStudents,
        xp_reward: confirmationData.xpReward,
        category: confirmationData.category,
        visibility: confirmationData.visibility.toLowerCase()
      };

      // Add mode-specific fields
      if (activeTab === 'manual') {
        requestBody.title = confirmationData.title;
        requestBody.description = confirmationData.description;
      } else if (activeTab === 'ai') {
        requestBody.keywords = topicArea;
        requestBody.branch = selectedBranch;
      } else if (activeTab === 'template') {
        requestBody.template_id = selectedTemplate;
      }

      // Call the edge function for all modes
      const { data, error: functionError } = await supabase.functions.invoke('assign_tasks', {
        body: requestBody
      });

      if (functionError) {
        console.error('Edge function error:', functionError);
        throw functionError;
      }
      
      if (!data || !data.success) {
        throw new Error(data?.error || 'Failed to assign tasks');
      }

      insertedTasks = data.tasks || [];

      // Get college count for success message
      const totalColleges = [...new Set(
        confirmationData.selectedStudents.map(s => s.college_id).filter(Boolean)
      )].length;

      toast({
        title: "Success",
        description: `Tasks assigned to ${confirmationData.selectedStudents.length} student(s) across ${totalColleges} college(s)`,
      });

      // Reset all forms
      setManualForm({
        title: "",
        description: "",
        xpReward: "",
        dueDate: undefined,
        category: "Coding",
        visibility: "Public",
        attachmentType: 'url',
        attachmentUrl: "",
        attachmentFile: null
      });
      setAiForm({
        selectedBranch: "",
        topicArea: "",
        dueDate: undefined,
        visibility: "Public",
        title: "",
        description: "",
        xpReward: "",
        generated: false
      });
      setTemplateForm({
        selectedTemplate: "",
        title: "",
        description: "",
        xpReward: "",
        dueDate: undefined,
        category: "Coding",
        visibility: "Public"
      });
      setPersonalForm({
        title: "",
        description: "",
        xpReward: "",
        dueDate: undefined,
        category: "Coding",
        visibility: "Public"
      });
      setSelectedStudents([]);
      setPersonalizedTasks([]);
      setShowPersonalPreview(false);
      setFormErrors({});
      setShowConfirmation(false);
      setAudienceType("custom");
      setSelectedColleges([]);
      setBranchFilter("");
      setYearFilter("");
      setTrustScoreMin("");
      setTrustScoreMax("");
      setSkillsFilter([]);

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
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 space-y-4 pb-4 border-b">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-foreground">Assign Tasks (Admin)</h2>
          <p className="text-muted-foreground">Create and assign tasks across multiple colleges</p>
        </div>
        <Button
          variant="outline"
          onClick={handlePreviewAssignment}
          className="flex items-center gap-2"
          disabled={
            activeTab === "personalized" 
              ? personalizedTasks.filter(t => t.selected).length === 0 || !xpReward || parseInt(xpReward) <= 0 || !dueDate
              : !title.trim() || !description.trim() || !xpReward || parseInt(xpReward) <= 0 || !dueDate || (audienceType !== "all" && selectedStudents.length === 0)
          }
        >
          <Eye className="h-4 w-4" />
          Preview Assignment
        </Button>
      </div>

      {/* Admin-specific Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Students</p>
                <p className="text-2xl font-bold">{students.length}</p>
              </div>
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Colleges</p>
                <p className="text-2xl font-bold">{colleges.length}</p>
              </div>
              <Building2 className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Selected</p>
                <p className="text-2xl font-bold">
                  {audienceType === "all" ? filteredStudents.length : selectedStudents.length}
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-auto px-1">
      <div className="grid gap-6 lg:grid-cols-2 pb-6">
        {/* Task Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Task Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger 
                  value="manual" 
                  className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  {getTabIcon('manual')}
                  <span className="hidden sm:inline">Manual</span>
                </TabsTrigger>
                <TabsTrigger 
                  value="ai" 
                  className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  {getTabIcon('ai')}
                  <span className="hidden sm:inline">AI</span>
                </TabsTrigger>
                <TabsTrigger 
                  value="template" 
                  className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  {getTabIcon('template')}
                  <span className="hidden sm:inline">Template</span>
                </TabsTrigger>
                <TabsTrigger 
                  value="personalized" 
                  className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                >
                  {getTabIcon('personalized')}
                  <span className="hidden sm:inline">Personal</span>
                </TabsTrigger>
              </TabsList>

              {/* Manual Tab */}
              <TabsContent value="manual" className="space-y-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="title">Task Title *</Label>
                    <Input
                      id="title"
                      placeholder="Enter task title"
                      value={title}
                      onChange={(e) => {
                        updateActiveForm({ title: e.target.value });
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
                        updateActiveForm({ description: e.target.value });
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
                      <Tabs value={attachmentType} onValueChange={(value) => setManualForm(prev => ({ ...prev, attachmentType: value as 'url' | 'file' }))} className="w-full">
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
                            onChange={(e) => setManualForm(prev => ({ ...prev, attachmentUrl: e.target.value }))}
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
                                  setManualForm(prev => ({ ...prev, attachmentFile: file }));
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
                                  onClick={() => setManualForm(prev => ({ ...prev, attachmentFile: null }))}
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
                          updateActiveForm({ xpReward: e.target.value });
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
                      <Select value={category} onValueChange={(value) => updateActiveForm({ category: value })}>
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
                  
                  {/* Clear Task Button - only show if fields have content */}
                  {(title || description || xpReward) && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="w-full"
                      onClick={clearManualTask}
                    >
                      <X className="h-4 w-4 mr-2" />
                      Clear Task
                    </Button>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="due-date">Due Date *</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            id="due-date"
                            variant="outline"
                            className={cn(
                              "w-full justify-start text-left font-normal",
                              !dueDate && "text-muted-foreground",
                              formErrors.dueDate && "border-destructive"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {dueDate ? format(dueDate, "PPP") : "Pick a date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar
                            mode="single"
                            selected={dueDate}
                            onSelect={(date) => {
                              updateActiveForm({ dueDate: date });
                              if (formErrors.dueDate) {
                                setFormErrors({...formErrors, dueDate: undefined});
                              }
                            }}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      {formErrors.dueDate && (
                        <p className="text-sm text-destructive">{formErrors.dueDate}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="visibility">Visibility</Label>
                      <Select value={visibility} onValueChange={(value) => updateActiveForm({ visibility: value })}>
                        <SelectTrigger id="visibility">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Public">
                            <div className="flex items-center gap-2">
                              <Globe className="h-4 w-4" />
                              Public
                            </div>
                          </SelectItem>
                          <SelectItem value="Private">
                            <div className="flex items-center gap-2">
                              <Lock className="h-4 w-4" />
                              Private
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                  {/* The library is filled from here. A task worth writing once
                      is usually worth handing out again. */}
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Save this as a template</p>
                      <p className="text-xs text-muted-foreground">
                        It appears in the Template tab next time, for you and for colleges.
                      </p>
                    </div>
                    <Button type="button" variant="outline" size="sm"
                            onClick={() => void saveAsTemplate()}>
                      Save as template
                    </Button>
                  </div>

              </TabsContent>

              {/* AI Tab */}
              <TabsContent value="ai" className="space-y-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="ai-branch">Branch *</Label>
                    <Select value={selectedBranch} onValueChange={(value) => setAiForm(prev => ({ ...prev, selectedBranch: value }))}>
                      <SelectTrigger id="ai-branch">
                        <SelectValue placeholder="Select branch" />
                      </SelectTrigger>
                      <SelectContent>
                        {["CSE", "ECE", "ME", "CE", "EEE", "IT"].map(branch => (
                          <SelectItem key={branch} value={branch}>{branch}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="topic-area">Topic Area *</Label>
                    <Input
                      id="topic-area"
                      placeholder="e.g., Machine Learning, Data Structures"
                      value={topicArea}
                      onChange={(e) => setAiForm(prev => ({ ...prev, topicArea: e.target.value }))}
                    />
                  </div>

                  {/* Due Date and Visibility - Always visible */}
                  <div className="grid grid-cols-2 gap-4">
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
                            {dueDate ? format(dueDate, "PPP") : "Pick a date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                          <Calendar
                            mode="single"
                            selected={dueDate}
                            onSelect={(date) => setAiForm(prev => ({ ...prev, dueDate: date }))}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-2">
                      <Label>Visibility</Label>
                      <Select value={visibility} onValueChange={(value) => setAiForm(prev => ({ ...prev, visibility: value }))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Public">
                            <div className="flex items-center gap-2">
                              <Globe className="h-4 w-4" />
                              Public
                            </div>
                          </SelectItem>
                          <SelectItem value="Private">
                            <div className="flex items-center gap-2">
                              <Lock className="h-4 w-4" />
                              Private
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Button 
                    onClick={generateAITask} 
                    disabled={aiGenerating}
                    className="w-full"
                  >
                    <Wand2 className="mr-2 h-4 w-4" />
                    {aiGenerating ? "Generating..." : "Generate AI Task"}
                  </Button>

                  {aiForm.generated && title && (
                    <div className="space-y-4 pt-4 border-t">
                      <div className="space-y-2">
                        <Label>Generated Title</Label>
                        <Input
                          value={title}
                          onChange={(e) => setAiForm(prev => ({ ...prev, title: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Generated Description</Label>
                        <Textarea
                          value={description}
                          onChange={(e) => setAiForm(prev => ({ ...prev, description: e.target.value }))}
                          rows={4}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>XP Reward</Label>
                          <Input
                            type="number"
                            value={xpReward}
                            onChange={(e) => setAiForm(prev => ({ ...prev, xpReward: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Category</Label>
                          <Select value="Coding" disabled>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </Select>
                        </div>
                      </div>
                      
                      {(title || description || xpReward) && (
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="w-full"
                          onClick={clearAITask}
                        >
                          <X className="h-4 w-4 mr-2" />
                          Clear Generated Task
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Template Tab */}
              <TabsContent value="template" className="space-y-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="template-select">Select Template *</Label>
                    <Select value={selectedTemplate} onValueChange={handleTemplateSelect}>
                      <SelectTrigger id="template-select">
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
                    {templates.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        No templates yet. Write a task in the Manual tab and press "Save as
                        template" — it will be here, and on every college's screen, from then on.
                      </p>
                    )}
                  </div>

                  {selectedTemplate && (
                    <div className="space-y-4 pt-4 border-t">
                      <div className="space-y-2">
                        <Label>Title</Label>
                        <Input
                          value={title}
                          onChange={(e) => setTemplateForm(prev => ({ ...prev, title: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Description</Label>
                        <Textarea
                          value={description}
                          onChange={(e) => setTemplateForm(prev => ({ ...prev, description: e.target.value }))}
                          rows={4}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>XP Reward</Label>
                          <Input
                            type="number"
                            value={xpReward}
                            onChange={(e) => setTemplateForm(prev => ({ ...prev, xpReward: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Category</Label>
                          <Select value={category} onValueChange={(value) => setTemplateForm(prev => ({ ...prev, category: value }))}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Coding">Coding</SelectItem>
                              <SelectItem value="Design">Design</SelectItem>
                              <SelectItem value="Research">Research</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      
                      {(title || description || xpReward) && (
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="w-full"
                          onClick={clearTemplate}
                        >
                          <X className="h-4 w-4 mr-2" />
                          Clear Template
                        </Button>
                      )}

                      <div className="grid grid-cols-2 gap-4">
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
                                {dueDate ? format(dueDate, "PPP") : "Pick a date"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                              <Calendar
                                mode="single"
                                selected={dueDate}
                                onSelect={(date) => setTemplateForm(prev => ({ ...prev, dueDate: date }))}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                        <div className="space-y-2">
                          <Label>Visibility</Label>
                          <Select value={visibility} onValueChange={(value) => setTemplateForm(prev => ({ ...prev, visibility: value }))}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Public">
                                <div className="flex items-center gap-2">
                                  <Globe className="h-4 w-4" />
                                  Public
                                </div>
                              </SelectItem>
                              <SelectItem value="Private">
                                <div className="flex items-center gap-2">
                                  <Lock className="h-4 w-4" />
                                  Private
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Personalized Tab */}
              <TabsContent value="personalized" className="space-y-4">
                <div className="space-y-4">
                  <div className="text-center py-8 text-muted-foreground">
                    <Wand2 className="h-12 w-12 mx-auto mb-4" />
                    <p className="font-medium">AI-Powered Personalized Tasks</p>
                    <p className="text-sm">Select students below and generate unique tasks tailored to each student's profile</p>
                  </div>
                  
                  <Button 
                    onClick={generatePersonalizedTasks}
                    className="w-full"
                    disabled={aiGenerating || selectedStudents.length === 0}
                  >
                    <Wand2 className="mr-2 h-4 w-4" />
                    {selectedStudents.length > 0 
                      ? `Generate ${selectedStudents.length} Personalized Task${selectedStudents.length > 1 ? 's' : ''}`
                      : 'Generate Personalized Tasks'
                    }
                  </Button>
                  
                  {selectedStudents.length > 0 && (
                    <>

                      {personalizedTasks.length > 0 && (
                        <div className="space-y-4 pt-4 border-t">
                          <div className="flex items-center justify-between">
                            <Label>Generated Tasks ({personalizedTasks.filter(t => t.selected).length}/{personalizedTasks.length})</Label>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={selectAllPersonalizedTasks}
                            >
                              {personalizedTasks.every(t => t.selected) ? 'Deselect All' : 'Select All'}
                            </Button>
                          </div>
                          <div className="max-h-96 overflow-y-auto space-y-2 border rounded p-2">
                            {personalizedTasks.map(task => (
                              <div key={task.id} className="p-3 border rounded space-y-2">
                                <div className="flex items-start gap-2">
                                  <Checkbox
                                    checked={task.selected}
                                    onCheckedChange={() => toggleTaskSelection(task.id)}
                                  />
                                  <div className="flex-1 space-y-1">
                                    <p className="font-medium text-sm">{task.studentName}</p>
                                    {task.isEditing ? (
                                      <div className="space-y-2">
                                        <Input
                                          value={task.title}
                                          onChange={(e) => updatePersonalizedTask(task.id, { title: e.target.value })}
                                          className="text-sm"
                                        />
                                        <Textarea
                                          value={task.description}
                                          onChange={(e) => updatePersonalizedTask(task.id, { description: e.target.value })}
                                          rows={3}
                                          className="text-sm"
                                        />
                                      </div>
                                    ) : (
                                      <>
                                        <p className="text-sm font-medium">{task.title}</p>
                                        <p className="text-xs text-muted-foreground">{task.description}</p>
                                      </>
                                    )}
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => toggleTaskEditing(task.id)}
                                  >
                                    {task.isEditing ? 'Done' : 'Edit'}
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <Label>XP Reward (for all) *</Label>
                              <Input
                                type="number"
                                placeholder="100"
                                value={xpReward}
                                onChange={(e) => setPersonalForm(prev => ({ ...prev, xpReward: e.target.value }))}
                              />
                            </div>
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
                                    {dueDate ? format(dueDate, "PPP") : "Pick a date"}
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                  <Calendar
                                    mode="single"
                                    selected={dueDate}
                                    onSelect={(date) => setPersonalForm(prev => ({ ...prev, dueDate: date }))}
                                    initialFocus
                                  />
                                </PopoverContent>
                              </Popover>
                            </div>
                          </div>

                          {personalizedTasks.length > 0 && (
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="w-full"
                              onClick={clearPersonalTask}
                            >
                              <X className="h-4 w-4 mr-2" />
                              Clear All Tasks
                            </Button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Audience Selection Panel */}
        <Card>
          <CardHeader>
            <CardTitle>Target Audience</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Admin-specific: Audience Type Selector */}
            <div className="space-y-2">
              <Label>Audience Type</Label>
              <Select value={audienceType} onValueChange={setAudienceType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Students</SelectItem>
                  <SelectItem value="college">By College</SelectItem>
                  <SelectItem value="custom">Custom Selection</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {audienceType === "all" && (
              <div className="p-4 bg-muted/50 rounded-md">
                <p className="text-sm text-muted-foreground text-center">
                  Task will be assigned to all {filteredStudents.length} active students
                </p>
              </div>
            )}

            {/* Admin-specific: College Selector */}
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
                      <Label className="text-sm font-normal cursor-pointer">{college.name}</Label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {audienceType === "custom" && (
              <>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setShowFilters(!showFilters)} 
                  className="w-full"
                >
                  <Filter className="mr-2 h-4 w-4" />
                  {showFilters ? 'Hide Filters' : 'Show Filters'}
                </Button>

                {showFilters && (
                  <div className="space-y-4 p-4 border rounded-md">
                    <div className="space-y-2">
                      <Label>Branch</Label>
                      <Select value={branchFilter} onValueChange={setBranchFilter}>
                        <SelectTrigger>
                          <SelectValue placeholder="All branches" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all-branches">All Branches</SelectItem>
                          {uniqueBranches.map(branch => (
                            <SelectItem key={branch} value={branch}>{branch}</SelectItem>
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
                          <SelectItem value="all-years">All Years</SelectItem>
                          {uniqueYears.map(year => (
                            <SelectItem key={year} value={year}>{year}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                  </div>
                )}
              </>
            )}

            {audienceType !== "all" && (
              <>
                <div className="flex items-center justify-between pt-4 border-t">
                  <Label>Students ({filteredStudents.length})</Label>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleSelectAll}
                  >
                    {selectedStudents.length === filteredStudents.length ? 'Deselect All' : 'Select All'}
                  </Button>
                </div>

                <div className="max-h-96 overflow-y-auto space-y-2 border rounded-md p-3">
                  {filteredStudents.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No students found</p>
                  ) : (
                    filteredStudents.map(student => (
                      <div key={student.id} className="flex items-start space-x-2 p-2 hover:bg-muted rounded">
                        <Checkbox
                          checked={selectedStudents.includes(student.id)}
                          onCheckedChange={(checked) => handleStudentSelect(student.id, !!checked)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{student.full_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {student.branch} • {student.year_of_study}
                          </p>
                          <p className="text-xs text-muted-foreground">{student.college_name}</p>
                          <div className="flex gap-2 mt-1">
                            <Badge variant="secondary" className="text-xs">
                              Trust: {student.trust_score}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              XP: {student.total_xp}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            <div className="pt-4 border-t">
              <div className="text-center space-y-1">
                <p className="text-sm text-muted-foreground">Target Students</p>
                <p className="text-2xl font-bold text-primary">
                  {audienceType === "all" ? filteredStudents.length : selectedStudents.length}
                </p>
                <p className="text-xs text-muted-foreground">
                  Across {[...new Set(
                    (audienceType === "all" ? filteredStudents : filteredStudents.filter(s => selectedStudents.includes(s.id)))
                      .map(s => s.college_id).filter(Boolean)
                  )].length} college(s)
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={showConfirmation} onOpenChange={setShowConfirmation}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Confirm Task Assignment</DialogTitle>
            <DialogDescription>
              Review the task details before assigning to students
            </DialogDescription>
          </DialogHeader>
          
          {confirmationData && (
            <div className="space-y-4">
              <div className="p-4 bg-muted/50 rounded-md space-y-2">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Title</p>
                  <p className="font-medium">{confirmationData.title}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Description</p>
                  <p className="text-sm">{confirmationData.description}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">XP Reward</p>
                    <p className="font-medium">{confirmationData.xpReward} XP</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Due Date</p>
                    <p className="font-medium">{format(confirmationData.dueDate, "PPP")}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Category</p>
                    <Badge>{confirmationData.category}</Badge>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Visibility</p>
                    <Badge variant="outline">
                      {confirmationData.visibility === "Public" ? (
                        <><Globe className="h-3 w-3 mr-1" /> Public</>
                      ) : (
                        <><Lock className="h-3 w-3 mr-1" /> Private</>
                      )}
                    </Badge>
                  </div>
                </div>
                {confirmationData.attachmentUrl && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Attachment</p>
                    <p className="text-sm truncate">{confirmationData.attachmentName || confirmationData.attachmentUrl}</p>
                  </div>
                )}
              </div>

              <div>
                <p className="text-sm font-medium mb-2">
                  Assigning to {confirmationData.selectedStudents.length} student(s) across {
                    [...new Set(confirmationData.selectedStudents.map(s => s.college_id).filter(Boolean))].length
                  } college(s)
                </p>
                <div className="max-h-48 overflow-y-auto border rounded-md p-3 space-y-1">
                  {confirmationData.selectedStudents.map(student => (
                    <div key={student.id} className="text-sm py-1">
                      <span className="font-medium">{student.full_name}</span>
                      <span className="text-muted-foreground"> • {student.branch} • {student.college_name || 'Direct'}</span>
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
    </div>
  );
};

export default AdminAssignTasks;
