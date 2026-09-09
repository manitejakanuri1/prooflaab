import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { 
  LayoutDashboard, 
  Users, 
  GraduationCap,
  Building2,
  Rocket,
  ClipboardCheck,
  Eye,
  FileText,
  Briefcase,
  BookOpen,
  Megaphone,
  BarChart3,
  Shield,
  ShieldAlert,
  School,
  UserCheck,
  Settings,
  LogOut,
  ChevronDown,
  Plus,
  Bell
,
  Coins,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { useAdminNotifications } from "@/hooks/useAdminNotifications";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface AdminSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const AdminSidebar = ({ activeTab, onTabChange }: AdminSidebarProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { open, setOpen, isMobile } = useSidebar();
  const { unreadCount } = useAdminNotifications();

  // Four groups instead of 14 flat items. Grouped by what an admin is
  // actually trying to do in that moment, not by data model:
  // Overview (see the pilot), People (who's in it), Work Queue (what needs
  // a decision today), Platform (content and system-level controls).
  const menuItems = [
    {
      id: "overview",
      label: "Overview",
      icon: LayoutDashboard,
      children: [
        { id: "dashboard", label: "Dashboard Home", icon: LayoutDashboard },
        { id: "notifications", label: "Notifications", icon: Bell, badge: unreadCount, route: "/admin/notifications" },
        { id: "analytics", label: "Reports & Analytics", icon: BarChart3 },
      ]
    },
    {
      id: "people",
      label: "People",
      icon: Users,
      children: [
        { id: "students", label: "Students", icon: GraduationCap },
        { id: "startups", label: "Startups", icon: Rocket },
        { id: "colleges", label: "Colleges", icon: Building2 },
        { id: "college-oversight", label: "College Oversight", icon: School },
        { id: "student-oversight", label: "Student Oversight", icon: Users },
        { id: "recruiter-oversight", label: "Recruiters", icon: UserCheck },
      ]
    },
    {
      id: "work-queue",
      label: "Work Queue",
      icon: ClipboardCheck,
      children: [
        { id: "proof-submissions", label: "Proof Review & Verification", icon: ClipboardCheck },
        { id: "task-oversight", label: "Task Oversight", icon: Eye },
        { id: "assign-tasks", label: "Assign Tasks", icon: Plus },
        { id: "xp-moderation", label: "Trust & XP Moderation", icon: Shield },
      ]
    },
    {
      id: "platform",
      label: "Platform",
      icon: Settings,
      children: [
        { id: "jobs", label: "Jobs", icon: Briefcase },
        { id: "resources", label: "Resources", icon: BookOpen },
        { id: "announcements", label: "Announcements", icon: Megaphone },
        { id: "token-usage", label: "Token Usage", icon: Coins },
        { id: "security-events", label: "Security Events", icon: ShieldAlert },
        { id: "settings", label: "System Settings & Roles", icon: Settings },
      ]
    },
  ];

  // Find which group contains the active tab
  const getInitialExpandedGroups = () => {
    const groups: string[] = [];
    menuItems.forEach(item => {
      if (item.children?.some((child: any) => child.id === activeTab)) {
        groups.push(item.id);
      }
    });
    return groups;
  };

  const [expandedGroups, setExpandedGroups] = useState<string[]>(getInitialExpandedGroups());

  // Update expanded groups when activeTab changes
  useEffect(() => {
    const groupToExpand = menuItems.find(item => 
      item.children?.some((child: any) => child.id === activeTab)
    );
    
    if (groupToExpand && !expandedGroups.includes(groupToExpand.id)) {
      setExpandedGroups(prev => [...prev, groupToExpand.id]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

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

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      if (prev.includes(groupId)) {
        // If clicking the already expanded group, collapse it
        return prev.filter(id => id !== groupId);
      } else {
        // If opening a new group, close all others and open only this one
        return [groupId];
      }
    });
  };

  const handleMenuClick = (tabId: string, route?: string) => {
    if (route) {
      // Navigate to specific route (like notifications)
      navigate(route);
    } else {
      // For dashboard tabs, navigate to dashboard if not already there
      const currentPath = location.pathname;
      if (currentPath !== '/admin/dashboard') {
        // Navigate back to dashboard with the selected tab
        navigate('/admin/dashboard');
      }
      onTabChange(tabId);
    }
    
    // Close all groups that don't contain the clicked tab
    const parentGroup = menuItems.find(item => 
      item.children?.some((child: any) => child.id === tabId)
    );
    
    if (!parentGroup) {
      // Clicking a top-level item, close all groups
      setExpandedGroups([]);
    }
    
    // Close sidebar on mobile after navigation
    if (isMobile) {
      setOpen(false);
    }
  };

  // Keep the group expanded when a child is active
  const hasActiveChild = (item: any) => {
    return item.children?.some((child: any) => activeTab === child.id);
  };

  // Auto-expand groups with active children
  const isGroupExpanded = (itemId: string, item: any) => {
    return expandedGroups.includes(itemId) || hasActiveChild(item);
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
              {menuItems.map((item) => {
                const hasChildren = item.children && item.children.length > 0;
                const isExpanded = isGroupExpanded(item.id, item);
                const isActive = activeTab === item.id || hasActiveChild(item);

                if (hasChildren) {
                  return (
                    <Collapsible
                      key={item.id}
                      open={isExpanded}
                      onOpenChange={() => toggleGroup(item.id)}
                    >
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton
                            className={cn(
                              isActive && "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400"
                            )}
                          >
                            <item.icon className="h-4 w-4" />
                            <span>{item.label}</span>
                            <ChevronDown className={cn(
                              "ml-auto h-4 w-4 transition-transform",
                              isExpanded && "rotate-180"
                            )} />
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {item.children.map((child: any) => (
                              <SidebarMenuSubItem key={child.id}>
                                <SidebarMenuSubButton
                                  onClick={() => handleMenuClick(child.id, child.route)}
                                  className={cn(
                                    "cursor-pointer relative",
                                    activeTab === child.id && "bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-300"
                                  )}
                                >
                                  <child.icon className="h-4 w-4" />
                                  <span>{child.label}</span>
                                  {child.badge > 0 && (
                                    <span className="ml-auto h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center font-medium">
                                      {child.badge > 9 ? '9+' : child.badge}
                                    </span>
                                  )}
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  );
                }

                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      onClick={() => handleMenuClick(item.id, (item as any).route)}
                      className={cn(
                        "relative",
                        isActive && "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400"
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                      {(item as any).badge && (item as any).badge > 0 && (
                        <span className="ml-auto h-5 min-w-5 px-1 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center font-medium">
                          {(item as any).badge > 9 ? '9+' : (item as any).badge}
                        </span>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
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

export default AdminSidebar;
