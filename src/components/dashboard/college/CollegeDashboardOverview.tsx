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
// xlsx is loaded on demand (see parseSpreadsheet / downloadCSVTemplate) so this
// large library isn't part of the initial College dashboard bundle.
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
    // Accept Excel (.xlsx/.xls) and CSV — validate by extension since browsers
    // report inconsistent MIME types for spreadsheets.
    const isSpreadsheet = file && /\.(xlsx|xls|csv)$/i.test(file.name);
    if (isSpreadsheet) {
      setCsvFile(file);
      setUploadStatus("File selected: " + file.name);
      setResults([]); // Clear previous results
    } else {
      setUploadStatus("Please select a valid Excel (.xlsx) or CSV file");
    }
  };

  // Parse an Excel (.xlsx/.xls) OR CSV file via SheetJS. Headers are matched
  // case-insensitively and tolerate spaces or underscores (e.g. "Year of study"
  // and "year_of_study" both work).
  const parseSpreadsheet = async (file: File): Promise<StudentRecord[]> => {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const workbook = XLSX.read(buf, { type: "array" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) throw new Error("The file has no readable sheet");

    // Row objects keyed by the header cells of the first row.
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
      defval: "",
      raw: false,
    });
    if (rows.length === 0) throw new Error("The file has no data rows");

    // Normalise a header like "Year of study" / "Year_of_study" -> "year_of_study".
    const norm = (k: string) => k.trim().toLowerCase().replace(/\s+/g, "_");

    // Confirm the required identity columns exist.
    const headerKeys = Object.keys(rows[0]).map(norm);
    for (const required of ["name", "email"]) {
      if (!headerKeys.includes(required)) {
        throw new Error(`Missing required column: "${required}"`);
      }
    }

    const pick = (row: Record<string, unknown>, field: string): string => {
      for (const key of Object.keys(row)) {
        if (norm(key) === field) return String(row[key] ?? "").trim();
      }
      return "";
    };

    return rows
      .map((row) => ({
        name: pick(row, "name"),
        email: pick(row, "email"),
        branch: pick(row, "branch"),
        year_of_study: pick(row, "year_of_study"),
        preferred_skills: pick(row, "preferred_skills"),
        key_interests: pick(row, "key_interests"),
        career_goals: pick(row, "career_goals"),
      }))
      // Drop completely blank rows (common trailing rows in spreadsheets).
      .filter((r) => r.name || r.email);
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
        description: "Please select an Excel or CSV file first",
        variant: "destructive"
      });
      return;
    }

    setIsProcessing(true);
    setResults([]);

    try {
      const records = await parseSpreadsheet(csvFile);

      if (records.length === 0) {
        throw new Error("No valid records found in the file");
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
          origin: window.location.origin,
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
        title: "Upload Complete",
        description: `${successCount} created, ${duplicateCount} duplicates, ${errorCount} errors`,
      });

    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to process file",
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

  const downloadCSVTemplate = async () => {
    const XLSX = await import("xlsx");
    const rows = [
      ["Name", "Email", "Branch", "Year_of_study", "Preferred_skills", "Key_interests", "Career_goals"],
      ["John Doe", "john@example.com", "Computer Science", "Third Year", "Python, Web Development", "AI Research", "Machine Learning Engineer"],
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Students");
    XLSX.writeFile(workbook, "student_onboarding_template.xlsx");

    toast({
      title: "Template downloaded successfully ✅",
      description: "Fill this Excel file with your student list and upload it.",
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 lg:gap-6">
        {quickStats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <Card 
              key={index} 
              className="border border-gray-200/50 dark:border-gray-700 shadow-sm hover:shadow-md transition-all cursor-pointer dark:bg-gray-800 hover:scale-105"
              onClick={() => onNavigate?.(stat.navigateTo)}
            >
              <CardContent className="p-3 md:p-4 lg:p-6">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs md:text-sm font-medium text-gray-600 dark:text-gray-400 mb-1 truncate">
                      {stat.title}
                    </p>
                    <p className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 dark:text-gray-100">
                      {stat.value}
                    </p>
                  </div>
                  <div className={`p-2 md:p-3 rounded-lg ${stat.bgColor} dark:bg-gray-700 flex-shrink-0`}>
                    <Icon className={`h-5 w-5 md:h-6 md:w-6 ${stat.color} dark:text-gray-300`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* CSV Upload Section */}
      <Card className="border border-gray-200/50 dark:border-gray-700 shadow-sm dark:bg-gray-800">
        <CardHeader className="p-3 md:p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <CardTitle className="flex items-center space-x-2 text-base md:text-lg">
              <Upload className="h-4 w-4 md:h-5 md:w-5" />
              <span>Student Onboarding - Excel / CSV Upload</span>
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
                  <p>Download ready-made Excel template</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-3 md:p-6">
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

          <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-4 md:p-8 text-center">
            <label htmlFor="csv-upload" className={`inline-block ${!isProcessing ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
              <Upload className="mx-auto h-8 w-8 md:h-12 md:w-12 text-gray-400 dark:text-gray-500 mb-2 md:mb-4 hover:text-orange-600 transition-colors" />
            </label>
            <h3 className="text-base md:text-lg font-medium text-gray-900 dark:text-gray-100 mb-1 md:mb-2">
              Upload Student Records
            </h3>
            <p className="text-sm md:text-base text-gray-600 dark:text-gray-400 mb-3 md:mb-4">
              Select an Excel (.xlsx) or CSV file containing student information
            </p>

            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              className="hidden"
              id="csv-upload"
              disabled={isProcessing}
            />
            <label htmlFor="csv-upload">
              <Button className="cursor-pointer bg-orange-600 hover:bg-orange-700 text-white" asChild disabled={isProcessing}>
                <span>Choose Excel / CSV File</span>
              </Button>
            </label>
            
            {uploadStatus && (
              <p className="mt-3 text-xs md:text-sm text-gray-600 dark:text-gray-400">{uploadStatus}</p>
            )}
          </div>

          {csvFile && (
            <div className="flex justify-center">
              <Button 
                onClick={processCSV} 
                className="w-full sm:w-auto bg-orange-600 hover:bg-orange-700"
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

          {/* Results Table - Mobile Responsive */}
          {results.length > 0 && (
            <div className="mt-6 space-y-3">
              <h4 className="font-medium text-gray-900 dark:text-gray-100 text-sm md:text-base">Upload Results</h4>
              <div className="rounded-md border overflow-x-auto -mx-3 md:mx-0">
                <div className="min-w-full inline-block align-middle">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[120px]">Name</TableHead>
                        <TableHead className="min-w-[150px]">Email</TableHead>
                        <TableHead className="min-w-[100px] hidden sm:table-cell">Branch</TableHead>
                        <TableHead className="min-w-[100px] hidden md:table-cell">Year of Study</TableHead>
                        <TableHead className="min-w-[120px] hidden lg:table-cell">Preferred Skills</TableHead>
                        <TableHead className="min-w-[120px] hidden lg:table-cell">Key Interests</TableHead>
                        <TableHead className="min-w-[120px] hidden xl:table-cell">Career Goals</TableHead>
                        <TableHead className="min-w-[80px]">Status</TableHead>
                        <TableHead className="min-w-[150px]">Message</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.map((result, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium text-sm">{result.record.name}</TableCell>
                          <TableCell className="text-xs md:text-sm">{result.record.email}</TableCell>
                          <TableCell className="hidden sm:table-cell text-sm">{result.record.branch}</TableCell>
                          <TableCell className="hidden md:table-cell text-sm">{result.record.year_of_study}</TableCell>
                          <TableCell className="hidden lg:table-cell max-w-32 truncate text-sm">{result.record.preferred_skills}</TableCell>
                          <TableCell className="hidden lg:table-cell max-w-32 truncate text-sm">{result.record.key_interests}</TableCell>
                          <TableCell className="hidden xl:table-cell max-w-32 truncate text-sm">{result.record.career_goals}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {getStatusIcon(result.status)}
                              <span className={`text-xs md:text-sm font-medium ${getStatusColor(result.status)}`}>
                                {getStatusText(result.status)}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs md:text-sm text-gray-600 dark:text-gray-400">
                            {result.message}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}

          {/* Sample Data Table - Show when no results */}
          {results.length === 0 && (
            <div className="mt-6">
              <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-3 text-sm md:text-base">Upload Status</h4>
              <div className="rounded-md border overflow-x-auto -mx-3 md:mx-0">
                <div className="min-w-full inline-block align-middle">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[120px]">Name</TableHead>
                        <TableHead className="min-w-[150px]">Email</TableHead>
                        <TableHead className="min-w-[100px] hidden sm:table-cell">Branch</TableHead>
                        <TableHead className="min-w-[100px] hidden md:table-cell">Year of Study</TableHead>
                        <TableHead className="min-w-[120px] hidden lg:table-cell">Preferred Skills</TableHead>
                        <TableHead className="min-w-[120px] hidden lg:table-cell">Key Interests</TableHead>
                        <TableHead className="min-w-[120px] hidden xl:table-cell">Career Goals</TableHead>
                        <TableHead className="min-w-[80px]">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-gray-500 dark:text-gray-400 py-8">
                          No data uploaded yet
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default CollegeDashboardOverview;