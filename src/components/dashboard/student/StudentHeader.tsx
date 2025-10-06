import { Menu, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useNotifications } from "@/hooks/useNotifications";

interface StudentHeaderProps {
  studentName: string;
  profilePhoto?: string | null;
  onMenuClick: () => void;
  showMenuButton: boolean;
}

const StudentHeader = ({ 
  studentName, 
  profilePhoto, 
  onMenuClick, 
  showMenuButton 
}: StudentHeaderProps) => {
  const { unreadCount } = useNotifications();
  
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <header className="bg-white/90 backdrop-blur-sm border-b border-orange-200/30 px-6 py-4">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        {/* Logo and Menu */}
        <div className="flex items-center space-x-4">
          {showMenuButton && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onMenuClick}
              className="p-2"
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
          
          <div className="text-gray-900 font-bold text-lg flex items-center space-x-3">
            <img 
              src="/lovable-uploads/b9197a47-7e43-4b27-8ab7-ce8138fcd94c.png" 
              alt="ProofLabAI Logo" 
              className="h-12 w-12"
            />
            <span>ProofLabAI</span>
          </div>
        </div>
        
        {/* User Profile */}
        <div className="flex items-center space-x-3">
          <Button variant="ghost" size="sm" className="relative">
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <Badge variant="destructive" className="absolute -top-1 -right-1 h-4 w-4 p-0 flex items-center justify-center text-[10px]">
                {unreadCount}
              </Badge>
            )}
          </Button>
          
          <span className="text-sm text-gray-600 hidden sm:block">
            Welcome, {studentName}
          </span>
          <Avatar className="h-10 w-10">
            <AvatarImage src={profilePhoto || undefined} alt={studentName} />
            <AvatarFallback className="bg-orange-100 text-orange-700">
              {getInitials(studentName)}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  );
};

export default StudentHeader;