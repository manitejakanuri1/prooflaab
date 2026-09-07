import { useState, useEffect } from "react";
import { Plus, Edit, Trash2, ExternalLink, Calendar, Filter, MoreVertical, Eye, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface JobOpportunity {
  id: string;
  role: string;
  company_name: string;
  logo_url: string | null;
  location: string;
  job_type: string;
  eligible_branch: string;
  apply_link: string;
  deadline: string;
  description: string | null;
  created_at: string;
  status: string;
}

interface JobFormData {
  role: string;
  company_name: string;
  location: string;
  job_type: string;
  apply_link: string;
  deadline: Date | undefined;
  description?: string;
}

const initialFormData: JobFormData = {
  role: "",
  company_name: "",  
  location: "",
  job_type: "",
  apply_link: "",
  deadline: undefined,
  description: "",
};

const jobTypes = ["Internship", "Full-time", "Part-time"];

const ManageJobsPage = () => {
  const [jobs, setJobs] = useState<JobOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<JobOpportunity | null>(null);
  const [formData, setFormData] = useState<JobFormData>(initialFormData);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchJobs = async () => {
    try {
      const { data, error } = await supabase
        .from("job_opportunities")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setJobs(data || []);
    } catch (error) {
      console.error("Error fetching jobs:", error);
      toast({
        title: "Error",
        description: "Failed to fetch job opportunities",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    if (!formData.deadline) {
      toast({
        title: "Error",
        description: "Please select a deadline",
        variant: "destructive",
      });
      setSubmitting(false);
      return;
    }

    try {
      const submitData = {
        role: formData.role,
        company_name: formData.company_name,
        location: formData.location,
        job_type: formData.job_type,
        apply_link: formData.apply_link,
        deadline: format(formData.deadline, 'yyyy-MM-dd'),
        eligible_branch: 'ALL',
        status: 'approved',
        description: formData.description?.trim() || null,
      };

      if (editingJob) {
        const { error } = await supabase
          .from("job_opportunities")
          .update(submitData)
          .eq("id", editingJob.id);

        if (error) throw error;
        toast({
          title: "Success",
          description: "Job opportunity updated successfully",
        });
      } else {
        const { error } = await supabase
          .from("job_opportunities")
          .insert([submitData]);

        if (error) throw error;
        toast({
          title: "Success",
          description: "Job opportunity created successfully",
        });
      }

      setIsDialogOpen(false);
      setEditingJob(null);
      setFormData(initialFormData);
      fetchJobs();
    } catch (error) {
      console.error("Error saving job:", error);
      toast({
        title: "Error",
        description: "Failed to save job opportunity",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this job opportunity?")) return;

    try {
      const { error } = await supabase
        .from("job_opportunities")
        .delete()
        .eq("id", id);

      if (error) throw error;
      
      toast({
        title: "Success",
        description: "Job opportunity deleted successfully",
      });
      
      fetchJobs();
    } catch (error) {
      console.error("Error deleting job:", error);
      toast({
        title: "Error",
        description: "Failed to delete job opportunity",
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (job: JobOpportunity) => {
    setEditingJob(job);
    setFormData({
      role: job.role,
      company_name: job.company_name,
      location: job.location,
      job_type: job.job_type,
      apply_link: job.apply_link,
      deadline: new Date(job.deadline),
      description: job.description ?? "",
    });
    setIsDialogOpen(true);
  };

  const openAddDialog = () => {
    setEditingJob(null);
    setFormData(initialFormData);
    setIsDialogOpen(true);
  };

  const getStatusBadge = (status: string) => {
    return (
      <Badge 
        className={
          status === 'approved' ? 'bg-green-100 text-green-800 hover:bg-green-100' :
          status === 'pending' ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100' :
          status === 'rejected' ? 'bg-red-100 text-red-800 hover:bg-red-100' : 
          'bg-gray-100 text-gray-800 hover:bg-gray-100'
        }
      >
        {status === 'approved' ? '✅ Approved' : 
         status === 'pending' ? '⚠️ Pending' : 
         status === 'rejected' ? '🔴 Rejected' : status}
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-1/3"></div>
          <div className="h-32 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">📂 Jobs Management</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage all job postings from startups and colleges.</p>
        </div>
        <Button 
          onClick={openAddDialog}
          className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 rounded-lg shadow-sm"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add New
        </Button>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-6">
          {/* Table */}
          {jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-6xl mb-4">💼</div>
              <p className="text-muted-foreground text-lg">No jobs posted yet. Encourage startups to add opportunities.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-muted-foreground/10">
                  <TableHead className="font-semibold">Job Title</TableHead>
                  <TableHead className="font-semibold">Company</TableHead>
                  <TableHead className="font-semibold">Location</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="font-semibold">Created</TableHead>
                  <TableHead className="font-semibold text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id} className="hover:bg-muted/30 border-muted-foreground/10">
                    <TableCell>
                      <div className="font-semibold text-foreground cursor-pointer hover:text-primary">
                        {job.role}
                      </div>
                    </TableCell>
                    <TableCell>{job.company_name}</TableCell>
                    <TableCell>{job.location}</TableCell>
                    <TableCell>{getStatusBadge(job.status || 'approved')}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(job.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => window.open(job.apply_link, "_blank")}>
                            <Eye className="mr-2 h-4 w-4" />
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEditDialog(job)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem 
                            onClick={() => handleDelete(job.id)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl border-0 bg-background">
          <DialogHeader className="border-b border-border/50 pb-4">
            <DialogTitle className="text-xl font-semibold text-foreground flex items-center gap-2">
              💼 {editingJob ? "Edit Job Opportunity" : "Create New Job"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-6 p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="role" className="text-sm font-medium text-foreground">Job Title</Label>
                <Input
                  id="role"
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  placeholder="e.g., Frontend Developer"
                  className="rounded-lg border-border/50 focus:border-primary transition-colors"
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="company_name" className="text-sm font-medium text-foreground">Company Name</Label>
                <Input
                  id="company_name"
                  value={formData.company_name}
                  onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                  placeholder="e.g., Tech Corp"
                  className="rounded-lg border-border/50 focus:border-primary transition-colors"
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="location" className="text-sm font-medium text-foreground">Location</Label>
                <Input
                  id="location"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  placeholder="e.g., New York, Remote"
                  className="rounded-lg border-border/50 focus:border-primary transition-colors"
                  required
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="job_type" className="text-sm font-medium text-foreground">Role Type</Label>
                <Select value={formData.job_type} onValueChange={(value) => setFormData({ ...formData, job_type: value })}>
                  <SelectTrigger className="rounded-lg border-border/50 focus:border-primary">
                    <SelectValue placeholder="Select job type" />
                  </SelectTrigger>
                  <SelectContent className="rounded-lg">
                    {jobTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="apply_link" className="text-sm font-medium text-foreground">Apply Link</Label>
              <Input
                id="apply_link"
                type="url"
                value={formData.apply_link}
                onChange={(e) => setFormData({ ...formData, apply_link: e.target.value })}
                placeholder="https://company.com/careers/apply"
                className="rounded-lg border-border/50 focus:border-primary transition-colors"
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">Deadline</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal rounded-lg border-border/50 hover:border-primary transition-colors",
                      !formData.deadline && "text-muted-foreground"
                    )}
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {formData.deadline ? format(formData.deadline, "PPP") : "Pick a deadline"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 rounded-lg shadow-lg" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={formData.deadline}
                    onSelect={(date) => setFormData({ ...formData, deadline: date })}
                    disabled={(date) => date < new Date()}
                    initialFocus
                    className="p-3 pointer-events-auto rounded-lg"
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-sm font-medium text-foreground">Description</Label>
              <Textarea
                id="description"
                value={formData.description || ""}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe the job role, requirements, and benefits..."
                className="rounded-lg border-border/50 focus:border-primary transition-colors min-h-[100px]"
                rows={4}
              />
            </div>
            
            <div className="flex justify-end space-x-3 pt-4 border-t border-border/50">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setIsDialogOpen(false)}
                className="rounded-lg px-6"
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={submitting}
                className="rounded-lg px-6 bg-primary hover:bg-primary/90 transition-colors"
              >
                {submitting ? "Creating..." : editingJob ? "Update Job" : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ManageJobsPage;