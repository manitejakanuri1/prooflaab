import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useProofUploads } from "@/hooks/useProofUploads";
import { format, isValid } from "date-fns";
import { Download, Eye, FileText, Upload as UploadIcon, Search, Filter, CheckCircle, Clock, XCircle, Brain } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import ConceptualQuestionsModal from "./ConceptualQuestionsModal";
import AppealSubmissionModal from "./AppealSubmissionModal";
import { ReflectionModal } from "../ReflectionModal";
import { useReflectionRequest } from "@/hooks/useReflectionRequest";
import { useAuth } from "@/contexts/AuthContext";
import ProofFileButton from "@/components/proof/ProofFileButton";
import { hasOpenableProof, proofFileLabel } from "@/lib/proofFile";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import StudentVoiceExplanationsCard from "./StudentVoiceExplanationsCard";

const StudentUploadsPage = () => {
  const currentDate = new Date();
  const { data: uploads, isLoading, error, refetch } = useProofUploads(currentDate);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [sortBy, setSortBy] = useState("Newest First");
  const [conceptualTests, setConceptualTests] = useState<Record<string, any>>({});
  const [selectedProofId, setSelectedProofId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [appealModalOpen, setAppealModalOpen] = useState(false);
  const [appealProofId, setAppealProofId] = useState<string | null>(null);
  const [studentProfileId, setStudentProfileId] = useState<string | null>(null);
  const [reflectionModalOpen, setReflectionModalOpen] = useState(false);
  const [reflectionProofData, setReflectionProofData] = useState<{
    proofId: string;
    conceptualScore?: number;
    trustScore?: number;
  } | null>(null);
  const { user } = useAuth();
  const reflectionMutation = useReflectionRequest();

  // Fetch student profile ID
  useEffect(() => {
    const fetchStudentProfile = async () => {
      if (!user) return;
      const { data } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single();
      
      if (data) setStudentProfileId(data.id);
    };
    fetchStudentProfile();
  }, [user]);

  // Fetch conceptual tests for all proofs
  useEffect(() => {
    if (uploads && uploads.length > 0) {
      fetchConceptualTests();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploads]);

  // Real-time subscription for conceptual test updates
  // Replaces the live subscription below, which cannot work against
  // PostgREST. Paused while the tab is hidden, and refreshes at once when
  // the tab is looked at again.
  useLiveRefresh(() => { void fetchConceptualTests(); void refetch(); });

  useEffect(() => {
    const channel = supabase
      .channel('conceptual_tests_realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conceptual_tests'
        },
        () => {
          fetchConceptualTests();
          refetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchConceptualTests = async () => {
    try {
      const proofIds = uploads?.map(u => u.id) || [];
      if (proofIds.length === 0) return;

      const { data, error } = await supabase
        .from('conceptual_tests')
        .select('proof_id, status')
        .in('proof_id', proofIds);

      if (error) throw error;

      const testsMap: Record<string, any> = {};
      data?.forEach(test => {
        testsMap[test.proof_id] = test;
      });
      setConceptualTests(testsMap);
    } catch (err) {
      console.error('Error fetching conceptual tests:', err);
    }
  };

  const handleOpenQuestions = (proofId: string) => {
    setSelectedProofId(proofId);
    setModalOpen(true);
  };

  const handleSubmitSuccess = () => {
    fetchConceptualTests();
    refetch();
  };

  // Enhanced sorting and filtering logic
  const filteredAndSortedUploads = useMemo(() => {
    if (!uploads) return [];
    
    let filtered = uploads;

    // Apply search filter
    if (searchQuery.trim()) {
      filtered = filtered.filter(upload =>
        (upload.tasks?.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (upload.submission_notes && upload.submission_notes.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (upload.review_comment && upload.review_comment.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }

    // Apply status filter
    if (statusFilter !== "All") {
      filtered = filtered.filter(upload => upload.status === statusFilter);
    }

    // Apply sorting
    const sortedUploads = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "Status Priority": {
          // Group by status: Under Review > Verified > Rejected
          const statusPriority = { "Under Review": 1, "Verified": 2, "Rejected": 3 };
          const priorityDiff = (statusPriority[a.status] || 4) - (statusPriority[b.status] || 4);
          if (priorityDiff !== 0) return priorityDiff;
          // Secondary sort by submission date (newest first)
          return new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime();
        }

        case "Upload Date (ASC)":
          return new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime();

        case "Upload Date (DESC)":
        case "Newest First":
          return new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime();

        case "Task Name (A-Z)": {
          const aTitle = a.tasks?.title || '';
          const bTitle = b.tasks?.title || '';
          return aTitle.localeCompare(bTitle);
        }

        case "Task Name (Z-A)": {
          const aTitleDesc = a.tasks?.title || '';
          const bTitleDesc = b.tasks?.title || '';
          return bTitleDesc.localeCompare(aTitleDesc);
        }

        default:
          return 0;
      }
    });

    return sortedUploads;
  }, [uploads, searchQuery, statusFilter, sortBy]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Uploads</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-muted rounded"></div>
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
            <p className="text-destructive">Error loading uploads. Please try again.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Under Review':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'Verified':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'Rejected':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Verified':
        return <CheckCircle className="h-3 w-3" />;
      case 'Rejected':
        return <XCircle className="h-3 w-3" />;
      case 'Under Review':
        return <Clock className="h-3 w-3" />;
      default:
        return <FileText className="h-3 w-3" />;
    }
  };

  const formatUploadDate = (dateString: string) => {
    const date = new Date(dateString);
    if (!isValid(date)) {
      return {
        date: "Invalid Date",
        time: "Not Set"
      };
    }
    
    return {
      date: format(date, "MMM dd, yyyy"),
      time: format(date, "h:mm a")
    };
  };

  const getFileName = (fileUrl: string | null) => {
    if (!fileUrl) return "No file";
    return fileUrl.split('/').pop() || 'File';
  };

  return (
    <div className="space-y-6">
      <StudentVoiceExplanationsCard />
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold flex items-center gap-2">
            <UploadIcon className="h-5 w-5" />
            My Uploads
            <Badge variant="outline" className="ml-auto">
              {filteredAndSortedUploads.length} uploads
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-col gap-3 p-3 sm:p-4 bg-muted/50 rounded-lg border">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <Input
                placeholder="Search uploads..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
            </div>
            
            <div className="flex flex-wrap items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent className="bg-background border border-border z-50">
                  <SelectItem value="All">All Status</SelectItem>
                  <SelectItem value="Under Review">Under Review</SelectItem>
                  <SelectItem value="Verified">Verified</SelectItem>
                  <SelectItem value="Rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
              
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-full sm:w-[160px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent className="bg-background border border-border z-50">
                  <SelectItem value="Status Priority">Status Priority</SelectItem>
                  <SelectItem value="Newest First">Newest First</SelectItem>
                  <SelectItem value="Upload Date (ASC)">Upload Date (ASC)</SelectItem>
                  <SelectItem value="Upload Date (DESC)">Upload Date (DESC)</SelectItem>
                  <SelectItem value="Task Name (A-Z)">Task Name (A-Z)</SelectItem>
                  <SelectItem value="Task Name (Z-A)">Task Name (Z-A)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {filteredAndSortedUploads.length === 0 ? (
            <div className="text-center py-12">
              <UploadIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                {!uploads || uploads.length === 0 ? "No uploads yet" : "No uploads match your filters"}
              </h3>
              <p className="text-muted-foreground">
                {!uploads || uploads.length === 0 
                  ? "Your proof submissions will appear here once you start uploading."
                  : "Try adjusting your search or filter criteria."
                }
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-3 sm:mx-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-b">
                    <TableHead className="font-semibold text-xs sm:text-sm sticky left-0 bg-background z-10 min-w-[150px]">Task Details</TableHead>
                    <TableHead className="font-semibold text-xs sm:text-sm min-w-[120px]">Upload Date</TableHead>
                    <TableHead className="font-semibold text-xs sm:text-sm min-w-[100px]">Status</TableHead>
                    <TableHead className="font-semibold text-xs sm:text-sm min-w-[120px] hidden sm:table-cell">File</TableHead>
                    <TableHead className="font-semibold text-xs sm:text-sm min-w-[150px] hidden md:table-cell">Feedback</TableHead>
                    <TableHead className="text-right font-semibold text-xs sm:text-sm sticky right-0 bg-background z-10 min-w-[120px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedUploads.map((upload, index) => {
                    const uploadDate = formatUploadDate(upload.submitted_at);
                    return (
                      <TableRow 
                        key={upload.id}
                        className={`border-b border-border hover:bg-muted/30 transition-colors ${
                          index % 2 === 0 ? 'bg-background' : 'bg-muted/20'
                        }`}
                      >
                        <TableCell className="py-4">
                          <div className="space-y-1">
                            <div className="font-medium text-foreground">
                              {upload.tasks?.title || 'Unknown Task'}
                            </div>
                            {upload.submission_notes && (
                              <div className="text-sm text-muted-foreground">
                                Notes: {upload.submission_notes.substring(0, 60)}
                                {upload.submission_notes.length > 60 ? '...' : ''}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-4">
                          <div className="space-y-1">
                            <div className="text-sm text-foreground">
                              {uploadDate.date}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {uploadDate.time}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-4">
                          <Badge 
                            variant="outline" 
                            className={`${getStatusColor(upload.status)} flex items-center gap-1 w-fit`}
                          >
                            {getStatusIcon(upload.status)}
                            {upload.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-4">
                          {upload.file_url || upload.file_path ? (
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm text-foreground max-w-[150px] truncate">
                                {proofFileLabel(upload)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">No file</span>
                          )}
                        </TableCell>
                        <TableCell className="py-4">
                          {upload.review_comment ? (
                            <div className="max-w-xs">
                              <p className="text-sm text-foreground truncate" title={upload.review_comment}>
                                {upload.review_comment}
                              </p>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              {upload.status === 'Under Review' ? 'Pending review' : 'No feedback'}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right py-4">
                          <div className="flex justify-end gap-2 flex-wrap">
                            {conceptualTests[upload.id]?.status === 'pending' && (
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => handleOpenQuestions(upload.id)}
                                className="bg-purple-600 hover:bg-purple-700 text-white"
                              >
                                <Brain className="h-4 w-4 mr-1" />
                                Answer Qs
                              </Button>
                            )}
                            {conceptualTests[upload.id]?.status === 'submitted' && (
                              <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-blue-300">
                                <Brain className="h-3 w-3 mr-1" />
                                Evaluating... ⏳
                              </Badge>
                            )}
                            {conceptualTests[upload.id]?.status === 'graded' && (
                              <Badge variant="default" className="bg-green-100 text-green-800 border-green-300">
                                <Brain className="h-3 w-3 mr-1" />
                                Evaluated ✅
                              </Badge>
                            )}
                            {upload.status === 'Rejected' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setAppealProofId(upload.id);
                                  setAppealModalOpen(true);
                                }}
                                className="border-orange-300 text-orange-700 hover:bg-orange-50"
                              >
                                Appeal
                              </Button>
                            )}
                            {hasOpenableProof(upload) && (
                              <>
                                <ProofFileButton
                                  proof={upload}
                                  label="View"
                                  className="border-blue-300 text-blue-700 hover:bg-blue-50"
                                />
                                {upload.file_path && (
                                  <ProofFileButton
                                    proof={upload}
                                    download
                                    label="Download"
                                    className="border-green-300 text-green-700 hover:bg-green-50"
                                  />
                                )}
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedProofId && (
        <ConceptualQuestionsModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          proofId={selectedProofId}
          onSubmitSuccess={handleSubmitSuccess}
        />
      )}
      {appealProofId && studentProfileId && (
        <AppealSubmissionModal
          open={appealModalOpen}
          onOpenChange={setAppealModalOpen}
          proofId={appealProofId}
          studentId={studentProfileId}
          taskTitle={filteredAndSortedUploads.find(u => u.id === appealProofId)?.tasks?.title}
        />
      )}
      {reflectionProofData && studentProfileId && (
        <ReflectionModal
          open={reflectionModalOpen}
          onRequestReview={() => {
            reflectionMutation.mutate({
              proofId: reflectionProofData.proofId,
              studentId: studentProfileId,
            });
            setReflectionModalOpen(false);
            setReflectionProofData(null);
            refetch();
          }}
          onSkip={() => {
            setReflectionModalOpen(false);
            setReflectionProofData(null);
          }}
          conceptualScore={reflectionProofData.conceptualScore}
          trustScore={reflectionProofData.trustScore}
        />
      )}
    </div>
  );
};

export default StudentUploadsPage;