import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Copy, ExternalLink, Trash2, Eye, Check } from "lucide-react";
import { format } from "date-fns";
import { useCollegeProfile } from "@/hooks/useCollegeProfile";

interface RecruiterLink {
  id: string;
  filters: any;
  created_at: string;
  expires_at: string;
  status: string;
}

export function RecruiterLinksPage() {
  const { profile } = useCollegeProfile();
  const queryClient = useQueryClient();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: links, isLoading } = useQuery({
    queryKey: ['recruiter-links', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return [];

      const { data, error } = await supabase
        .from('recruiter_links')
        .select('*')
        .eq('college_id', profile.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as RecruiterLink[];
    },
    enabled: !!profile?.id,
  });

  const { data: viewCounts } = useQuery({
    queryKey: ['recruiter-link-views', links?.map(l => l.id)],
    queryFn: async () => {
      if (!links || links.length === 0) return {};

      const linkIds = links.map(l => l.id);
      const { data, error } = await supabase
        .from('recruiter_link_views')
        .select('link_id')
        .in('link_id', linkIds);

      if (error) throw error;

      const counts: Record<string, number> = {};
      data.forEach(view => {
        counts[view.link_id] = (counts[view.link_id] || 0) + 1;
      });
      return counts;
    },
    enabled: !!links && links.length > 0,
  });

  const revokeMutation = useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await supabase
        .from('recruiter_links')
        .update({ status: 'revoked' })
        .eq('id', linkId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recruiter-links'] });
      toast.success("Link revoked successfully");
    },
    onError: () => {
      toast.error("Failed to revoke link");
    },
  });

  const handleCopy = (linkId: string) => {
    const link = `${window.location.origin}/recruiter/${linkId}`;
    navigator.clipboard.writeText(link);
    setCopiedId(linkId);
    toast.success("Link copied to clipboard!");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleView = (linkId: string) => {
    window.open(`/recruiter/${linkId}`, '_blank');
  };

  const getStatusBadge = (link: RecruiterLink) => {
    const now = new Date();
    const expiresAt = new Date(link.expires_at);

    if (link.status === 'revoked') {
      return <Badge variant="destructive">Revoked</Badge>;
    } else if (expiresAt < now) {
      return <Badge variant="secondary">Expired</Badge>;
    } else {
      return <Badge className="bg-green-500">Active</Badge>;
    }
  };

  const getFilterSummary = (filters: any) => {
    const parts = [];
    if (filters.branch) parts.push(`Branch: ${filters.branch}`);
    if (filters.batch) parts.push(`Batch: ${filters.batch}`);
    if (filters.min_trust_score > 0) parts.push(`Trust Score ≥ ${filters.min_trust_score}`);
    if (filters.verified_only) parts.push("Verified Only");
    if (filters.top_performers_only) parts.push("Top Performers");
    return parts.join(" • ") || "All Students";
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Recruiter Links</h2>
        <p className="text-muted-foreground">Manage your shareable recruiter pages</p>
      </div>

      {!links || links.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-muted-foreground">
              No recruiter links generated yet. Create one from the Students page.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {links.map((link) => (
            <Card key={link.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">
                      {getFilterSummary(link.filters)}
                    </CardTitle>
                    <CardDescription>
                      Created: {format(new Date(link.created_at), "MMM dd, yyyy")} • 
                      Expires: {format(new Date(link.expires_at), "MMM dd, yyyy")}
                    </CardDescription>
                  </div>
                  {getStatusBadge(link)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleView(link.id)}
                      disabled={link.status !== 'active' || new Date(link.expires_at) < new Date()}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      View
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCopy(link.id)}
                      disabled={link.status !== 'active' || new Date(link.expires_at) < new Date()}
                    >
                      {copiedId === link.id ? (
                        <Check className="h-4 w-4 mr-2" />
                      ) : (
                        <Copy className="h-4 w-4 mr-2" />
                      )}
                      Copy
                    </Button>
                    {viewCounts && viewCounts[link.id] > 0 && (
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Eye className="h-4 w-4" />
                        {viewCounts[link.id]} views
                      </div>
                    )}
                  </div>
                  {link.status === 'active' && new Date(link.expires_at) > new Date() && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => revokeMutation.mutate(link.id)}
                      disabled={revokeMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Revoke
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
