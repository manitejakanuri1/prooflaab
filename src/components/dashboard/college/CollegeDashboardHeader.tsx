import { Bell, User, Settings, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface CollegeDashboardHeaderProps {
  collegeName: string;
  profilePhoto?: string | null;
}

const CollegeDashboardHeader = ({ collegeName, profilePhoto }: CollegeDashboardHeaderProps) => {
  return (
    <header className="bg-white/90 backdrop-blur-sm border-b border-orange-200/30 px-6 py-4">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        {/* Logo and Title */}
        <div className="flex items-center space-x-6">
          <div className="text-gray-900 px-6 py-3 rounded-2xl font-bold text-lg flex items-center space-x-3">
            <img 
              src="/lovable-uploads/b9197a47-7e43-4b27-8ab7-ce8138fcd94c.png" 
              alt="ProofLabAI Logo" 
              className="h-12 w-12"
            />
            <span>ProofLabAI</span>
          </div>
          
          <h1 className="text-2xl font-semibold text-gray-800">College Dashboard</h1>
        </div>
        
        {/* Profile Actions */}
        <div className="flex items-center space-x-4">
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="h-5 w-5" />
            <span className="absolute -top-1 -right-1 h-3 w-3 bg-red-500 rounded-full"></span>
          </Button>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center space-x-2 h-auto p-2">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={profilePhoto || ""} />
                  <AvatarFallback className="bg-orange-200 text-orange-800">
                    {collegeName.split(' ').map(word => word[0]).join('').slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium">{collegeName}</span>
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
              <DropdownMenuItem>
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