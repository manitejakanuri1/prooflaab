
import { Card, CardContent } from "@/components/ui/card";
import { Calendar, FileText, Clock, CheckCircle, XCircle } from "lucide-react";
import { format } from "date-fns";
import { ProofUpload } from "@/hooks/useProofUploads";

interface ProofDetailsProps {
  proof: ProofUpload;
}

export default function ProofDetails({ proof }: ProofDetailsProps) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Verified': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'Under Review': return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'Rejected': return <XCircle className="h-4 w-4 text-red-500" />;
      default: return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Verified': return 'text-green-600 bg-green-50';
      case 'Under Review': return 'text-yellow-600 bg-yellow-50';
      case 'Rejected': return 'text-red-600 bg-red-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  return (
    <Card className="w-80 shadow-lg border-0 bg-white">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center space-x-2">
          <FileText className="h-4 w-4 text-gray-600" />
          <h3 className="font-semibold text-gray-900 truncate">
            {proof.tasks?.title || 'Task'}
          </h3>
        </div>
        
        <div className="flex items-center space-x-2">
          <Calendar className="h-4 w-4 text-gray-500" />
          <span className="text-sm text-gray-600">
            {format(new Date(proof.submitted_at), 'MMM dd, yyyy • hh:mm a')}
          </span>
        </div>

        <div className={`flex items-center space-x-2 px-2 py-1 rounded-md ${getStatusColor(proof.status)}`}>
          {getStatusIcon(proof.status)}
          <span className="text-sm font-medium">{proof.status}</span>
        </div>

        {proof.submission_notes && (
          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs text-gray-600 leading-relaxed">
              {proof.submission_notes}
            </p>
          </div>
        )}

        {proof.file_url && (
          <div className="pt-2">
            <a 
              href={proof.file_url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:text-blue-800 underline"
            >
              View uploaded file
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
