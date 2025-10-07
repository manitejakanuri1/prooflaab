import { Bell } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useStartupProfile } from "@/hooks/useStartupProfile";
import { useStartupNotifications } from "@/hooks/useStartupNotifications";
import { ThemeToggle } from "@/components/ThemeToggle";

export function StartupDashboardHeader() {
  const { data: profile } = useStartupProfile();
  const { unreadCount } = useStartupNotifications();
  return (
    <header className="h-16 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="flex items-center justify-between h-full px-6">
        <div className="flex items-center gap-4">
          <SidebarTrigger />
          <div>
            <h1 className="text-xl font-semibold">
              {profile?.startup_name || 'Startup Dashboard'}
            </h1>
            <p className="text-sm text-muted-foreground">Manage your internship tasks and submissions</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <ThemeToggle />
          <Button variant="ghost" size="sm" className="relative">
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <Badge variant="destructive" className="absolute -top-1 -right-1 h-4 w-4 p-0 text-xs">
                {unreadCount}
              </Badge>
            )}
          </Button>
          
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
              <span className="text-primary-foreground font-medium text-sm">
                {profile?.startup_name?.charAt(0)?.toUpperCase() || 'S'}
              </span>
            </div>
            <div className="text-sm">
              <div className="font-medium">{profile?.startup_name || 'Startup Admin'}</div>
              <div className="text-muted-foreground">
                {profile?.domain_industry || 'Premium Plan'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}