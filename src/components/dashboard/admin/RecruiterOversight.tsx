import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BadgeCheck, Ban, Briefcase, ExternalLink } from "lucide-react";

interface RecruiterRow {
  id: string;
  company: string;
  contact_name: string | null;
  work_email: string | null;
  website: string | null;
  verified: boolean;
  created_at: string;
  shortlists: number;
  sponsored: number;
}

const RecruiterOversight = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: recruiters, isLoading, error } = useQuery({
    queryKey: ["admin-recruiters"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_recruiters");
      if (error) throw error;
      return (data ?? []) as unknown as RecruiterRow[];
    },
  });

  const setVerified = useMutation({
    mutationFn: async ({ id, verified }: { id: string; verified: boolean }) => {
      const { error } = await supabase.rpc("admin_verify_recruiter", {
        _recruiter_id: id,
        _verified: verified,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-recruiters"] });
      toast({
        title: variables.verified ? "Recruiter approved" : "Approval removed",
        description: variables.verified
          ? "They can now see candidates."
          : "They can no longer see candidates.",
      });
    },
    onError: (err: unknown) => {
      toast({
        title: "That did not go through",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  const pending = (recruiters ?? []).filter((r) => !r.verified).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Hiring activity</h1>
        <p className="text-muted-foreground">
          Shortlists, views and sponsored Lots per company. Approving a company above also turns this on.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5" />
            All recruiters
          </CardTitle>
          {pending > 0 && (
            <Badge variant="destructive">{pending} waiting for approval</Badge>
          )}
        </CardHeader>
        <CardContent>
          {isLoading && (
            <p className="py-8 text-center text-muted-foreground">Loading…</p>
          )}

          {error && (
            <p className="py-8 text-center text-destructive">
              Could not load recruiters:{" "}
              {error instanceof Error ? error.message : "unknown error"}
            </p>
          )}

          {!isLoading && !error && (recruiters ?? []).length === 0 && (
            <p className="py-8 text-center text-muted-foreground">
              No recruiter has signed up yet.
            </p>
          )}

          {!isLoading && !error && (recruiters ?? []).length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Signed up</TableHead>
                  <TableHead className="text-right">Shortlisted</TableHead>
                  <TableHead className="text-right">Sponsored Lots</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(recruiters ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {r.company}
                        {r.website && (
                          <a
                            href={r.website}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={`Open ${r.company} website`}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>{r.contact_name || "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.work_email || "—"}
                      </div>
                    </TableCell>
                    <TableCell>
                      {new Date(r.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">{r.shortlists}</TableCell>
                    <TableCell className="text-right">{r.sponsored}</TableCell>
                    <TableCell>
                      {r.verified ? (
                        <Badge className="gap-1">
                          <BadgeCheck className="h-3.5 w-3.5" />
                          Approved
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Waiting</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.verified ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={setVerified.isPending}
                          onClick={() =>
                            setVerified.mutate({ id: r.id, verified: false })
                          }
                        >
                          <Ban className="mr-1 h-4 w-4" />
                          Remove approval
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={setVerified.isPending}
                          onClick={() =>
                            setVerified.mutate({ id: r.id, verified: true })
                          }
                        >
                          <BadgeCheck className="mr-1 h-4 w-4" />
                          Approve
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default RecruiterOversight;
