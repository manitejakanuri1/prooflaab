import { SidebarTrigger } from "@/components/ui/sidebar";
import { useStartupProfile } from "@/hooks/useStartupProfile";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CompanyBell } from "./CompanyBell";

// The bell lists what companies are told (MF-088: a student finished their Lot).
// Settings opens from the avatar instead of a sidebar entry.
export function StartupDashboardHeader({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const { data: profile } = useStartupProfile();
  return (
    <header className="h-16 border-b border-border bg-background/80 backdrop-blur-xl sticky top-0 z-50">
      <div className="flex items-center justify-between h-full px-6">
        <div className="flex items-center gap-4">
          <SidebarTrigger />
          <div>
            <h1 className="font-display text-lg font-semibold">
              {profile?.startup_name || 'Company dashboard'}
            </h1>
            <p className="text-sm text-muted-foreground">Find talent, sponsor Lots and review real student work</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <ThemeToggle />
          <CompanyBell onOpenLots={() => onNavigate?.("lots")} />
          <button type="button" onClick={() => onNavigate?.("settings")} title="Settings"
                  className="flex items-center gap-2 rounded-md p-1 text-left hover:bg-muted">
            <div className="w-8 h-8 bg-primary/15 rounded-full flex items-center justify-center">
              <span className="text-primary font-medium text-sm">
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