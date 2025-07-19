import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Building, MapPin, Calendar, Briefcase } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format, isAfter } from "date-fns";

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
  created_at: string;
}

const StudentJobOpportunitiesPage = () => {
  const [jobs, setJobs] = useState<JobOpportunity[]>([]);
  const [filteredJobs, setFilteredJobs] = useState<JobOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<string>("ALL");
  const [selectedBranch, setSelectedBranch] = useState<string>("ALL");
  const [showRemoteOnly, setShowRemoteOnly] = useState(false);
  const { toast } = useToast();

  const fetchJobs = async () => {
    try {
      const { data, error } = await supabase
        .from('job_opportunities')
        .select('*')
        .order('deadline', { ascending: true });

      if (error) throw error;
      setJobs(data || []);
    } catch (error) {
      console.error('Error fetching job opportunities:', error);
      toast({
        title: "Error",
        description: "Failed to load job opportunities. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  useEffect(() => {
    let filtered = jobs;

    if (selectedType !== "ALL") {
      filtered = filtered.filter(job => job.job_type === selectedType);
    }

    if (selectedBranch !== "ALL") {
      filtered = filtered.filter(job => 
        job.eligible_branch === selectedBranch || job.eligible_branch === "ALL"
      );
    }

    if (showRemoteOnly) {
      filtered = filtered.filter(job => 
        job.location.toLowerCase().includes('remote')
      );
    }

    // Filter out expired jobs
    filtered = filtered.filter(job => 
      isAfter(new Date(job.deadline), new Date())
    );

    setFilteredJobs(filtered);
  }, [jobs, selectedType, selectedBranch, showRemoteOnly]);

  const getJobTypeColor = (type: string) => {
    switch (type.toLowerCase()) {
      case 'internship':
        return 'bg-blue-100 text-blue-800';
      case 'full-time':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const isDeadlineSoon = (deadline: string) => {
    const deadlineDate = new Date(deadline);
    const today = new Date();
    const diffTime = deadlineDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 7;
  };

  const jobTypes = [...new Set(jobs.map(j => j.job_type))];
  const branches = [...new Set(jobs.map(j => j.eligible_branch))].filter(b => b !== "ALL");

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Latest Jobs & Internships</h1>
        <p className="text-gray-600">Discover opportunities curated for you</p>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Job Type</Label>
              <Select value={selectedType} onValueChange={setSelectedType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Types</SelectItem>
                  {jobTypes.map(type => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Branch</Label>
              <Select value={selectedBranch} onValueChange={setSelectedBranch}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Branches</SelectItem>
                  {branches.map(branch => (
                    <SelectItem key={branch} value={branch}>{branch}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="remote-only"
                checked={showRemoteOnly}
                onCheckedChange={setShowRemoteOnly}
              />
              <Label htmlFor="remote-only">Remote Only</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Jobs Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredJobs.map((job) => (
          <Card key={job.id} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-start space-x-3">
                {job.logo_url ? (
                  <img 
                    src={job.logo_url} 
                    alt={`${job.company_name} logo`}
                    className="w-12 h-12 rounded-lg object-contain"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center">
                    <Building className="h-6 w-6 text-gray-500" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-lg leading-tight">{job.role}</CardTitle>
                  <p className="text-gray-600 font-medium">{job.company_name}</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2 text-sm text-gray-600">
                <MapPin className="h-4 w-4" />
                <span>{job.location}</span>
              </div>

              <div className="flex items-center space-x-2 text-sm text-gray-600">
                <Calendar className="h-4 w-4" />
                <span>Deadline: {format(new Date(job.deadline), 'MMM dd, yyyy')}</span>
                {isDeadlineSoon(job.deadline) && (
                  <Badge variant="destructive" className="ml-2">Soon</Badge>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge className={getJobTypeColor(job.job_type)}>
                  {job.job_type}
                </Badge>
                <Badge variant="outline">{job.eligible_branch}</Badge>
              </div>

              <Button 
                className="w-full" 
                onClick={() => window.open(job.apply_link, '_blank')}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Apply Now
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredJobs.length === 0 && !loading && (
        <div className="text-center py-12">
          <Briefcase className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No opportunities found</h3>
          <p className="text-gray-600">Try adjusting your filters or check back later for new opportunities.</p>
        </div>
      )}
    </div>
  );
};

export default StudentJobOpportunitiesPage;