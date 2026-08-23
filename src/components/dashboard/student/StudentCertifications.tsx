import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ExternalLink, Plus, Trash2 } from "lucide-react";

interface Certification {
  id: string;
  name: string;
  issuer: string | null;
  issued_on: string | null;
  expires_on: string | null;
  credential_id: string | null;
  credential_url: string | null;
  source: "self" | "resume";
}

const EMPTY = { name: "", issuer: "", issued_on: "", credential_id: "", credential_url: "" };

/**
 * Certifications.
 *
 * They were read out of a resume once and had nowhere to live afterwards, so a
 * credential earned in June could not be added to a resume uploaded in March.
 * Everything the resume already listed is here from the start, marked as having
 * come from the resume; anything added later is the student's own.
 */
const StudentCertifications = () => {
  const { profile } = useStudentProfile();
  const { toast } = useToast();
  const [certs, setCerts] = useState<Certification[] | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    const { data } = await supabase
      .from("student_certifications")
      .select("*")
      .eq("student_id", profile.id)
      .order("issued_on", { ascending: false, nullsFirst: false });
    setCerts((data ?? []) as unknown as Certification[]);
  }, [profile?.id]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!profile?.id || !form.name.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("student_certifications").insert({
      student_id: profile.id,
      name: form.name.trim(),
      issuer: form.issuer.trim() || null,
      issued_on: form.issued_on || null,
      credential_id: form.credential_id.trim() || null,
      credential_url: form.credential_url.trim() || null,
      source: "self",
    } as never);
    setBusy(false);
    if (error) {
      toast({
        title: "Not saved",
        description: error.message.includes("duplicate")
          ? "That certification is already on your profile."
          : error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: `${form.name.trim()} added` });
    setForm(EMPTY);
    setAdding(false);
    void load();
  };

  const remove = async (c: Certification) => {
    const { error } = await supabase.from("student_certifications").delete().eq("id", c.id);
    if (error) {
      toast({ title: "Not removed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${c.name} removed` });
    void load();
  };

  if (!certs) return <Skeleton className="h-64 w-full rounded-xl" />;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Certifications
            </span>
            <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
              {certs.length}
            </span>
          </div>

          {certs.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-2 max-w-prose">
              Nothing here yet. Add the credentials you hold — a recruiter looking at your
              profile sees these next to the work that backs them up.
            </p>
          ) : (
            <div className="mt-3">
              {certs.map((c) => (
                <div key={c.id} className="py-3 border-b last:border-b-0 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <p className="text-sm font-medium">{c.name}</p>
                      {c.source === "resume" && (
                        <Badge variant="outline" className="text-[10px] font-normal">
                          from your resume
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {[
                        c.issuer,
                        c.issued_on ? format(new Date(c.issued_on), "MMM yyyy") : null,
                        c.credential_id ? `ID ${c.credential_id}` : null,
                      ].filter(Boolean).join(" · ") || "No issuer recorded"}
                    </p>
                    {c.credential_url && (
                      <a
                        href={c.credential_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                      >
                        <ExternalLink className="h-3 w-3" /> Verify
                      </a>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => void remove(c)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {!adding ? (
            <Button variant="outline" className="mt-4" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4 mr-1.5" /> Add a certification
            </Button>
          ) : (
            <div className="mt-4 rounded-lg border p-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="cert-name" className="text-xs">Name</Label>
                  <Input
                    id="cert-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="AWS Certified Cloud Practitioner"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="cert-issuer" className="text-xs">Issuer</Label>
                  <Input
                    id="cert-issuer"
                    value={form.issuer}
                    onChange={(e) => setForm({ ...form, issuer: e.target.value })}
                    placeholder="Amazon Web Services"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="cert-date" className="text-xs">Issued on</Label>
                  <Input
                    id="cert-date"
                    type="date"
                    value={form.issued_on}
                    onChange={(e) => setForm({ ...form, issued_on: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="cert-id" className="text-xs">Credential ID</Label>
                  <Input
                    id="cert-id"
                    value={form.credential_id}
                    onChange={(e) => setForm({ ...form, credential_id: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="cert-url" className="text-xs">Link that verifies it</Label>
                  <Input
                    id="cert-url"
                    value={form.credential_url}
                    onChange={(e) => setForm({ ...form, credential_url: e.target.value })}
                    placeholder="https://…"
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button disabled={busy || !form.name.trim()} onClick={() => void add()}>
                  {busy ? "Saving…" : "Save"}
                </Button>
                <Button variant="ghost" onClick={() => { setAdding(false); setForm(EMPTY); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default StudentCertifications;
