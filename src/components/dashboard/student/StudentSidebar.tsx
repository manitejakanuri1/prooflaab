import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Rss,
  Map as MapIcon,
  FileText,
  ClipboardList,
  ScrollText,
  Users,
  FolderGit2,
  TrendingUp,
  Settings,
  LogOut,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

interface StudentSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const MENU_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "feed", label: "Feed", icon: Rss },
  { id: "resume-roadmap", label: "Roadmap", icon: MapIcon },
  { id: "resume-hub", label: "Resume", icon: FileText },
  { id: "tasks-hub", label: "Tasks", icon: ClipboardList },
  { id: "logs", label: "My Logs", icon: ScrollText },
  { id: "squad", label: "Squad", icon: Users },
  { id: "portfolio", label: "Portfolio", icon: FolderGit2 },
  { id: "progress", label: "Progress", icon: TrendingUp },
  { id: "settings", label: "Settings", icon: Settings },
];

const StudentSidebar = ({ activeTab, onTabChange }: StudentSidebarProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { open, isMobile, setOpen } = useSidebar();

  const handleClick = (tabId: string) => {
    onTabChange(tabId);
    if (isMobile) setOpen(false);
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      navigate("/auth");
    } catch (error) {
      console.error("Error signing out:", error);
      toast({
        title: "Error",
        description: "Failed to sign out. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b px-3 py-3">
        <div className="flex items-center gap-2">
          {open ? (
            <>
              <Logo className="h-8 w-auto" alt="ProofLab Logo" />
              <span className="text-lg font-bold">ProofLabAI</span>
            </>
          ) : (
            <Logo className="h-8 w-auto" alt="ProofLab Logo" />
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {MENU_ITEMS.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    onClick={() => handleClick(item.id)}
                    className={cn(
                      activeTab === item.id &&
                        "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleSignOut} className="text-muted-foreground hover:text-foreground">
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
};

export default StudentSidebar;
