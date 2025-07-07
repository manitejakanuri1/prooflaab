
import { useState } from "react";
import { Bell, Settings, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import NotificationsPopover from "@/components/dashboard/NotificationsPopover";

interface Notification {
  id: string;
  message: string;
  type: "task" | "feedback";
  time: string;
  isRead: boolean;
}

interface DashboardHeaderActionsProps {
  studentName: string;
  profilePhoto: string | null;
  notifications: Notification[];
}

export default function DashboardHeaderActions({ 
  studentName, 
  profilePhoto, 
  notifications 
}: DashboardHeaderActionsProps) {
  const [showNotifications, setShowNotifications] = useState(false);
  const unreadNotifications = notifications.filter((n) => !n.isRead).length;

  return (
    <div className="flex items-center space-x-4">
      {/* Notifications */}
      <div className="relative">
        <Button
          variant="ghost"
          size="sm"
          className="relative p-3 hover:bg-white/60 rounded-xl"
          onClick={() => setShowNotifications(!showNotifications)}
        >
          <Bell className="h-5 w-5 text-gray-600" />
          {unreadNotifications > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
              {unreadNotifications}
            </span>
          )}
        </Button>
        {showNotifications && (
          <NotificationsPopover 
            notifications={notifications}
            onClose={() => setShowNotifications(false)}
          />
        )}
      </div>

      {/* Settings */}
      <Button variant="ghost" size="sm" className="p-3 hover:bg-white/60 rounded-xl">
        <Settings className="h-5 w-5 text-gray-600" />
      </Button>

      {/* User Avatar with Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="relative h-10 w-10 rounded-xl hover:bg-white/60">
            <Avatar className="h-10 w-10">
              <AvatarImage src={profilePhoto || ""} alt={studentName} />
              <AvatarFallback className="bg-gray-900 text-white">
                {studentName.split(' ').map(n => n[0]).join('')}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56 bg-white shadow-xl border-0 rounded-2xl" align="end">
          <DropdownMenuItem className="p-3 hover:bg-gray-50 rounded-xl m-1">
            <Settings className="mr-3 h-4 w-4" />
            <span>Settings</span>
          </DropdownMenuItem>
          <DropdownMenuItem className="p-3 hover:bg-gray-50 rounded-xl m-1">
            <LogOut className="mr-3 h-4 w-4" />
            <span>Log out</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
