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
  PlusSquare
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface StudentSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const menuItems = [
  { id: "feed", label: "Feed", icon: Home },
  { id: "dashboard", label: "My Dashboard", icon: LayoutDashboard },
  { id: "tasks", label: "Tasks", icon: ListTodo },
  { id: "create-task", label: "Create a Task", icon: PlusSquare },
  { id: "applications", label: "Applications", icon: FileText },
  { id: "uploads", label: "My Uploads", icon: Upload },
  { id: "portfolio", label: "My Portfolio", icon: User },
  { id: "progress", label: "Progress & XP", icon: TrendingUp },
  { id: "learning", label: "Learning Resources", icon: BookOpen },
  { id: "jobs", label: "Job Opportunities", icon: Briefcase },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "settings", label: "Settings", icon: Settings },
];

const StudentSidebar = ({ activeTab, onTabChange }: StudentSidebarProps) => {
  const { toast } = useToast();

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

  return (
    <aside className="w-56 sm:w-64 bg-sidebar backdrop-blur-sm border-r border-sidebar-border h-screen overflow-y-auto">
      <nav className="p-2 sm:p-4">
        <div className="space-y-1 sm:space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.id}
                variant="ghost"
                onClick={() => onTabChange(item.id)}
                className={cn(
                  "w-full justify-start gap-2 sm:gap-3 h-10 sm:h-12 text-left text-xs sm:text-sm px-2 sm:px-4",
                  activeTab === item.id 
                    ? "bg-primary/10 text-primary font-medium border border-primary/20" 
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <Icon className="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
                <span className="truncate text-xs sm:text-sm">{item.label}</span>
              </Button>
            );
          })}
          
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