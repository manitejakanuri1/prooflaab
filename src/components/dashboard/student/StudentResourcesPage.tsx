import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Owner 12 Nov 2026 (A2 option b, migration 335): text resources written by an admin, read inside the app.
// student_resources() returns only published rows that have text, and never a link. Text is rendered as plain
// React text (no HTML), so a URL inside it shows as words, not a clickable link.

interface Resource {
  resource_id: string; title: string; summary: string | null; body: string; tag: string | null;
}

export default function StudentResourcesPage() {
  const [items, setItems] = useState<Resource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Resource | null>(null);

  useEffect(() => {
    supabase.rpc("student_resources" as never).then(({ data, error }) => {
      if (error) setError(error.message);
      setItems((data as Resource[]) ?? []);
    });
  }, []);

  return (
    <div className="space-y-4" data-testid="student-resources">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Resources</h1>
        <p className="text-sm text-muted-foreground">Short reads from the ProofLab team. Tap one to read it.</p>
      </div>

      {items === null && <p className="text-sm text-muted-foreground">Loading resources…</p>}
      {error && <p className="text-sm text-destructive">Could not load resources: {error}</p>}
      {items?.length === 0 && !error && (
        <p className="text-sm text-muted-foreground" data-testid="resources-empty">No resources yet. Check again later.</p>
      )}

      {items?.map((r) => (
        <Card key={r.resource_id} data-testid="resource-card" role="button" tabIndex={0}
              className="cursor-pointer hover:bg-muted/40"
              onClick={() => setOpen(r)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen(r)}>
          <CardContent className="pt-5 space-y-2">
            <div className="flex flex-wrap items-start gap-2">
              <h3 className="font-semibold flex-1 min-w-0 break-words">{r.title}</h3>
              {r.tag && <Badge variant="outline">{r.tag}</Badge>}
            </div>
            {r.summary && <p className="text-sm text-muted-foreground break-words">{r.summary}</p>}
          </CardContent>
        </Card>
      ))}

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="break-words">{open?.title}</DialogTitle>
            {open?.summary && <DialogDescription className="break-words">{open.summary}</DialogDescription>}
          </DialogHeader>
          <p className="text-sm whitespace-pre-line break-words" data-testid="resource-body">{open?.body}</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
