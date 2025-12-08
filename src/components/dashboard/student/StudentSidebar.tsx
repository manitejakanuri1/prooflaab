import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { 
  Home,
  LayoutDashboard, 
  ListTodo,
  FileText,
  Upload, 
  User, 
  TrendingUp, 
  BookOpen,
  Briefcase,
  Bell, 
  Settings, 
  LogOut,
  PlusSquare,
  ChevronDown,
  ChevronRight,
  Building2,
  ClipboardList,
  Sparkles,
  Package,
  Trophy
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface StudentSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

interface MenuItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  route?: string;
  children?: MenuItem[];
}

const menuItems: MenuItem[] = [
  { id: "feed", label: "Feed", icon: Home, route: "/student/dashboard" },
  { id: "dashboard", label: "My Dashboard", icon: LayoutDashboard },
  { 
    id: "tasks", 
    label: "Tasks", 
    icon: ListTodo,
    children: [
      { id: "tasks-opportunities", label: "Startup Opportunities", icon: Building2, route: "/student/tasks/opportunities" },
      { id: "tasks-assigned", label: "Assigned Tasks", icon: ClipboardList, route: "/student/tasks/assigned" },
      { id: "tasks-created", label: "My Created Tasks", icon: Sparkles, route: "/student/tasks/created" },
      { id: "task-packs", label: "Task Packs", icon: Package, route: "/student/task-packs" },
    ]
  },
  { id: "create-task", label: "Create a Task", icon: PlusSquare },
  { id: "applications", label: "Applications", icon: FileText },
  { id: "uploads", label: "My Uploads", icon: Upload },
  { id: "portfolio", label: "My Portfolio", icon: User },
  { id: "progress", label: "Progress & XP", icon: TrendingUp },
  { id: "pack-leaderboard", label: "Pack Leaderboard", icon: Trophy, route: "/student/pack-leaderboard" },
  { id: "learning", label: "Learning Resources", icon: BookOpen },
  { id: "jobs", label: "Job Opportunities", icon: Briefcase },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "settings", label: "Settings", icon: Settings },
];

const StudentSidebar = ({ activeTab, onTabChange }: StudentSidebarProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  
  // Check if any tasks child is active to keep the group expanded
  const isTasksChildActive = menuItems
    .find(item => item.id === "tasks")
    ?.children?.some(child => child.id === activeTab) || false;
  
  const [tasksExpanded, setTasksExpanded] = useState(isTasksChildActive || activeTab === "tasks");

  const handleNavigation = (item: MenuItem) => {
    if (item.route) {
      navigate(item.route);
    } else {
      onTabChange(item.id);
    }
  };

  const handleSignOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      
      // Clear any cached data
      window.location.href = '/auth';
    } catch (error) {
      console.error('Error signing out:', error);
      toast({
        title: "Error",
        description: "Failed to sign out. Please try again.",
        variant: "destructive",
      });
    }
  };

  const renderMenuItem = (item: MenuItem) => {
    const Icon = item.icon;
    const hasChildren = item.children && item.children.length > 0;
    const isActive = activeTab === item.id;
    const hasActiveChild = item.children?.some(child => child.id === activeTab);

    if (hasChildren) {
      return (
        <Collapsible
          key={item.id}
          open={tasksExpanded}
          onOpenChange={setTasksExpanded}
        >
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className={cn(
                "w-full justify-start gap-2 sm:gap-3 h-10 sm:h-12 text-left text-xs sm:text-sm px-2 sm:px-4",
                hasActiveChild
                  ? "bg-primary/10 text-primary font-medium border border-primary/20" 
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
              <span className="truncate text-xs sm:text-sm flex-1">{item.label}</span>
              {tasksExpanded ? (
                <ChevronDown className="h-4 w-4 flex-shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 flex-shrink-0" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pl-4 sm:pl-6 space-y-1 mt-1">
            {item.children?.map((child) => {
              const ChildIcon = child.icon;
              const isChildActive = activeTab === child.id;
              return (
                <Button
                  key={child.id}
                  variant="ghost"
                  onClick={() => handleNavigation(child)}
                  className={cn(
                    "w-full justify-start gap-2 h-9 sm:h-10 text-left text-xs sm:text-sm px-2 sm:px-3",
                    isChildActive
                      ? "bg-primary/10 text-primary font-medium border border-primary/20" 
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <ChildIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
                  <span className="truncate text-xs sm:text-sm">{child.label}</span>
                </Button>
              );
            })}
          </CollapsibleContent>
        </Collapsible>
      );
    }

    return (
      <Button
        key={item.id}
        variant="ghost"
        onClick={() => handleNavigation(item)}
        className={cn(
          "w-full justify-start gap-2 sm:gap-3 h-10 sm:h-12 text-left text-xs sm:text-sm px-2 sm:px-4",
          isActive 
            ? "bg-primary/10 text-primary font-medium border border-primary/20" 
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}
      >
        <Icon className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
        <span className="truncate text-xs sm:text-sm">{item.label}</span>
      </Button>
    );
  };

  return (
    <aside className="w-56 sm:w-64 bg-sidebar backdrop-blur-sm border-r border-sidebar-border h-screen overflow-y-auto">
      <nav className="p-2 sm:p-4">
        <div className="space-y-1 sm:space-y-2">
          {menuItems.map(renderMenuItem)}
          
          {/* Sign Out Button */}
          <div className="pt-2 sm:pt-4 mt-2 sm:mt-4 border-t border-sidebar-border">
            <Button
              variant="ghost"
              onClick={handleSignOut}
              className="w-full justify-start gap-2 sm:gap-3 h-10 sm:h-12 text-left text-xs sm:text-sm px-2 sm:px-4 text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-300"
            >
              <LogOut className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
              <span className="truncate text-xs sm:text-sm">Sign Out</span>
            </Button>
          </div>
        </div>
      </nav>
    </aside>
  );
};

export default StudentSidebar;
