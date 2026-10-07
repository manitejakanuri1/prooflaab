import { Home, Users, ClipboardList, LogOut, Briefcase } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface StartupSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  isVerified: boolean;
}

// Four destinations. Submissions and Reviews live inside Lots; the shortlist and job
// posts live inside Hiring (see StartupDashboardContent).
const sidebarItems = [
  { id: "home", title: "Home", icon: Home },
  { id: "talent", title: "Talent", icon: Users },
  { id: "lots", title: "Lots", icon: ClipboardList },
  { id: "hiring", title: "Hiring", icon: Briefcase },
];

// Talent is not here: the recruiter screen explains verification itself.
const restrictedTabs = ["lots", "hiring"];

export function StartupSidebar({ activeTab, onTabChange, isVerified }: StartupSidebarProps) {
  const { signOut } = useAuth();

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  return (
    <Sidebar className="w-64">
      <SidebarContent>
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">S</span>
            </div>
            <div>
              <h2 className="font-semibold text-sm">Company</h2>
              <p className="text-xs text-muted-foreground">Find & hire talent</p>
            </div>
          </div>
        </div>

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <TooltipProvider>
                {sidebarItems.map((item) => {
                  const isRestricted = restrictedTabs.includes(item.id);
                  const isDisabled = isRestricted && !isVerified;

                  return (
                    <SidebarMenuItem key={item.id}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="w-full">
                            <SidebarMenuButton
                              onClick={() => !isDisabled && onTabChange(item.id)}
                              disabled={isDisabled}
                              className={`w-full justify-start ${
                                activeTab === item.id 
                                  ? "bg-primary/10 text-primary font-medium" 
                                  : "hover:bg-muted/50"
                              } ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
                            >
                              <item.icon className="h-4 w-4" />
                              <span className="ml-2">{item.title}</span>
                            </SidebarMenuButton>
                          </div>
                        </TooltipTrigger>
                        {isDisabled && (
                          <TooltipContent side="right">
                            <p>Action disabled until account verification</p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </SidebarMenuItem>
                  );
                })}
              
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={handleLogout}
                    className="w-full justify-start text-destructive hover:bg-destructive/10"
                  >
                    <LogOut className="h-4 w-4" />
                    <span className="ml-2">Logout</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </TooltipProvider>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}