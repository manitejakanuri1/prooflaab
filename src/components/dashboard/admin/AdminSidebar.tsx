import { useState } from "react";
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
  School,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Plus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface AdminSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const AdminSidebar = ({ activeTab, onTabChange }: AdminSidebarProps) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [allExpanded, setAllExpanded] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

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
    { id: "startup-oversight", label: "Startup Oversight", icon: Building2 },
    { id: "student-oversight", label: "Student Oversight", icon: Users },
    { id: "settings", label: "System Settings & Roles", icon: Settings }
  ];

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
      // If clicking on currently expanded group, collapse it
      if (prev.includes(groupId)) {
        return [];
      }
      // Otherwise, close all others and open this one (accordion behavior)
      return [groupId];
    });
  };

  const handleMenuClick = (item: any) => {
    const hasChildren = item.children && item.children.length > 0;
    
    if (hasChildren) {
      // Toggle the submenu
      toggleGroup(item.id);
    } else {
      // Close all open submenus when clicking a main menu without children
      setExpandedGroups([]);
      onTabChange(item.id);
    }
  };

  const toggleAllGroups = () => {
    if (allExpanded) {
      setExpandedGroups([]);
      setAllExpanded(false);
    } else {
      const groupsWithChildren = menuItems
        .filter(item => item.children && item.children.length > 0)
        .map(item => item.id);
      setExpandedGroups(groupsWithChildren);
      setAllExpanded(true);
    }
  };

  const renderMenuItem = (item: any, level = 0) => {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedGroups.includes(item.id);
    
    // Check if this parent has an active child
    const hasActiveChild = hasChildren && item.children.some((child: any) => activeTab === child.id);
    
    // Determine if this item is active
    const isActive = activeTab === item.id || hasActiveChild;
    
    // For child items, check if they are directly active
    const isChildActive = level > 0 && activeTab === item.id;

    return (
      <div key={item.id}>
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-start gap-3 px-3 py-2.5 h-auto transition-all duration-200 text-left",
            level === 0 && (isActive || hasActiveChild)
              ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 hover:bg-orange-200 dark:hover:bg-orange-900/50 font-medium" 
              : level > 0 && isChildActive
              ? "bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-300 hover:bg-orange-100 dark:hover:bg-orange-900/30"
              : "hover:bg-muted text-muted-foreground hover:text-foreground",
            level > 0 ? "ml-6 text-sm" : "",
            isCollapsed ? "justify-center px-2" : ""
          )}
          onClick={() => {
            if (level === 0) {
              handleMenuClick(item);
            } else {
              // Child item clicked - just change tab
              onTabChange(item.id);
            }
          }}
        >
          <item.icon className={cn("flex-shrink-0", isCollapsed ? "h-5 w-5" : "h-4 w-4")} />
          {!isCollapsed && (
            <>
              <span className="truncate flex-1 text-left">{item.label}</span>
              {hasChildren && (
                <div className="ml-auto transition-transform duration-200">
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
              )}
            </>
          )}
        </Button>
        
        {hasChildren && !isCollapsed && (
          <div 
            className={cn(
              "overflow-hidden transition-all duration-300 ease-in-out",
              isExpanded ? "max-h-96 opacity-100 animate-accordion-down" : "max-h-0 opacity-0"
            )}
          >
            <div className="mt-1 space-y-1 ml-2">
              {item.children.map((child: any) => renderMenuItem(child, level + 1))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={cn(
      "bg-card border-r border-border flex flex-col transition-all duration-300 h-full overflow-hidden",
      isCollapsed ? "w-16" : "w-64"
    )}>
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between flex-shrink-0">
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <Shield className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-lg">ProofLab Admin</span>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1 h-auto"
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto min-h-0">
        {menuItems.map((item) => renderMenuItem(item))}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-border space-y-2 flex-shrink-0">
        {!isCollapsed && (
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={toggleAllGroups}
          >
            {allExpanded ? 'Collapse All' : 'Expand All'}
          </Button>
        )}
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-start gap-3 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
            isCollapsed ? "justify-center px-2" : ""
          )}
          onClick={handleSignOut}
        >
          <LogOut className={cn("flex-shrink-0", isCollapsed ? "h-5 w-5" : "h-4 w-4")} />
          {!isCollapsed && <span>Sign Out</span>}
        </Button>
      </div>
    </div>
  );
};

export default AdminSidebar;