import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, Check } from "lucide-react";
import { useCollegeNotifications } from "@/hooks/useCollegeNotifications";

/**
 * College > Notifications: students who need attention right now, from
 * tpo_attention() (the same list Home and Students use). The old version listed
 * proof uploads and task applications, both retired, so it never showed anything.
 */
const NotificationsSection = () => {
  const { notifications, unreadCount, isLoading, markAsViewed, markAllAsViewed } = useCollegeNotifications();

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
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.severity === "high" ? "bg-destructive" : "bg-amber-500"}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {n.full_name}
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
    </Card>
  );
};

export default NotificationsSection;
