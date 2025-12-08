import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTaskPacks, TaskPack } from "@/hooks/useTaskPacks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { 
  CalendarIcon, 
  Package, 
  Users, 
  CheckCircle2, 
  ArrowRight,
  GraduationCap,
  Layers,
  Clock,
  Award
} from "lucide-react";
import { cn } from "@/lib/utils";

interface BatchInfo {
  batch: string;
  count: number;
}

interface BranchInfo {
  branch: string;
  count: number;
}

const difficultyColors: Record<string, string> = {
  Beginner: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  Intermediate: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  Advanced: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const AssignPackPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: packs, isLoading: packsLoading } = useTaskPacks("published");
  
  const [selectedPackId, setSelectedPackId] = useState<string>("");
  const [selectedBatch, setSelectedBatch] = useState<string>("");
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [dueDate, setDueDate] = useState<Date | undefined>();
  const [batches, setBatches] = useState<BatchInfo[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [studentsInSelection, setStudentsInSelection] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [assignmentResult, setAssignmentResult] = useState<any>(null);

  const selectedPack = packs?.find(p => p.id === selectedPackId);

  useEffect(() => {
    fetchBatchesAndBranches();
  }, []);

  useEffect(() => {
    if (selectedBatch) {
      fetchStudentCount();
    } else {
      setStudentsInSelection(0);
    }
  }, [selectedBatch, selectedBranch]);

  const fetchBatchesAndBranches = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: collegeData } = await supabase
        .from('colleges')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!collegeData) return;

      // Fetch unique batches with counts
      const { data: studentsData } = await supabase
        .from('student_profiles')
        .select('batch, branch')
        .eq('college_id', collegeData.id)
        .eq('status', 'active');

      if (studentsData) {
        // Group by batch
        const batchMap = new Map<string, number>();
        const branchMap = new Map<string, number>();
        
        studentsData.forEach(student => {
          if (student.batch) {
            batchMap.set(student.batch, (batchMap.get(student.batch) || 0) + 1);
          }
          if (student.branch) {
            branchMap.set(student.branch, (branchMap.get(student.branch) || 0) + 1);
          }
        });

        setBatches(Array.from(batchMap.entries()).map(([batch, count]) => ({ batch, count })).sort((a, b) => a.batch.localeCompare(b.batch)));
        setBranches(Array.from(branchMap.entries()).map(([branch, count]) => ({ branch, count })).sort((a, b) => a.branch.localeCompare(b.branch)));
      }
    } catch (error) {
      console.error('Error fetching batches:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchStudentCount = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: collegeData } = await supabase
        .from('colleges')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!collegeData) return;

      let query = supabase
        .from('student_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('college_id', collegeData.id)
        .eq('batch', selectedBatch)
        .eq('status', 'active');

      if (selectedBranch && selectedBranch !== 'all') {
        query = query.eq('branch', selectedBranch);
      }

      const { count } = await query;
      setStudentsInSelection(count || 0);
    } catch (error) {
      console.error('Error fetching student count:', error);
    }
  };

  const handleAssignPack = async () => {
    if (!selectedPackId || !selectedBatch) {
      toast({
        title: "Missing Information",
        description: "Please select a pack and batch to assign",
        variant: "destructive",
      });
      return;
    }

    setAssigning(true);
    try {
      const { data, error } = await supabase.rpc('assign_pack_to_batch', {
        p_pack_id: selectedPackId,
        p_batch: selectedBatch,
        p_branch: selectedBranch && selectedBranch !== 'all' ? selectedBranch : null,
        p_start_date: startDate?.toISOString().split('T')[0] || null,
        p_due_date: dueDate?.toISOString().split('T')[0] || null,
      });

      if (error) throw error;

      // Parse the JSONB response
      const result = data as { 
        success: boolean; 
        message: string; 
        assignment_id?: string;
        students_assigned?: number;
        tasks_in_pack?: number;
      } | null;

      if (result?.success) {
        setAssignmentResult({
          ...result,
          packName: selectedPack?.name,
          batch: selectedBatch,
          branch: selectedBranch && selectedBranch !== 'all' ? selectedBranch : 'All Branches',
        });
        setShowSummary(true);
        toast({
          title: "Pack Assigned Successfully!",
          description: result.message,
        });
      } else {
        throw new Error(result?.message || 'Assignment failed');
      }
    } catch (error: any) {
      console.error('Error assigning pack:', error);
      toast({
        title: "Assignment Failed",
        description: error.message || "Failed to assign pack to students",
        variant: "destructive",
      });
    } finally {
      setAssigning(false);
    }
  };

  const resetForm = () => {
    setSelectedPackId("");
    setSelectedBatch("");
    setSelectedBranch("");
    setStartDate(undefined);
    setDueDate(undefined);
    setShowSummary(false);
    setAssignmentResult(null);
  };

  if (showSummary && assignmentResult) {
    return (
      <div className="p-4 sm:p-6 space-y-6">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Pack Assigned Successfully!</h1>
          <p className="text-muted-foreground">
            The task pack has been assigned to the selected students.
          </p>
        </div>

        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              Assignment Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">Pack Name</p>
                <p className="font-semibold text-foreground">{assignmentResult.packName}</p>
              </div>
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">Batch</p>
                <p className="font-semibold text-foreground">{assignmentResult.batch}</p>
              </div>
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">Branch</p>
                <p className="font-semibold text-foreground">{assignmentResult.branch}</p>
              </div>
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground">Tasks in Pack</p>
                <p className="font-semibold text-foreground">{assignmentResult.tasks_in_pack}</p>
              </div>
            </div>

            <div className="p-6 bg-primary/10 rounded-xl text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Users className="h-6 w-6 text-primary" />
                <span className="text-3xl font-bold text-primary">{assignmentResult.students_assigned}</span>
              </div>
              <p className="text-sm text-muted-foreground">Students Assigned</p>
            </div>

            <div className="flex gap-3 pt-4">
              <Button 
                variant="outline" 
                className="flex-1"
                onClick={resetForm}
              >
                Assign Another Pack
              </Button>
              <Button 
                className="flex-1"
                onClick={() => navigate('/college/dashboard')}
              >
                Back to Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground flex items-center gap-2">
          <Package className="h-7 w-7 text-primary" />
          Assign Task Pack
        </h1>
        <p className="text-muted-foreground mt-1">
          Assign a structured task pack to your students by batch
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Select Pack Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Layers className="h-5 w-5 text-primary" />
              Select Task Pack
            </CardTitle>
            <CardDescription>
              Choose a published pack to assign to students
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {packsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : packs && packs.length > 0 ? (
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                {packs.map((pack) => (
                  <div
                    key={pack.id}
                    onClick={() => setSelectedPackId(pack.id)}
                    className={cn(
                      "p-4 rounded-xl border-2 cursor-pointer transition-all duration-200",
                      selectedPackId === pack.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50 hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="font-semibold text-foreground">{pack.name}</h4>
                        <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                          {pack.description || "No description"}
                        </p>
                      </div>
                      {selectedPackId === pack.id && (
                        <CheckCircle2 className="h-5 w-5 text-primary shrink-0 ml-2" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <Badge className={difficultyColors[pack.difficulty] || difficultyColors.Beginner}>
                        {pack.difficulty}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {pack.task_count} tasks
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>No published packs available</p>
                <p className="text-sm">Contact admin to create task packs</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Select Batch & Settings Section */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <GraduationCap className="h-5 w-5 text-primary" />
                Select Students
              </CardTitle>
              <CardDescription>
                Choose batch and optionally filter by branch
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>Batch *</Label>
                    <Select value={selectedBatch} onValueChange={setSelectedBatch}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select batch" />
                      </SelectTrigger>
                      <SelectContent>
                        {batches.map((b) => (
                          <SelectItem key={b.batch} value={b.batch}>
                            {b.batch} ({b.count} students)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Branch (Optional)</Label>
                    <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                      <SelectTrigger>
                        <SelectValue placeholder="All branches" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Branches</SelectItem>
                        {branches.map((b) => (
                          <SelectItem key={b.branch} value={b.branch}>
                            {b.branch} ({b.count} students)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedBatch && (
                    <div className="p-4 bg-primary/10 rounded-lg flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-primary" />
                        <span className="text-sm font-medium">Students to be assigned:</span>
                      </div>
                      <span className="text-lg font-bold text-primary">{studentsInSelection}</span>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Clock className="h-5 w-5 text-primary" />
                Assignment Settings
              </CardTitle>
              <CardDescription>
                Set optional start and due dates
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal",
                          !startDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {startDate ? format(startDate, "PPP") : "Pick date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={startDate}
                        onSelect={setStartDate}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <Label>Due Date</Label>
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
                        {dueDate ? format(dueDate, "PPP") : "Pick date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={dueDate}
                        onSelect={setDueDate}
                        disabled={(date) => startDate ? date < startDate : false}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Preview & Assign */}
          <Card className="bg-muted/30">
            <CardContent className="p-6">
              <div className="space-y-4">
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  <Award className="h-5 w-5 text-primary" />
                  Assignment Preview
                </h3>
                
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pack:</span>
                    <span className="font-medium text-foreground">
                      {selectedPack?.name || "Not selected"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tasks:</span>
                    <span className="font-medium text-foreground">
                      {selectedPack?.task_count || 0} tasks
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Batch:</span>
                    <span className="font-medium text-foreground">
                      {selectedBatch || "Not selected"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Branch:</span>
                    <span className="font-medium text-foreground">
                      {selectedBranch && selectedBranch !== 'all' ? selectedBranch : "All branches"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Students:</span>
                    <span className="font-medium text-primary">
                      {studentsInSelection}
                    </span>
                  </div>
                </div>

                <Button 
                  className="w-full" 
                  size="lg"
                  onClick={handleAssignPack}
                  disabled={!selectedPackId || !selectedBatch || studentsInSelection === 0 || assigning}
                >
                  {assigning ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                      Assigning...
                    </>
                  ) : (
                    <>
                      Assign Pack to {studentsInSelection} Students
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default AssignPackPage;
