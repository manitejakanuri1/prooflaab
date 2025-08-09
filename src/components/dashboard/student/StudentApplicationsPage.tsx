import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useStudentApplications } from "@/hooks/useTaskApplications";
import { format } from "date-fns";
import { Clock, Award, FileText, ExternalLink, Calendar, Building2 } from "lucide-react";

const StudentApplicationsPage = () => {
  const { data: applications = [], isLoading } = useStudentApplications();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Applications</CardTitle>
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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Pending Review':
        return <Clock className="h-3 w-3" />;
      case 'Accepted':
        return <FileText className="h-3 w-3" />;
      case 'Rejected':
        return <Clock className="h-3 w-3" />;
      default:
        return <FileText className="h-3 w-3" />;
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5" />
            My Applications
            <Badge variant="outline" className="ml-auto">
              {applications.length} applications
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {applications.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                No applications yet
              </h3>
              <p className="text-muted-foreground">
                Start applying to available tasks to see your applications here.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {applications.map((application) => (
                <Card key={application.id} className="hover:shadow-sm transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-lg font-semibold text-foreground">
                            {application.tasks?.title || 'Unknown Task'}
                          </h3>
                          <Badge variant="outline">{application.tasks?.category || 'General'}</Badge>
                        </div>
                        {application.tasks?.description && (
                          <p className="text-muted-foreground text-sm mb-3 line-clamp-2">
                            {application.tasks.description}
                          </p>
                        )}
                      </div>
                      
                      <div className="flex flex-col items-end gap-2 ml-4">
                        <div className="flex items-center gap-1">
                          <Award className="h-4 w-4 text-orange-500" />
                          <span className="font-semibold">{application.tasks?.xp_reward || 0}</span>
                          <span className="text-sm text-muted-foreground">XP</span>
                        </div>
                        <Badge 
                          variant="outline" 
                          className={`${getStatusColor(application.status)} flex items-center gap-1 w-fit`}
                        >
                          {getStatusIcon(application.status)}
                          {application.status}
                        </Badge>
                      </div>
                    </div>

                    <div className="bg-muted/50 rounded-lg p-4 mb-4">
                      <p className="text-sm font-medium text-foreground mb-1">Your Application:</p>
                      <p className="text-sm text-muted-foreground">
                        {application.application_note || 'No note provided'}
                      </p>
                      {application.portfolio_link && (
                        <div className="mt-2">
                          <Button variant="outline" size="sm" asChild>
                            <a href={application.portfolio_link} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-3 w-3 mr-1" />
                              View Portfolio
                            </a>
                          </Button>
                        </div>
                      )}
                    </div>

                    {application.status === 'Rejected' && application.rejection_reason && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                        <p className="text-sm font-medium text-red-800 mb-1">Rejection Reason:</p>
                        <p className="text-sm text-red-700">{application.rejection_reason}</p>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          Applied: {format(new Date(application.created_at), "MMM dd, yyyy")}
                        </div>
                        {application.reviewed_at && (
                          <div className="flex items-center gap-1">
                            <Building2 className="h-4 w-4" />
                            Reviewed: {format(new Date(application.reviewed_at), "MMM dd, yyyy")}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default StudentApplicationsPage;