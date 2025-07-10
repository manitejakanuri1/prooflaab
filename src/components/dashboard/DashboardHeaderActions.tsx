
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Bell,
  Calendar,
  File,
  Plus,
  Settings,
  User,
  X,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useNotifications } from "@/hooks/useNotifications";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import NotificationItem from "./NotificationItem";
import SettingsModal from "./SettingsModal";

interface DashboardHeaderActionsProps {
  studentName: string;
  profilePhoto: string | null;
}

export default function DashboardHeaderActions({ 
  studentName, 
  profilePhoto
}: DashboardHeaderActionsProps) {
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { signOut } = useAuth();
  const { notifications, isLoading, unreadCount, markAsRead } = useNotifications();
  const { profile } = useStudentProfile();

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const handleNotificationClick = (notificationId: string) => {
    markAsRead(notificationId);
  };

  const handleViewPortfolio = () => {
    if (profile?.slug) {
      window.open(`/portfolio/${profile.slug}`, '_blank');
    }
  };

  const handleSettingsClick = () => {
    setIsSettingsOpen(true);
  };

  return (
    <div className="flex items-center space-x-4">
      {/* Add Task Button */}
      <Button variant="secondary" size="sm">
        <Plus className="h-4 w-4 mr-2" />
        Add Task
      </Button>

      {/* Notification Popover */}
      <Popover open={isNotificationsOpen} onOpenChange={setIsNotificationsOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="icon" className="relative">
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <Badge 
                variant="destructive" 
                className="absolute -top-2 -right-2 h-5 w-5 flex items-center justify-center p-0 text-xs"
              >
                {unreadCount}
              </Badge>
            )}
            <span className="sr-only">Toggle notifications</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-80 p-0"
          align="end"
          alignOffset={-10}
          forceMount
        >
          <div className="p-4 border-b">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-sm text-gray-900">
                Notifications
              </h4>
              {unreadCount > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {unreadCount} new
                </Badge>
              )}
            </div>
          </div>
          
          <ScrollArea className="max-h-[400px]">
            {isLoading ? (
              <div className="p-4 text-center text-sm text-gray-500">
                Loading notifications...
              </div>
            ) : notifications.length > 0 ? (
              <div className="divide-y divide-gray-100">
                {notifications.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    id={notification.id}
                    type={notification.type}
                    message={notification.message}
                    isRead={notification.is_read}
                    createdAt={notification.created_at}
                    onClick={handleNotificationClick}
                  />
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-sm text-gray-500">
                <Bell className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                <p>No notifications yet</p>
              </div>
            )}
          </ScrollArea>
          
          <Separator />
          <div className="p-2">
            <Button 
              variant="ghost" 
              className="w-full justify-start text-sm"
              onClick={handleSettingsClick}
            >
              <Settings className="h-4 w-4 mr-2" />
              Notification Settings
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Profile Dropdown */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" className="pl-3 pr-0 h-8">
            <div className="flex items-center space-x-2">
              <Avatar className="h-8 w-8">
                <AvatarImage src={profilePhoto || ""} alt={studentName} />
                <AvatarFallback>
                  {studentName.split(" ").map((n) => n[0]).join("")}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium leading-none">{studentName}</span>
            </div>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-60" align="end" alignOffset={-10} forceMount>
          <div className="grid gap-2 px-2">
            <Button variant="ghost" className="justify-start">
              <User className="h-4 w-4 mr-2" />
              My Profile
            </Button>
            <Button variant="ghost" className="justify-start">
              <Calendar className="h-4 w-4 mr-2" />
              My Tasks
            </Button>
            <Button variant="ghost" className="justify-start">
              <File className="h-4 w-4 mr-2" />
              My Uploads
            </Button>
            <Button 
              variant="ghost" 
              className="justify-start" 
              onClick={handleViewPortfolio}
              disabled={!profile?.slug}
            >
              📂 View My Portfolio
            </Button>
          </div>
          <Separator />
          <div className="grid gap-2 px-2">
            <Button 
              variant="ghost" 
              className="justify-start"
              onClick={handleSettingsClick}
            >
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Button>
            <Button variant="ghost" className="justify-start" onClick={handleSignOut}>
              <X className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Settings Modal */}
      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
      />
    </div>
  );
}
