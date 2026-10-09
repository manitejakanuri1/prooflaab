import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const KINDS = [
  { key: "student", label: "Student welcome" },
  { key: "college", label: "College welcome" },
  { key: "startup", label: "Company welcome" },
  { key: "admin", label: "Administrator welcome" },
  { key: "general", label: "Any other welcome" },
] as const;

interface Template { key: string; subject: string; intro: string; updated_at: string }

/**
 * The subject and opening paragraph of each welcome email (migration 105).
 * Plain text only; the button in the email is never part of this. "Use
 * built-in wording" removes the saved wording.
 */
const EmailTemplatesDialog = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [key, setKey] = useState<string>("student");
  const [subject, setSubject] = useState("");
  const [intro, setIntro] = useState("");

  const { data: templates, isLoading, error } = useQuery({
    queryKey: ["admin-email-templates"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_email_templates" as never);
      if (error) throw error;
      return (data ?? []) as unknown as Template[];
    },
  });
  const saved = templates?.find((t) => t.key === key);

  useEffect(() => {
    setSubject(saved?.subject ?? "");
    setIntro(saved?.intro ?? "");
  }, [key, saved?.subject, saved?.intro]);

  const save = useMutation({
    mutationFn: async (next: { subject: string; intro: string }) => {
      const { error } = await supabase.rpc("admin_save_email_template" as never,
        { _key: key, _subject: next.subject, _intro: next.intro } as never);
      if (error) throw error;
    },
    onSuccess: (_, next) => {
      void queryClient.invalidateQueries({ queryKey: ["admin-email-templates"] });
      toast({ title: next.subject ? "Email wording saved" : "Built-in wording restored" });
    },
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
  });

  const clean = { subject: subject.trim(), intro: intro.trim() };
  const valid = clean.subject.length >= 3 && clean.subject.length <= 150 && clean.intro.length >= 10 && clean.intro.length <= 1000;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Email templates</DialogTitle>
          <DialogDescription>
            The subject and opening words of each welcome email. Write {"{{name}}"} where the name of the person
            goes. The sign-in button is added for you.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-red-600">Could not load the templates: {(error as Error).message}</p>
        ) : (
          <div className="space-y-3">
            <div>
              <Label>Email</Label>
              <Select value={key} onValueChange={setKey}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => <SelectItem key={k.key} value={k.key}>{k.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {isLoading ? "Loading…" : saved ? "Using your wording." : "Using the built-in wording."}
              </p>
            </div>
            <div>
              <Label htmlFor="email-subject">Subject</Label>
              <Input id="email-subject" value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="email-intro">Opening words</Label>
              <Textarea id="email-intro" rows={6} value={intro} maxLength={1000} onChange={(e) => setIntro(e.target.value)} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={!saved || save.isPending}
            onClick={() => save.mutate({ subject: "", intro: "" })}>
            Use built-in wording
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate(clean)}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EmailTemplatesDialog;
