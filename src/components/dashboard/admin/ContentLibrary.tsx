import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, EyeOff, Eye, FileText } from "lucide-react";
import { safeExternalUrl } from "@/lib/safeNavigation";

interface Page {
  id: string; url: string; title: string | null; site: string | null; domain: string | null;
  fetch_method: string | null; fetched_at: string; chars: number; college: string | null;
  lot_written: boolean; times_given: number; hidden: boolean;
}
interface Library {
  pages: Page[];
  sources: { site: string; domain: string; seeds: number; rights: string; retired: boolean }[];
  newest_fetch: string | null;
}

/**
 * Admin > Platform > Content library: every page the crawler fetched or a
 * college submitted - the material Lots are written from. Hidden pages stay
 * (Lots already made from them keep working) but are never given out again.
 */
const ContentLibrary = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<{ title: string; url: string; markdown: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-content-library"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_content_library" as never);
      if (error) throw error;
      return data as unknown as Library;
    },
  });

  const read = async (id: string) => {
    const { data, error } = await supabase.rpc("admin_content_page" as never, { _id: id } as never);
    if (error) return toast({ title: "Could not open", description: error.message, variant: "destructive" });
    setOpen(data as unknown as { title: string; url: string; markdown: string });
  };

  const toggle = async (p: Page) => {
    const { error } = await supabase.rpc("admin_hide_content" as never, { _id: p.id, _hidden: !p.hidden } as never);
    if (error) return toast({ title: "Not changed", description: error.message, variant: "destructive" });
    toast({ title: p.hidden ? "Page shown again" : "Page hidden", description: p.hidden ? "It can be given out as a Lot again." : "It will not be given out as a new Lot." });
    void qc.invalidateQueries({ queryKey: ["admin-content-library"] });
  };

  if (isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (error || !data) return <p className="text-sm text-destructive">Could not load the library.</p>;

  const pages = data.pages.filter((p) => !q || `${p.title} ${p.url} ${p.site}`.toLowerCase().includes(q.toLowerCase()));
  const shown = data.pages.filter((p) => !p.hidden).length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">Content library</h2>
        <p className="text-sm text-muted-foreground">
          Real pages the crawler fetched and colleges submitted. Every Lot is written from one of these.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { k: "Pages", v: data.pages.length },
          { k: "Available for Lots", v: shown },
          { k: "Sites", v: data.sources.length },
          { k: "Newest page", v: data.newest_fetch ? new Date(data.newest_fetch).toLocaleDateString("en-GB") : "—" },
        ].map((c) => (
          <Card key={c.k}><CardContent className="pt-5">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{c.k}</p>
            <p className="font-mono text-2xl font-semibold tabular-nums mt-1">{c.v}</p>
          </CardContent></Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Sites the crawler reads</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {data.sources.map((s) => (
            <Badge key={s.domain} variant="outline" className="font-normal">
              {s.site} · {s.seeds} page{s.seeds === 1 ? "" : "s"}{s.retired ? " · retired" : ""}
            </Badge>
          ))}
          <p className="w-full text-xs text-muted-foreground mt-1">
            The crawler visits these exact pages every Sunday 08:10 and saves a page only when its content changed.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5 space-y-3">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title, site or address" className="max-w-sm" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="pb-2 pr-3">Page</th><th className="pb-2 pr-3">Site</th><th className="pb-2 pr-3">Fetched</th>
                  <th className="pb-2 pr-3">Size</th><th className="pb-2 pr-3">Lot</th><th className="pb-2 pr-3">Given</th><th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={p.id} className={`border-t ${p.hidden ? "opacity-50" : ""}`}>
                    <td className="py-2.5 pr-3 max-w-[320px]">
                      <div className="font-medium truncate">{p.title || p.url}</div>
                      <a href={safeExternalUrl(p.url) ?? undefined} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1 truncate max-w-full">
                        {p.url} <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                      {p.college && <div className="text-xs text-primary">Submitted by {p.college}</div>}
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{p.site ?? p.domain}<div className="text-[10px] font-mono">{p.fetch_method}</div></td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{new Date(p.fetched_at).toLocaleDateString("en-GB")}</td>
                    <td className="py-2.5 pr-3 font-mono tabular-nums">{Math.round(p.chars / 1000)}k</td>
                    <td className="py-2.5 pr-3">{p.lot_written ? <Badge variant="outline">written</Badge> : <span className="text-xs text-muted-foreground">not yet</span>}</td>
                    <td className="py-2.5 pr-3 font-mono tabular-nums">{p.times_given}×</td>
                    <td className="py-2.5 whitespace-nowrap text-right">
                      <Button size="sm" variant="ghost" onClick={() => void read(p.id)}><FileText className="h-3.5 w-3.5 mr-1" />Read</Button>
                      <Button size="sm" variant="ghost" onClick={() => void toggle(p)}>
                        {p.hidden ? <><Eye className="h-3.5 w-3.5 mr-1" />Show</> : <><EyeOff className="h-3.5 w-3.5 mr-1" />Hide</>}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{open?.title || open?.url}</DialogTitle></DialogHeader>
          <pre className="whitespace-pre-wrap text-xs leading-relaxed">{open?.markdown?.slice(0, 20000)}</pre>
          {(open?.markdown?.length ?? 0) > 20000 && <p className="text-xs text-muted-foreground">Showing the first 20,000 characters.</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ContentLibrary;
