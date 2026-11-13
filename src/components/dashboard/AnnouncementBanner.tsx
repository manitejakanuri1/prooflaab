import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

// MF-033 (migration 199), N3 (13 Nov 2026): the live announcements meant for this person's role (newest 3), on their dashboard.
// If an announcement notification opens ?announcement=<id>, that announcement is fetched even if older than the newest 3,
// displayed at the top, and scrolled into view.
interface Announcement { id: string; title: string; description: string | null }

export default function AnnouncementBanner() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [params] = useSearchParams();
  const wanted = params.get("announcement");

  useEffect(() => {
    supabase.rpc("my_announcements" as never).then(async ({ data }) => {
      let list = (data as Announcement[]) ?? [];
      if (wanted && !list.some((a) => a.id === wanted)) {
        const { data: single } = await supabase
          .from("announcements")
          .select("id, title, description")
          .eq("id", wanted)
          .maybeSingle();
        if (single) {
          list = [single as Announcement, ...list];
        }
      }
      setItems(list);
    }, () => {});
  }, [wanted]);

  useEffect(() => {
    if (wanted && items.length) {
      document.getElementById(`announcement-${wanted}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [wanted, items]);

  if (items.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="announcements">
      {items.map((a) => (
        <div key={a.id} id={`announcement-${a.id}`}
             className={`flex gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 ${a.id === wanted ? "ring-2 ring-primary" : ""}`}>
          <Megaphone className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-sm font-medium">{a.title}</p>
            {/* F23: an announcement whose text is its title showed the same line twice. */}
            {a.description && a.description.trim() !== a.title.trim() && <p className="text-sm text-muted-foreground whitespace-pre-line">{a.description}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
