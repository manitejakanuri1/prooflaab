import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, Check } from "lucide-react";
import { useState } from "react";
import { useCollegeNotifications } from "@/hooks/useCollegeNotifications";
import { useNotifications } from "@/hooks/useNotifications";
import TpoStudentProfile from "./TpoStudentProfile";

/**
 * College > Notifications: students who need attention right now, from
 * tpo_attention() (the same list Home and Students use). The old version listed
 * proof uploads and task applications, both retired, so it never showed anything.
 */
const NotificationsSection = () => {
  const { notifications, unreadCount, isLoading, markAsViewed, markAllAsViewed } = useCollegeNotifications();
  const [openStudent, setOpenStudent] = useState<string | null>(null);   // MF-066: each alert opens its student
  const notices = useNotifications();   // MF-033: admin announcements sent to colleges

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Notifications
          {unreadCount > 0 && <Badge>{unreadCount} new</Badge>}
        </CardTitle>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={markAllAsViewed}>
            <Check className="mr-1 h-4 w-4" /> Mark all as read
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {notices.notifications.length > 0 && (
          <ul className="divide-y mb-4 border-b">
            {notices.notifications.map((n) => (
              <li key={n.id} className={`flex items-start gap-3 py-3 ${n.is_read ? "opacity-60" : ""}`}>
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{n.title}</p>
                  {n.message && <p className="text-sm text-muted-foreground whitespace-pre-line">{n.message}</p>}
                </div>
                {!n.is_read && (
                  <Button variant="ghost" size="sm" onClick={() => notices.markAsRead(n.id)}>Mark read</Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : notifications.length === 0 ? (
          <div className="py-10 text-center">
            <Bell className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Nothing needs your attention right now.</p>
          </div>
        ) : (
          <ul className="divide-y">
            {notifications.map((n) => (
              <li key={n.id} className={`flex items-start gap-3 py-3 ${n.is_read ? "opacity-60" : ""}`}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.severity === "high" ? "bg-alert" : "bg-compete"}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    <button type="button" className="hover:text-primary hover:underline"
                      onClick={() => { setOpenStudent(n.student_id); if (!n.is_read) markAsViewed([n.id]); }}>
                      {n.full_name}
                    </button>
                    <span className="ml-2 font-normal text-muted-foreground">
                      {[n.roll_number, n.branch].filter(Boolean).join(" · ")}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">{n.reasons.join(" · ")}</p>
                </div>
                {!n.is_read && (
                  <Button variant="ghost" size="sm" onClick={() => markAsViewed([n.id])}>Mark read</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <TpoStudentProfile studentId={openStudent} onClose={() => setOpenStudent(null)} />
    </Card>
  );
};

export default NotificationsSection;
