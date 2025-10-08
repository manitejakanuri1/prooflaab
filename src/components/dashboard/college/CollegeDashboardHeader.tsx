import { Bell, User, Settings, LogOut, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Logo } from "@/components/Logo";

interface CollegeDashboardHeaderProps {
  collegeName: string;
  profilePhoto?: string | null;
  onMenuClick?: () => void;
  showMenuButton?: boolean;
}

const CollegeDashboardHeader = ({ collegeName, profilePhoto, onMenuClick, showMenuButton }: CollegeDashboardHeaderProps) => {
  const { signOut } = useAuth();
  const { toast } = useToast();

  const handleSignOut = async () => {
    try {
      await signOut();
      toast({
        title: "Success",
        description: "Successfully logged out",
      });
      // Redirect to auth page
      window.location.href = '/auth';
    } catch (error) {
      console.error('Error signing out:', error);
      toast({
        title: "Error",
        description: "Failed to sign out",
        variant: "destructive",
      });
    }
  };

  return (
    <header className="bg-background/90 backdrop-blur-sm border-b border-border px-3 md:px-6 py-4 dark:bg-card/90">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        {/* Logo and Title */}
        <div className="flex items-center space-x-2 md:space-x-6">
          {/* Mobile menu button */}
          {showMenuButton && (
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={onMenuClick}
              className="md:hidden"
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
          
          <div className="text-gray-900 dark:text-white px-3 md:px-6 py-2 md:py-3 rounded-2xl font-bold text-sm md:text-lg flex items-center space-x-2 md:space-x-3">
            <Logo className="h-8 w-8 md:h-12 md:w-12" />
            <span className="hidden sm:inline">ProofLabAI</span>
          </div>
          
          <h1 className="text-lg md:text-2xl font-semibold hidden sm:block">College Dashboard</h1>
        </div>
        
        {/* Profile Actions */}
        <div className="flex items-center space-x-2 md:space-x-4">
          <ThemeToggle />
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="h-4 w-4 md:h-5 md:w-5" />
            <span className="absolute -top-1 -right-1 h-2 w-2 md:h-3 md:w-3 bg-red-500 rounded-full"></span>
          </Button>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center space-x-1 md:space-x-2 h-auto p-1 md:p-2">
                <Avatar className="h-6 w-6 md:h-8 md:w-8">
                  <AvatarImage src={profilePhoto || ""} />
                  <AvatarFallback className="bg-orange-200 text-orange-800 text-xs md:text-sm">
                    {collegeName.split(' ').map(word => word[0]).join('').slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-xs md:text-sm font-medium hidden sm:inline">{collegeName}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem>
                <User className="mr-2 h-4 w-4" />
                My Profile
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut}>
                <LogOut className="mr-2 h-4 w-4" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
};

export default CollegeDashboardHeader;