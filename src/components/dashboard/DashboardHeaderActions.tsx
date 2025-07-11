
import { Bell, Settings, User, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import NotificationsPopover from "./NotificationsPopover";
import SettingsModal from "./SettingsModal";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNotifications } from "@/hooks/useNotifications";

interface DashboardHeaderActionsProps {
  studentName: string;
  profilePhoto?: string | null;
}

export default function DashboardHeaderActions({ 
  studentName, 
  profilePhoto 
}: DashboardHeaderActionsProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const { signOut } = useAuth();
  const { notifications, unreadCount, markAsRead } = useNotifications();

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  // Transform notifications to match the expected interface
  const transformedNotifications = notifications.map(notification => ({
    id: notification.id,
    message: notification.message,
    type: notification.type as 'task' | 'feedback' | 'achievement' | 'general',
    time: new Date(notification.created_at).toLocaleDateString(),
    isRead: notification.is_read
  }));

  return (
    <div className="flex items-center space-x-4">      
      {/* Notifications */}
      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowNotifications(!showNotifications)}
          className="relative"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs">
              {unreadCount}
            </Badge>
          )}
        </Button>
        
        {showNotifications && (
          <NotificationsPopover 
            notifications={transformedNotifications}
            onClose={() => setShowNotifications(false)}
          />
        )}
      </div>
      
      {/* Profile Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="relative h-10 w-10 rounded-full">
            <Avatar className="h-10 w-10">
              <AvatarImage src={profilePhoto || ""} alt={studentName} />
              <AvatarFallback className="bg-orange-100 text-orange-800">
                {studentName.split(' ').map(name => name[0]).join('').toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56" align="end" forceMount>
          <div className="flex items-center justify-start gap-2 p-2">
            <div className="flex flex-col space-y-1 leading-none">
              <p className="font-medium">{studentName}</p>
              <p className="w-[200px] truncate text-sm text-muted-foreground">
                Student Dashboard
              </p>
            </div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowSettings(true)}>
            <Settings className="mr-2 h-4 w-4" />
            <span>Settings</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            <span>Sign out</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Settings Modal */}
      <SettingsModal 
        isOpen={showSettings} 
        onClose={() => setShowSettings(false)} 
      />
    </div>
  );
}
