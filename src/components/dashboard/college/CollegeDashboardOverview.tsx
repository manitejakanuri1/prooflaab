import { useState, useEffect } from "react";
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
  XCircle,
  Download
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface StudentRecord {
  name: string;
  email: string;
  branch: string;
  year_of_study: string;
  preferred_skills: string;
  key_interests: string;
  career_goals: string;
}

interface ProcessResult {
  record: StudentRecord;
  status: 'success' | 'duplicate' | 'error';
  message: string;
}

interface CollegeDashboardOverviewProps {
  onNavigate?: (tab: string) => void;
}

const CollegeDashboardOverview = ({ onNavigate }: CollegeDashboardOverviewProps) => {
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

  // Proper CSV parser that handles quoted fields
  const parseCSVRow = (row: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      const nextChar = row[i + 1];
      
      if (char === '"' && inQuotes && nextChar === '"') {
        // Handle escaped quotes
        current += '"';
        i++; // Skip next quote
      } else if (char === '"') {
        // Toggle quote state
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        // End of field
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    // Add the last field
    result.push(current.trim());
    return result;
  };

  const parseCSV = (text: string): StudentRecord[] => {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length === 0) throw new Error("CSV file is empty");
    
    const headers = parseCSVRow(lines[0]).map(h => h.trim().toLowerCase());
    
    // Validate headers
    const requiredHeaders = ['name', 'email', 'branch', 'year_of_study', 'preferred_skills', 'key_interests', 'career_goals'];
    const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
    if (missingHeaders.length > 0) {
      throw new Error(`Missing required columns: ${missingHeaders.join(', ')}`);
    }

    const records: StudentRecord[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVRow(lines[i]);
      if (values.length >= headers.length) {
        const nameIndex = headers.indexOf('name');
        const emailIndex = headers.indexOf('email');
        const branchIndex = headers.indexOf('branch');
        const yearOfStudyIndex = headers.indexOf('year_of_study');
        const preferredSkillsIndex = headers.indexOf('preferred_skills');
        const keyInterestsIndex = headers.indexOf('key_interests');
        const careerGoalsIndex = headers.indexOf('career_goals');

        records.push({
          name: values[nameIndex] || '',
          email: values[emailIndex] || '',
          branch: values[branchIndex] || '',
          year_of_study: values[yearOfStudyIndex] || '',
          preferred_skills: values[preferredSkillsIndex] || '',
          key_interests: values[keyInterestsIndex] || '',
          career_goals: values[careerGoalsIndex] || ''
        });
      }
    }
    return records;
  };

  const validateRecord = (record: StudentRecord): string | null => {
    console.log('Validating record:', record);
    
    if (!record.name.trim()) return "Name is required";
    if (!record.email.trim()) return "Email is required";
    // Branch and other fields are optional since they can be filled later
    
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

      // Process all valid records through Edge Function
      const studentsToProcess = records.filter(record => !validateRecord(record));
      
        if (studentsToProcess.length === 0) {
        setResults([{ 
          record: { 
            name: '', 
            email: '', 
            branch: '', 
            year_of_study: '', 
            preferred_skills: '', 
            key_interests: '', 
            career_goals: '' 
          }, 
          status: 'error', 
          message: 'No valid records to process' 
        }]);
        return;
      }

      console.log('Calling Edge Function to create student users...');
      
      // Get current college ID to pass to the edge function
      const { data: { user } } = await supabase.auth.getUser();
      const { data: collegeData } = await supabase
        .from('colleges')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!collegeData) {
        throw new Error('College not found for current user');
      }
      
      const { data: functionResult, error: functionError } = await supabase.functions.invoke('create-student-users', {
        body: {
          college_id: collegeData.id,
          students: studentsToProcess.map(record => ({
            name: record.name,
            email: record.email,
            branch: record.branch,
            year_of_study: record.year_of_study,
            preferred_skills: record.preferred_skills,
            key_interests: record.key_interests,
            career_goals: record.career_goals
          }))
        }
      });

      if (functionError) {
        console.error('Edge Function error:', functionError);
        toast({
          title: "Error",
          description: `Failed to process students: ${functionError.message}`,
          variant: "destructive"
        });
        return;
      }

      // Convert Edge Function results to our format
      const functionResults = functionResult?.results || [];
      const processResults: ProcessResult[] = functionResults.map((result: any) => {
        const originalRecord = records.find(r => r.email === result.email);
        return {
          record: originalRecord || { 
            name: '', 
            email: result.email, 
            branch: '', 
            year_of_study: '', 
            preferred_skills: '', 
            key_interests: '', 
            career_goals: '' 
          },
          status: result.status,
          message: result.message
        };
      });

      // Add any records that weren't processed due to validation errors
      for (const record of records) {
        const validationError = validateRecord(record);
        if (validationError) {
          processResults.push({
            record,
            status: 'error',
            message: validationError
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

  const [stats, setStats] = useState({
    totalStudents: 0,
    tasksAssigned: 0,
    proofsReceived: 0,
    verifiedProofs: 0,
  });

  // Fetch real stats
  useEffect(() => {
    const fetchStats = async () => {
      try {
        // Get current college ID first
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: collegeData } = await supabase
          .from('colleges')
          .select('id')
          .eq('user_id', user.id)
          .single();

        if (!collegeData) return;

        // Fetch students belonging to this college only
        const { data: students } = await supabase
          .from('student_profiles')
          .select('id')
          .eq('college_id', collegeData.id);
        
        // Fetch total tasks assigned to college students
        const studentIds = students?.map(s => s.id) || [];
        let taskCount = 0;
        let proofCount = 0;
        let verifiedCount = 0;

        if (studentIds.length > 0) {
          const { data: tasks } = await supabase
            .from('tasks')
            .select('id')
            .in('student_id', studentIds);
          
          const { data: proofs } = await supabase
            .from('proof_uploads')
            .select('id, status')
            .in('student_id', studentIds);
          
          taskCount = tasks?.length || 0;
          proofCount = proofs?.length || 0;
          verifiedCount = proofs?.filter(p => p.status === 'Verified').length || 0;
        }
        
        setStats({
          totalStudents: students?.length || 0,
          tasksAssigned: taskCount,
          proofsReceived: proofCount,
          verifiedProofs: verifiedCount,
        });
      } catch (error) {
        console.error('Error fetching stats:', error);
      }
    };

    fetchStats();
  }, [results]); // Refetch when CSV processing results change

  const quickStats = [
    {
      title: "Total Students Onboarded",
      value: stats.totalStudents.toString(),
      icon: Users,
      color: "text-blue-600",
      bgColor: "bg-blue-100",
      navigateTo: "students",
    },
    {
      title: "Tasks Assigned",
      value: stats.tasksAssigned.toString(),
      icon: ClipboardList,
      color: "text-green-600",
      bgColor: "bg-green-100",
      navigateTo: "assign-tasks",
    },
    {
      title: "Proofs Received",
      value: stats.proofsReceived.toString(),
      icon: Upload,
      color: "text-orange-600",
      bgColor: "bg-orange-100",
      navigateTo: "uploaded-proofs",
    },
    {
      title: "Verified Proofs",
      value: stats.verifiedProofs.toString(),
      icon: FileCheck,
      color: "text-purple-600",
      bgColor: "bg-purple-100",
      navigateTo: "uploaded-proofs",
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

  const downloadCSVTemplate = () => {
    const csvContent = `Name,Email,Branch,Year_of_study,Preferred_skills,Key_interests,Career_goals
John Doe,john@example.com,Computer Science,Third Year,Python Web Development,AI Research,Machine Learning Engineer`;
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', 'student_onboarding_template.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast({
      title: "Template downloaded successfully ✅",
      description: "Use this file to format your student list correctly.",
      duration: 3000,
    });
  };

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="bg-gradient-to-r from-orange-100 to-yellow-100 dark:from-gray-800 dark:to-gray-700 p-6 rounded-2xl border border-orange-200/30 dark:border-gray-600">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">
          Welcome to Your College Dashboard
        </h2>
        <p className="text-gray-600 dark:text-gray-300">
          Manage student onboarding, assign tasks, and track proof-of-work performance.
        </p>
      </div>

      {/* Quick Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        {quickStats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <Card 
              key={index} 
              className="border border-gray-200/50 dark:border-gray-700 shadow-sm hover:shadow-md transition-all cursor-pointer dark:bg-gray-800 hover:scale-105"
              onClick={() => onNavigate?.(stat.navigateTo)}
            >
              <CardContent className="p-4 md:p-6">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs md:text-sm font-medium text-gray-600 dark:text-gray-400 mb-1 truncate">
                      {stat.title}
                    </p>
                    <p className="text-xl md:text-3xl font-bold text-gray-900 dark:text-gray-100">
                      {stat.value}
                    </p>
                  </div>
                  <div className={`p-2 md:p-3 rounded-lg ${stat.bgColor} dark:bg-gray-700 flex-shrink-0`}>
                    <Icon className={`h-4 w-4 md:h-6 md:w-6 ${stat.color} dark:text-gray-300`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* CSV Upload Section */}
      <Card className="border border-gray-200/50 dark:border-gray-700 shadow-sm dark:bg-gray-800">
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center space-x-2">
              <Upload className="h-5 w-5" />
              <span>Student Onboarding - CSV Upload</span>
            </CardTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    onClick={downloadCSVTemplate}
                    className="flex items-center gap-2 text-xs bg-orange-600 hover:bg-orange-700 text-white"
                  >
                    <Download className="h-4 w-4" />
                    Download Template
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Download ready-made CSV template</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-950/30 p-3 md:p-4 rounded-lg border border-blue-200 dark:border-blue-800">
            <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-2 text-sm md:text-base">CSV Format Requirements:</h3>
            <ul className="text-xs md:text-sm text-blue-800 dark:text-blue-200 space-y-1">
              <li>• Column headers: Name, Email, Branch, Year_of_study, Preferred_skills, Key_interests, Career_goals</li>
              <li className="hidden sm:list-item">• Example: John Doe, john@email.com, Computer Science, Second Year, Python Web Development, AI Machine Learning, Software Engineer</li>
              <li>• Make sure all email addresses are unique</li>
            </ul>
            <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">
              💡 Use the template above to correctly format your student list before uploading.
            </p>
          </div>

          <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 md:p-8 text-center">
            <label htmlFor="csv-upload" className={`inline-block ${!isProcessing ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
              <Upload className="mx-auto h-8 w-8 md:h-12 md:w-12 text-gray-400 mb-2 md:mb-4 hover:text-orange-600 transition-colors" />
            </label>
            <h3 className="text-base md:text-lg font-medium text-gray-900 mb-1 md:mb-2">
              Upload Student Records
            </h3>
            <p className="text-sm md:text-base text-gray-600 mb-3 md:mb-4">
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
              <Button className="cursor-pointer bg-orange-600 hover:bg-orange-700 text-white" asChild disabled={isProcessing}>
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
                      <TableHead>Year of Study</TableHead>
                      <TableHead>Preferred Skills</TableHead>
                      <TableHead>Key Interests</TableHead>
                      <TableHead>Career Goals</TableHead>
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
                        <TableCell>{result.record.year_of_study}</TableCell>
                        <TableCell className="max-w-32 truncate">{result.record.preferred_skills}</TableCell>
                        <TableCell className="max-w-32 truncate">{result.record.key_interests}</TableCell>
                        <TableCell className="max-w-32 truncate">{result.record.career_goals}</TableCell>
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
                      <TableHead>Year of Study</TableHead>
                      <TableHead>Preferred Skills</TableHead>
                      <TableHead>Key Interests</TableHead>
                      <TableHead>Career Goals</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-gray-500">
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