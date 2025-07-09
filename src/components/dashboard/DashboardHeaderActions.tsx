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
  Briefcase,
  Calendar,
  CheckCircle2,
  ChevronDown,
  File,
  MessageSquare,
  Plus,
  Settings,
  User,
  X,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/contexts/AuthContext";

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
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const { signOut } = useAuth();

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    }
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
          <Button variant="outline" size="icon">
            <Bell className="h-5 w-5" />
            <span className="sr-only">Toggle notifications</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-80 p-0"
          align="end"
          alignOffset={-10}
          forceMount
        >
          <div className="p-2">
            <h4 className="font-medium text-sm text-gray-500 px-2 mb-1">
              Notifications
            </h4>
            <ScrollArea className="h-[300px] pr-2">
              {notifications.length > 0 ? (
                notifications.map((notification) => (
                  <div
                    key={notification.id}
                    className="flex items-start space-x-3 py-3 px-2 rounded-md hover:bg-gray-100 transition-colors duration-200"
                  >
                    {notification.type === "task" ? (
                      <Briefcase className="h-4 w-4 text-gray-500 mt-0.5" />
                    ) : (
                      <MessageSquare className="h-4 w-4 text-gray-500 mt-0.5" />
                    )}
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-none text-gray-800">
                        {notification.message}
                      </p>
                      <p className="text-xs text-gray-500">{notification.time}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-4 px-2 text-center text-sm text-gray-500">
                  No notifications yet
                </div>
              )}
            </ScrollArea>
            <Separator />
            <div className="p-2">
              <Button variant="link" className="w-full justify-start">
                <Settings className="h-4 w-4 mr-2" />
                Notification Settings
              </Button>
            </div>
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
          </div>
          <Separator />
          <div className="grid gap-2 px-2">
            <Button variant="ghost" className="justify-start">
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
    </div>
  );
}
