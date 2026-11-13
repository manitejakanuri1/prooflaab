import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// MF-033 (migration 199): the live announcements meant for this person's role (newest 3), on their dashboard.
// Retest N3 (13 Nov 2026): a banner opens its announcement in a window, and an announcement notification
// (?announcement=<id>) opens the same window. If that announcement is not in the person's list (older, or not
// readable directly), the notification's own title and text are shown - the notification already carries them.
interface Announcement { id: string; title: string; description: string | null }

export default function AnnouncementBanner() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [open, setOpen] = useState<Announcement | null>(null);
  const [params, setParams] = useSearchParams();
  const wanted = params.get("announcement");

  useEffect(() => {
    supabase.rpc("my_announcements" as never).then(({ data }) => setItems((data as Announcement[]) ?? []), () => {});
  }, []);

  useEffect(() => {
    if (!wanted) return;
    const hit = items.find((a) => a.id === wanted);
    if (hit) { setOpen(hit); return; }
    supabase.from("notifications").select("title, message").like("link", `%announcement=${wanted}%`)
      .order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => {
        const n = data as { title: string; message: string | null } | null;
        if (n) setOpen({ id: wanted, title: n.title, description: n.message });
      }, () => {});
  }, [wanted, items]);

  const close = () => {
    setOpen(null);
    if (wanted) { params.delete("announcement"); setParams(params, { replace: true }); }
  };

  return (
    <>
      {items.length > 0 && (
        <div className="space-y-2" data-testid="announcements">
          {items.map((a) => (
            <button key={a.id} type="button" onClick={() => setOpen(a)}
                    className="flex w-full gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-left hover:bg-primary/10">
              <Megaphone className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{a.title}</p>
                {/* F23: an announcement whose text is its title showed the same line twice. */}
                {a.description && a.description.trim() !== a.title.trim() && <p className="text-sm text-muted-foreground line-clamp-2">{a.description}</p>}
              </div>
            </button>
          ))}
        </div>
      )}
      <Dialog open={!!open} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent data-testid="announcement-dialog">
          <DialogHeader><DialogTitle>{open?.title}</DialogTitle></DialogHeader>
          <p className="text-sm whitespace-pre-line">{open?.description?.trim() || open?.title}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
