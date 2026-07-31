import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Shield } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface StudentData {
  id: string;
  full_name: string;
  branch: string;
  batch: string;
  trust_score: number;
  profile_photo_url: string | null;
  verified_proofs: Array<{
    id: string;
    file_url: string | null;
    submitted_at: string;
    task_title: string;
  }>;
}

interface RecruiterLinkData {
  id: string;
  college_id: string;
  filters: any;
  status: string;
  expires_at: string;
  college_name: string;
  college_logo?: string;
}

export default function RecruiterView() {
  const { linkId } = useParams();
  const [linkData, setLinkData] = useState<RecruiterLinkData | null>(null);
  const [students, setStudents] = useState<StudentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (linkId) {
      loadRecruiterData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkId]);

  const loadRecruiterData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Track view
      await supabase.from('recruiter_link_views').insert({
        link_id: linkId,
      });

      // Fetch link data (without inner join to avoid RLS issues)
      const { data: link, error: linkError } = await supabase
        .from('recruiter_links')
        .select('*')
        .eq('id', linkId)
        .single();

      if (linkError) throw linkError;

      // Check if link is valid
      if (link.status !== 'active' || new Date(link.expires_at) < new Date()) {
        setError("This link has expired or been revoked.");
        setLoading(false);
        return;
      }

      // Fetch college data separately
      const { data: collegeData } = await supabase
        .from('colleges')
        .select(`
          name,
          college_profiles(profile_photo_url)
        `)
        .eq('id', link.college_id)
        .single();

      const collegeName = collegeData?.name || "College";
      const collegeLogo = (collegeData as any)?.college_profiles?.[0]?.profile_photo_url;

      setLinkData({
        ...link,
        college_name: collegeName,
        college_logo: collegeLogo,
      });

      // Fetch students based on filters
      let query = supabase
        .from('student_profiles')
        .select(`
          id,
          full_name,
          branch,
          batch,
          trust_score,
          profile_photo_url
        `)
        .eq('college_id', link.college_id)
        .eq('status', 'active');

      const filters = link.filters as any;

      if (filters?.branch) {
        query = query.eq('branch', filters.branch);
      }
      if (filters?.batch) {
        query = query.eq('batch', filters.batch);
      }
      if (filters?.min_trust_score > 0) {
        query = query.gte('trust_score', filters.min_trust_score);
      }

      if (filters?.top_performers_only) {
        query = query.gte('total_xp', 500);
      }

      const { data: studentsData, error: studentsError } = await query;

      if (studentsError) throw studentsError;

      // Fetch verified proofs for each student
      const studentsWithProofs = await Promise.all(
        (studentsData || []).map(async (student) => {
          let proofsQuery = supabase
            .from('proof_uploads')
            .select(`
              id,
              file_url,
              submitted_at,
              tasks!inner(title)
            `)
            .eq('student_id', student.id)
            .eq('status', 'Verified')
            .order('submitted_at', { ascending: false });

          if (!filters?.verified_only) {
            // Include all proofs if not filtered
            proofsQuery = supabase
              .from('proof_uploads')
              .select(`
                id,
                file_url,
                submitted_at,
                tasks!inner(title)
              `)
              .eq('student_id', student.id)
              .order('submitted_at', { ascending: false });
          }

          const { data: proofs } = await proofsQuery;

          return {
            ...student,
            verified_proofs: (proofs || []).map(p => ({
              id: p.id,
              file_url: p.file_url,
              submitted_at: p.submitted_at,
              task_title: (p.tasks as any)?.title || "Unknown Task",
            })),
          };
        })
      );

      // Filter students with at least one proof if verified_only
      const filteredStudents = filters?.verified_only
        ? studentsWithProofs.filter(s => s.verified_proofs.length > 0)
        : studentsWithProofs;

      setStudents(filteredStudents);
    } catch (err) {
      console.error("Error loading recruiter data:", err);
      setError("Failed to load recruiter page. The link may be invalid.");
    } finally {
      setLoading(false);
    }
  };

  const getTrustScoreColor = (score: number) => {
    if (score >= 80) return "bg-green-500";
    if (score >= 60) return "bg-yellow-500";
    return "bg-orange-500";
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="py-8 text-center">
            <p className="text-lg font-semibold mb-2">Link Expired</p>
            <p className="text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getFilterSummary = () => {
    if (!linkData) return "";
    const filters = linkData.filters;
    const parts = [];
    if (filters.branch) parts.push(filters.branch);
    if (filters.batch) parts.push(`Batch ${filters.batch}`);
    if (parts.length === 0) parts.push("All Students");
    return parts.join(" • ");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      {/* Header */}
      <div className="bg-card border-b">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center gap-4 mb-4">
            {linkData?.college_logo && (
              <Avatar className="h-16 w-16">
                <AvatarImage src={linkData.college_logo} />
                <AvatarFallback>{linkData.college_name[0]}</AvatarFallback>
              </Avatar>
            )}
            <div>
              <h1 className="text-3xl font-bold">{linkData?.college_name}</h1>
              <p className="text-muted-foreground">{getFilterSummary()} — Top Proof-Verified Students</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {students.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground">No students match the current filters.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {students.map((student) => (
              <Card key={student.id} className="overflow-hidden">
                <CardHeader className="pb-4">
                  <div className="flex items-start gap-3">
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={student.profile_photo_url || undefined} />
                      <AvatarFallback>{student.full_name[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1">
                      <CardTitle className="text-lg">{student.full_name}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {student.branch} • Batch {student.batch}
                      </p>
                    </div>
                    <Badge className={getTrustScoreColor(student.trust_score)}>
                      <Shield className="h-3 w-3 mr-1" />
                      {student.trust_score}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-semibold mb-2">
                        Verified Proofs ({student.verified_proofs.length})
                      </p>
                      <div className="space-y-2">
                        {student.verified_proofs.slice(0, 3).map((proof) => (
                          <div key={proof.id} className="flex items-center justify-between text-sm">
                            <span className="truncate flex-1">{proof.task_title}</span>
                            {proof.file_url && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => window.open(proof.file_url!, '_blank')}
                              >
                                <ExternalLink className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        ))}
                        {student.verified_proofs.length > 3 && (
                          <p className="text-xs text-muted-foreground">
                            +{student.verified_proofs.length - 3} more proofs
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t bg-card mt-12">
        <div className="max-w-7xl mx-auto px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            Powered by <span className="font-semibold text-primary">ProofLabAI</span> — Proof-based Campus Hiring Simplified
          </p>
        </div>
      </div>
    </div>
  );
}
