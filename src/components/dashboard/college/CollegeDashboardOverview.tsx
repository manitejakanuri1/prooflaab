import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, Users, ClipboardList, FileCheck, Shield } from "lucide-react";

const CollegeDashboardOverview = () => {
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string>("");

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === "text/csv") {
      setCsvFile(file);
      setUploadStatus("File selected: " + file.name);
    } else {
      setUploadStatus("Please select a valid CSV file");
    }
  };

  const processCSV = () => {
    if (csvFile) {
      setUploadStatus("Processing CSV... (Feature coming soon)");
    }
  };

  const quickStats = [
    {
      title: "Total Students Onboarded",
      value: "0",
      icon: Users,
      color: "text-blue-600",
      bgColor: "bg-blue-100",
    },
    {
      title: "Tasks Assigned",
      value: "0",
      icon: ClipboardList,
      color: "text-green-600",
      bgColor: "bg-green-100",
    },
    {
      title: "Proofs Received",
      value: "0",
      icon: Upload,
      color: "text-orange-600",
      bgColor: "bg-orange-100",
    },
    {
      title: "Verified Proofs",
      value: "0",
      icon: FileCheck,
      color: "text-purple-600",
      bgColor: "bg-purple-100",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="bg-gradient-to-r from-orange-100 to-yellow-100 p-6 rounded-2xl border border-orange-200/30">
        <h2 className="text-2xl font-bold text-gray-800 mb-2">
          Welcome to Your College Dashboard
        </h2>
        <p className="text-gray-600">
          Manage student onboarding, assign tasks, and track proof-of-work performance.
        </p>
      </div>

      {/* Quick Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {quickStats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <Card key={index} className="border border-gray-200/50 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-1">
                      {stat.title}
                    </p>
                    <p className="text-3xl font-bold text-gray-900">
                      {stat.value}
                    </p>
                  </div>
                  <div className={`p-3 rounded-lg ${stat.bgColor}`}>
                    <Icon className={`h-6 w-6 ${stat.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* CSV Upload Section */}
      <Card className="border border-gray-200/50 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Upload className="h-5 w-5" />
            <span>Student Onboarding - CSV Upload</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <h3 className="font-medium text-blue-900 mb-2">CSV Format Requirements:</h3>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Column headers: Name, Email, Branch, Batch</li>
              <li>• Example: John Doe, john@email.com, Computer Science, 2024</li>
              <li>• Make sure all email addresses are unique</li>
            </ul>
          </div>

          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Upload Student Records
            </h3>
            <p className="text-gray-600 mb-4">
              Select a CSV file containing student information
            </p>
            
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
              id="csv-upload"
            />
            <label htmlFor="csv-upload">
              <Button variant="outline" className="cursor-pointer" asChild>
                <span>Choose CSV File</span>
              </Button>
            </label>
            
            {uploadStatus && (
              <p className="mt-3 text-sm text-gray-600">{uploadStatus}</p>
            )}
          </div>

          {csvFile && (
            <div className="flex justify-center">
              <Button onClick={processCSV} className="bg-orange-600 hover:bg-orange-700">
                Process CSV & Create Student Accounts
              </Button>
            </div>
          )}

          {/* Sample Data Table */}
          <div className="mt-6">
            <h4 className="font-medium text-gray-900 mb-3">Upload Status (Sample)</h4>
            <div className="overflow-x-auto">
              <table className="w-full border border-gray-200 rounded-lg">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-900">Name</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-900">Email</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-900">Branch</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-900">Batch</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-900">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  <tr className="text-sm text-gray-500">
                    <td className="px-4 py-3" colSpan={5}>No data uploaded yet</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default CollegeDashboardOverview;