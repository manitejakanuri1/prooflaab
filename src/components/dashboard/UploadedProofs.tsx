
import { FileText, Download, Eye } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Proof {
  id: string;
  taskTitle: string;
  submissionDate: string;
  status: 'Verified' | 'Under Review' | 'Rejected';
}

interface UploadedProofsProps {
  proofs: Proof[];
}

export default function UploadedProofs({ proofs }: UploadedProofsProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Verified': return 'bg-green-100 text-green-800';
      case 'Under Review': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-red-100 text-red-800';
    }
  };

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">📂 Uploaded Proofs</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {proofs.map((proof) => (
            <div key={proof.id} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-blue-600" />
                  <div>
                    <h3 className="font-medium text-gray-900">{proof.taskTitle}</h3>
                    <p className="text-sm text-gray-600">Submitted: {proof.submissionDate}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(proof.status)}`}>
                    {proof.status}
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline">
                      <Eye className="h-4 w-4 mr-1" />
                      View
                    </Button>
                    <Button size="sm" variant="outline">
                      <Download className="h-4 w-4 mr-1" />
                      Download
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
