import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
  School,
  Settings,
  LogOut,
  ChevronDown,
  Plus
} from "lucide-react";
import { Logo } from "@/components/Logo";
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
  const { toast } = useToast();
  const { open, setOpen, isMobile } = useSidebar();

  const menuItems = [
    { id: "dashboard", label: "Dashboard Home", icon: LayoutDashboard },
    { 
      id: "user-management", 
      label: "User Management", 
      icon: Users,
      children: [
        { id: "students", label: "Students", icon: GraduationCap },
        { id: "startups", label: "Startups", icon: Rocket },
        { id: "colleges", label: "Colleges", icon: Building2 }
      ]
    },
    { id: "proof-submissions", label: "Proof Review & Verification", icon: ClipboardCheck },
    { id: "task-oversight", label: "Task Oversight", icon: Eye },
    { id: "assign-tasks", label: "Assign Tasks", icon: Plus },
    { 
      id: "content-management", 
      label: "Content Management", 
      icon: FileText,
      children: [
        { id: "jobs", label: "Jobs", icon: Briefcase },
        { id: "resources", label: "Resources", icon: BookOpen },
        { id: "announcements", label: "Announcements", icon: Megaphone }
      ]
    },
    { id: "analytics", label: "Reports & Analytics", icon: BarChart3 },
    { id: "xp-moderation", label: "Trust & XP Moderation", icon: Shield },
    { id: "college-oversight", label: "College Oversight", icon: School },
    { id: "student-oversight", label: "Student Oversight", icon: Users },
    { id: "settings", label: "System Settings & Roles", icon: Settings }
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

  const handleMenuClick = (tabId: string) => {
    onTabChange(tabId);
    
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
            <Logo className="h-8 w-auto" alt="ProofLab Logo" />
          ) : (
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
              <Shield className="w-4 h-4 text-primary-foreground" />
            </div>
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
                                  onClick={() => handleMenuClick(child.id)}
                                  className={cn(
                                    "cursor-pointer",
                                    activeTab === child.id && "bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-300"
                                  )}
                                >
                                  <child.icon className="h-4 w-4" />
                                  <span>{child.label}</span>
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
                      onClick={() => handleMenuClick(item.id)}
                      className={cn(
                        isActive && "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400"
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
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
