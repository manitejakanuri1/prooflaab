import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { LogOut } from "lucide-react";
import { Logo, Wordmark } from "@/components/Logo";
import { ADMIN_GROUPS, groupOf } from "./adminNav";
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
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface AdminSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const AdminSidebar = ({ activeTab, onTabChange }: AdminSidebarProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { open, setOpen, isMobile } = useSidebar();
  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      navigate("/auth");
      toast({
        title: "Signed out successfully",
        description: "You have been logged out of your account.",
      });
    } catch (error) {
      console.error("Error signing out:", error);
      toast({
        title: "Error",
        description: "Failed to sign out. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Four plain destinations. Clicking one opens its first page; the pages
  // inside are the tab row on the dashboard (ADMIN_GROUPS in adminNav.ts).
  const openGroup = (tabId: string) => {
    if (location.pathname.startsWith('/admin/dashboard')) onTabChange(tabId);
    else navigate(`/admin/dashboard?tab=${tabId}`);
    if (isMobile) setOpen(false);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-3">
        <div className="flex items-center gap-2">
          {open ? (
            <>
              <Logo className="h-8 w-auto" alt="ProofLab logo" />
              <Wordmark />
            </>
          ) : (
            <Logo className="h-8 w-auto" alt="ProofLab logo" />
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {ADMIN_GROUPS.map((group) => {
                const isActive = groupOf(activeTab)?.id === group.id;
                return (
                  <SidebarMenuItem key={group.id}>
                    <SidebarMenuButton
                      tooltip={group.label}
                      onClick={() => openGroup(group.children[0].id)}
                      className={cn(
                        isActive && "bg-primary/10 text-primary font-semibold border border-primary/30 shadow-[inset_2px_0_0_hsl(var(--primary))] hover:bg-primary/10 hover:text-primary"
                      )}
                    >
                      <group.icon className="h-4 w-4" />
                      <span>{group.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleSignOut} className="text-alert hover:bg-alert/10 hover:text-alert">
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
};

export default AdminSidebar;
