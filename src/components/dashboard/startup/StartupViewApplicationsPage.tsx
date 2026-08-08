import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useStartupApplications, useReviewApplication } from "@/hooks/useTaskApplications";
import { format } from "date-fns";
import { Clock, Award, Search, Filter, User, ExternalLink, CheckCircle, X, MessageSquare } from "lucide-react";

const StartupViewApplicationsPage = () => {
  const { data: applications = [], isLoading } = useStartupApplications();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedApplication, setSelectedApplication] = useState<any>(null);
  const [reviewAction, setReviewAction] = useState<'accept' | 'reject' | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  
  const reviewApplication = useReviewApplication();

  // Filter applications
  const filteredApplications = useMemo(() => {
    let filtered = applications;

    // Apply search filter
    if (searchQuery.trim()) {
      filtered = filtered.filter(app =>
        app.tasks?.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        app.student_profiles?.full_name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Apply status filter
    if (statusFilter !== "All") {
      filtered = filtered.filter(app => app.status === statusFilter);
    }

    return filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [applications, searchQuery, statusFilter]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Pending Review':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'Accepted':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'Rejected':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  const handleReview = async (applicationId: string, status: 'Accepted' | 'Rejected') => {
    await reviewApplication.mutateAsync({
      applicationId,
      status,
      rejectionReason: status === 'Rejected' ? rejectionReason : undefined,
    });
    
    setSelectedApplication(null);
    setReviewAction(null);
    setRejectionReason("");
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Task Applications</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-24 bg-muted rounded"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold flex items-center gap-2">
            <User className="h-5 w-5" />
            Task Applications
            <Badge variant="outline" className="ml-auto">
              {filteredApplications.length} applications
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-4 p-4 bg-muted/50 rounded-lg border">
            <div className="flex items-center gap-2 flex-1">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by task, student name, or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Status</SelectItem>
                  <SelectItem value="Pending Review">Pending Review</SelectItem>
                  <SelectItem value="Accepted">Accepted</SelectItem>
                  <SelectItem value="Rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {filteredApplications.length === 0 ? (
            <div className="text-center py-12">
              <User className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                {applications.length === 0 ? "No applications yet" : "No applications match your filters"}
              </h3>
              <p className="text-muted-foreground">
                {applications.length === 0 
                  ? "Applications will appear here when students apply to your tasks."
                  : "Try adjusting your search or filter criteria."
                }
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredApplications.map((application) => (
                <Card key={application.id} className="hover:shadow-sm transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-start gap-4 flex-1">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={application.student_profiles?.profile_photo_url || ''} />
                          <AvatarFallback>
                            {application.student_profiles?.full_name
                              ?.split(' ')
                              .map(n => n[0])
                              .join('') || 'S'}
                          </AvatarFallback>
                        </Avatar>
                        
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-foreground">
                              {application.student_profiles?.full_name || 'Unknown Student'}
                            </h3>
                            <span className="text-sm text-muted-foreground">
                              {application.tasks?.title}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">
                            Applied for: <span className="font-medium text-foreground">
                              {application.tasks?.title || 'Unknown Task'}
                            </span>
                          </p>
                          <div className="flex items-center gap-1 mb-2">
                            <Award className="h-4 w-4 text-orange-500" />
                            <span className="text-sm font-medium">{application.tasks?.xp_reward || 0} XP</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex flex-col items-end gap-2">
                        <Badge 
                          variant="outline" 
                          className={`${getStatusColor(application.status)} flex items-center gap-1`}
                        >
                          <Clock className="h-3 w-3" />
                          {application.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(application.created_at), "MMM dd, yyyy")}
                        </span>
                      </div>
                    </div>

                    {application.application_note && (
                      <div className="bg-muted/50 rounded-lg p-4 mb-4">
                        <p className="text-sm font-medium text-foreground mb-1">Application Note:</p>
                        <p className="text-sm text-muted-foreground">{application.application_note}</p>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {application.portfolio_link && (
                          <Button variant="outline" size="sm" asChild>
                            <a href={application.portfolio_link} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-3 w-3 mr-1" />
                              View Portfolio
                            </a>
                          </Button>
                        )}
                      </div>
                      
                      {application.status === 'Pending Review' && (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedApplication(application);
                              setReviewAction('reject');
                            }}
                            className="text-red-600 border-red-300 hover:bg-red-50"
                          >
                            <X className="h-4 w-4 mr-1" />
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedApplication(application);
                              setReviewAction('accept');
                            }}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Accept
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Review Dialog */}
      <Dialog open={!!selectedApplication && !!reviewAction} onOpenChange={() => {
        setSelectedApplication(null);
        setReviewAction(null);
        setRejectionReason("");
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reviewAction === 'accept' ? 'Accept Application' : 'Reject Application'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">
                Student: <span className="font-medium text-foreground">
                  {selectedApplication?.student_profiles?.full_name}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                Task: <span className="font-medium text-foreground">
                  {selectedApplication?.tasks?.title}
                </span>
              </p>
            </div>

            {reviewAction === 'accept' && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm text-green-800">
                  This will assign the task to the student and notify them that their application was accepted.
                </p>
              </div>
            )}

            {reviewAction === 'reject' && (
              <div className="space-y-3">
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm text-red-800">
                    This will reject the application and notify the student.
                  </p>
                </div>
                <div>
                  <Label htmlFor="rejectionReason">Rejection Reason (Optional)</Label>
                  <Textarea
                    id="rejectionReason"
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="Provide feedback to help the student improve..."
                    className="mt-1"
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setSelectedApplication(null);
              setReviewAction(null);
              setRejectionReason("");
            }}>
              Cancel
            </Button>
            <Button
              onClick={() => handleReview(selectedApplication.id, reviewAction === 'accept' ? 'Accepted' : 'Rejected')}
              disabled={reviewApplication.isPending}
              className={reviewAction === 'accept' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}
            >
              {reviewApplication.isPending ? 'Processing...' : 
               reviewAction === 'accept' ? 'Accept Application' : 'Reject Application'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default StartupViewApplicationsPage;