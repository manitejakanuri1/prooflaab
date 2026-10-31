import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// MF-033 (migration 199): the live announcements meant for this person's role (newest 3), on their dashboard.
interface Announcement { id: string; title: string; description: string | null }

export default function AnnouncementBanner() {
  const [items, setItems] = useState<Announcement[]>([]);
  useEffect(() => {
    supabase.rpc("my_announcements" as never).then(({ data }) => setItems((data as Announcement[]) ?? []), () => {});
  }, []);
  if (items.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="announcements">
      {items.map((a) => (
        <div key={a.id} className="flex gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <Megaphone className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-sm font-medium">{a.title}</p>
            {a.description && <p className="text-sm text-muted-foreground whitespace-pre-line">{a.description}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
