import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  Upload, 
  Users, 
  ClipboardList, 
  FileCheck, 
  AlertCircle,
  Loader2,
  CheckCircle,
  XCircle
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface StudentRecord {
  name: string;
  email: string;
  branch: string;
  batch: string;
}

interface ProcessResult {
  record: StudentRecord;
  status: 'success' | 'duplicate' | 'error';
  message: string;
}

const CollegeDashboardOverview = () => {
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [results, setResults] = useState<ProcessResult[]>([]);
  const { toast } = useToast();

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === "text/csv") {
      setCsvFile(file);
      setUploadStatus("File selected: " + file.name);
      setResults([]); // Clear previous results
    } else {
      setUploadStatus("Please select a valid CSV file");
    }
  };

  const parseCSV = (text: string): StudentRecord[] => {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length === 0) throw new Error("CSV file is empty");
    
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    
    // Validate headers
    const requiredHeaders = ['name', 'email', 'branch', 'batch'];
    const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
    if (missingHeaders.length > 0) {
      throw new Error(`Missing required columns: ${missingHeaders.join(', ')}`);
    }

    const records: StudentRecord[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      if (values.length >= 4) {
        const nameIndex = headers.indexOf('name');
        const emailIndex = headers.indexOf('email');
        const branchIndex = headers.indexOf('branch');
        const batchIndex = headers.indexOf('batch');

        records.push({
          name: values[nameIndex] || '',
          email: values[emailIndex] || '',
          branch: values[branchIndex] || '',
          batch: values[batchIndex] || ''
        });
      }
    }
    return records;
  };

  const validateRecord = (record: StudentRecord): string | null => {
    console.log('Validating record:', record);
    
    if (!record.name.trim()) return "Name is required";
    if (!record.email.trim()) return "Email is required";
    // Make branch and batch optional since they can be filled later
    // if (!record.branch.trim()) return "Branch is required";
    // if (!record.batch.trim()) return "Batch is required";
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(record.email)) return "Invalid email format";
    
    return null;
  };

  const processCSV = async () => {
    if (!csvFile) {
      toast({
        title: "Error",
        description: "Please select a CSV file first",
        variant: "destructive"
      });
      return;
    }

    setIsProcessing(true);
    setResults([]);

    try {
      console.log('Starting CSV processing...');
      const text = await csvFile.text();
      console.log('CSV text:', text);
      const records = parseCSV(text);
      console.log('Parsed records:', records);
      
      if (records.length === 0) {
        throw new Error("No valid records found in CSV");
      }

      const processResults: ProcessResult[] = [];
      const processedEmails = new Set<string>();

      for (const record of records) {
        // Validate record
        const validationError = validateRecord(record);
        if (validationError) {
          processResults.push({
            record,
            status: 'error',
            message: validationError
          });
          continue;
        }

        // Check for duplicates within the CSV
        if (processedEmails.has(record.email.toLowerCase())) {
          processResults.push({
            record,
            status: 'duplicate',
            message: 'Duplicate email in CSV'
          });
          continue;
        }

        try {
          console.log('Processing record:', record);
          
          // Check if user already exists in database
          const { data: existingProfile } = await supabase
            .from('student_profiles')
            .select('email')
            .eq('email', record.email.toLowerCase())
            .maybeSingle();

          if (existingProfile) {
            console.log('Email already exists:', record.email);
            processResults.push({
              record,
              status: 'duplicate',
              message: 'Email already exists in database'
            });
            continue;
          }

          // Create student profile directly (without auth user for now)
          // Students will create their auth accounts later when they first log in
          const profileData = {
            user_id: crypto.randomUUID(), // Temporary UUID until they create auth account
            email: record.email.toLowerCase(),
            full_name: record.name,
            branch: record.branch || '',
            batch: record.batch || ''
          };
          
          console.log('Inserting profile data:', profileData);
          
          const { data: insertedProfile, error: profileError } = await supabase
            .from('student_profiles')
            .insert(profileData)
            .select()
            .single();

          if (profileError) {
            console.log('Profile creation error:', profileError);
            processResults.push({
              record,
              status: 'error',
              message: `Database error: ${profileError.message}`
            });
            continue;
          }

          console.log('Student profile created:', insertedProfile);
          
          processResults.push({
            record,
            status: 'success',
            message: 'Student record created successfully'
          });

          processedEmails.add(record.email.toLowerCase());

        } catch (error) {
          console.log('Unexpected error:', error);
          processResults.push({
            record,
            status: 'error',
            message: `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`
          });
        }
      }

      setResults(processResults);
      
      const successCount = processResults.filter(r => r.status === 'success').length;
      const errorCount = processResults.filter(r => r.status === 'error').length;
      const duplicateCount = processResults.filter(r => r.status === 'duplicate').length;

      toast({
        title: "CSV Processing Complete",
        description: `${successCount} created, ${duplicateCount} duplicates, ${errorCount} errors`,
      });

    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to process CSV",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'duplicate':
        return <AlertCircle className="h-4 w-4 text-yellow-600" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-600" />;
      default:
        return null;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'success':
        return 'Success';
      case 'duplicate':
        return 'Duplicate';
      case 'error':
        return 'Error';
      default:
        return '';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'text-green-600';
      case 'duplicate':
        return 'text-yellow-600';
      case 'error':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

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
              disabled={isProcessing}
            />
            <label htmlFor="csv-upload">
              <Button variant="outline" className="cursor-pointer" asChild disabled={isProcessing}>
                <span>Choose CSV File</span>
              </Button>
            </label>
            
            {uploadStatus && (
              <p className="mt-3 text-sm text-gray-600">{uploadStatus}</p>
            )}
          </div>

          {csvFile && (
            <div className="flex justify-center">
              <Button 
                onClick={processCSV} 
                className="bg-orange-600 hover:bg-orange-700"
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing CSV...
                  </>
                ) : (
                  'Process CSV & Create Student Accounts'
                )}
              </Button>
            </div>
          )}

          {/* Results Table */}
          {results.length > 0 && (
            <div className="mt-6">
              <h4 className="font-medium text-gray-900 mb-3">Upload Results</h4>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>Batch</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Message</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((result, index) => (
                      <TableRow key={index}>
                        <TableCell>{result.record.name}</TableCell>
                        <TableCell>{result.record.email}</TableCell>
                        <TableCell>{result.record.branch}</TableCell>
                        <TableCell>{result.record.batch}</TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            {getStatusIcon(result.status)}
                            <span className={getStatusColor(result.status)}>
                              {getStatusText(result.status)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {result.message}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Sample Data Table - Show when no results */}
          {results.length === 0 && (
            <div className="mt-6">
              <h4 className="font-medium text-gray-900 mb-3">Upload Status</h4>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>Batch</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-gray-500">
                        No data uploaded yet
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CollegeDashboardOverview;