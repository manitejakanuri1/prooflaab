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
  const [expandedGroups, setExpandedGroups] = useState<string[]>(['user-management', 'content-management']);
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
    setExpandedGroups(prev => 
      prev.includes(groupId) 
        ? prev.filter(id => id !== groupId)
        : [...prev, groupId]
    );
  };

  const renderMenuItem = (item: any, level = 0) => {
    const isActive = activeTab === item.id || 
      (item.id === 'user-management' && ['students', 'startups', 'colleges'].includes(activeTab));
    
    // For child items, check if they are directly active
    const isChildActive = level > 0 && activeTab === item.id;
    
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedGroups.includes(item.id);

    return (
      <div key={item.id}>
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-start gap-3 px-3 py-2.5 h-auto transition-all duration-200 text-left",
            (isActive || isChildActive)
              ? "bg-primary text-primary-foreground hover:bg-primary/90" 
              : "hover:bg-muted text-muted-foreground hover:text-foreground",
            level > 0 ? "ml-6 text-sm" : "",
            isCollapsed ? "justify-center px-2" : ""
          )}
          onClick={() => {
            if (hasChildren) {
              toggleGroup(item.id);
            } else {
              // Handle child navigation for user management items
              if (['students', 'startups', 'colleges'].includes(item.id)) {
                onTabChange(item.id);
              } else {
                onTabChange(item.id);
              }
            }
          }}
        >
          <item.icon className={cn("flex-shrink-0", isCollapsed ? "h-5 w-5" : "h-4 w-4")} />
          {!isCollapsed && (
            <>
              <span className="truncate flex-1 text-left">{item.label}</span>
              {hasChildren && (
                <div className="ml-auto">
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
              )}
            </>
          )}
        </Button>
        
        {hasChildren && !isCollapsed && isExpanded && (
          <div className="mt-1 space-y-1 ml-2">
            {item.children.map((child: any) => renderMenuItem(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={cn(
      "bg-card border-r border-border flex flex-col transition-all duration-300",
      isCollapsed ? "w-16" : "w-64"
    )}>
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
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
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {menuItems.map((item) => renderMenuItem(item))}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-border">
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