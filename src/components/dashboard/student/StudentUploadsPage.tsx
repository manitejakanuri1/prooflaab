import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useProofUploads } from "@/hooks/useProofUploads";
import { format } from "date-fns";
import { Download, Eye, FileText, Upload as UploadIcon } from "lucide-react";

const StudentUploadsPage = () => {
  const currentDate = new Date();
  const { data: uploads, isLoading, error } = useProofUploads(currentDate);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Uploads</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Uploads</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-red-500">Error loading uploads. Please try again.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Under Review':
        return 'bg-yellow-100 text-yellow-800';
      case 'Verified':
        return 'bg-green-100 text-green-800';
      case 'Rejected':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Verified':
        return '✅';
      case 'Rejected':
        return '❌';
      default:
        return '⏳';
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">My Uploads</CardTitle>
        </CardHeader>
        <CardContent>
          {!uploads || uploads.length === 0 ? (
            <div className="text-center py-8">
              <UploadIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No uploads yet</h3>
              <p className="text-gray-500">Your proof submissions will appear here once you start uploading.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task Title</TableHead>
                    <TableHead>Upload Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead>Feedback</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uploads.map((upload) => (
                    <TableRow key={upload.id}>
                      <TableCell>
                        <div className="font-medium text-gray-900">
                          {upload.tasks?.title || 'Unknown Task'}
                        </div>
                        {upload.submission_notes && (
                          <div className="text-sm text-gray-500 mt-1">
                            Notes: {upload.submission_notes.substring(0, 50)}
                            {upload.submission_notes.length > 50 ? '...' : ''}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {format(new Date(upload.submitted_at), "MMM dd, yyyy")}
                        </div>
                        <div className="text-xs text-gray-500">
                          {format(new Date(upload.submitted_at), "h:mm a")}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(upload.status)}>
                          {getStatusIcon(upload.status)} {upload.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {upload.file_url ? (
                          <div className="flex items-center space-x-2">
                            <FileText className="h-4 w-4 text-gray-400" />
                            <span className="text-sm text-gray-600">
                              {upload.file_url.split('/').pop() || 'File'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">No file</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {upload.review_comment ? (
                          <div className="max-w-xs">
                            <p className="text-sm text-gray-600 truncate">
                              {upload.review_comment}
                            </p>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">
                            {upload.status === 'Under Review' ? 'Pending review' : 'No feedback'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end space-x-2">
                          {upload.file_url && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => window.open(upload.file_url!, '_blank')}
                              >
                                <Eye className="h-4 w-4 mr-1" />
                                View
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const link = document.createElement('a');
                                  link.href = upload.file_url!;
                                  link.download = upload.file_url!.split('/').pop() || 'file';
                                  link.click();
                                }}
                              >
                                <Download className="h-4 w-4 mr-1" />
                                Download
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default StudentUploadsPage;