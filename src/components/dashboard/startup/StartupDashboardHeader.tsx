import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useStartupProfile } from "@/hooks/useStartupProfile";
import { ThemeToggle } from "@/components/ThemeToggle";

// No bell: startups have no notifications screen, so it was a button that did
// nothing. Settings opens from the avatar instead of a sidebar entry.
export function StartupDashboardHeader({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const { data: profile } = useStartupProfile();
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
          <button type="button" onClick={() => onNavigate?.("settings")} title="Settings"
                  className="flex items-center gap-2 rounded-md p-1 text-left hover:bg-muted">
            <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
              <span className="text-primary-foreground font-medium text-sm">
                {profile?.startup_name?.charAt(0)?.toUpperCase() || 'S'}
              </span>
            </div>
            <div className="text-sm">
              <div className="font-medium">{profile?.startup_name || 'Startup Admin'}</div>
              <div className="text-muted-foreground">
                {profile?.domain_industry}
              </div>
            </div>
          </button>
        </div>
      </div>
    </header>
  );
}