import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Calendar, Download, ExternalLink, User } from "lucide-react";

const mockSubmissions = [
  {
    id: 1,
    taskTitle: "React Frontend Development",
    studentName: "Rahul Sharma",
    studentEmail: "rahul@example.com",
    submittedDate: "2024-01-18",
    status: "Under Review",
    proofUrl: "https://github.com/rahul/react-dashboard",
    notes: "Implemented all required features with responsive design"
  },
  {
    id: 2,
    taskTitle: "Mobile App UI Design",
    studentName: "Priya Patel",
    studentEmail: "priya@example.com",
    submittedDate: "2024-01-17",
    status: "Verified",
    proofUrl: "https://figma.com/design-link",
    notes: "Excellent design system with consistent branding"
  },
  {
    id: 3,
    taskTitle: "API Integration",
    studentName: "Arjun Kumar",
    studentEmail: "arjun@example.com",
    submittedDate: "2024-01-16",
    status: "Rejected",
    proofUrl: "https://github.com/arjun/api-project",
    notes: "Missing error handling and documentation needs improvement"
  }
];

export function StartupSubmissionsPage() {
  const getStatusColor = (status: string) => {
    switch (status) {
      case "Verified": return "default";
      case "Rejected": return "destructive";
      default: return "secondary";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Student Submissions</h2>
          <p className="text-muted-foreground">Review and verify student work</p>
        </div>
      </div>

      <div className="flex gap-4 mb-6">
        <Input placeholder="Search submissions..." className="max-w-sm" />
        <Button variant="outline">Filter by Status</Button>
      </div>

      <div className="grid gap-4">
        {mockSubmissions.map((submission) => (
          <Card key={submission.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-lg">{submission.taskTitle}</CardTitle>
                  <div className="flex items-center gap-2 mt-2">
                    <Avatar className="h-6 w-6">
                      <AvatarImage src="" />
                      <AvatarFallback className="text-xs">
                        {submission.studentName.split(' ').map(n => n[0]).join('')}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-muted-foreground">{submission.studentName}</span>
                  </div>
                </div>
                <Badge variant={getStatusColor(submission.status)}>
                  {submission.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm">{submission.notes}</p>
                
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      Submitted {submission.submittedDate}
                    </div>
                    <div className="flex items-center gap-1">
                      <User className="h-4 w-4" />
                      {submission.studentEmail}
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <a href={submission.proofUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-4 w-4 mr-1" />
                        View Proof
                      </a>
                    </Button>
                    
                    {submission.status === "Under Review" && (
                      <>
                        <Button variant="outline" size="sm" className="text-destructive">
                          Reject
                        </Button>
                        <Button size="sm">
                          Verify
                        </Button>
                      </>
                    )}
                    
                    <Button variant="ghost" size="sm">
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}