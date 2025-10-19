import { Shield, Bell } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { useAdminNotifications } from "@/hooks/useAdminNotifications";
import AdminNotificationsPopover from "./AdminNotificationsPopover";
import { useState } from "react";

const AdminHeader = () => {
  const { recentNotifications, unreadCount, markAsRead, markAllAsRead } = useAdminNotifications();
  const [showNotifications, setShowNotifications] = useState(false);

  return (
    <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border h-14 md:h-16 flex items-center justify-between px-3 md:px-6">
      <div className="flex items-center space-x-2 md:space-x-4">
        <SidebarTrigger />
        
        <div className="flex items-center space-x-2 md:space-x-3">
          <div className="bg-gradient-to-r from-orange-500 to-orange-600 p-1.5 md:p-2 rounded-lg">
            <Shield className="h-4 w-4 md:h-6 md:w-6 text-white" />
          </div>
          <div className="hidden sm:block">
            <h1 className="text-base md:text-lg font-bold">Admin Panel</h1>
            <p className="text-xs text-muted-foreground hidden md:block">Review & Management System</p>
          </div>
        </div>
      </div>
      
      <div className="flex items-center space-x-1 md:space-x-2">
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          onClick={() => setShowNotifications(!showNotifications)}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center font-medium">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
        <ThemeToggle />
        <div className="bg-primary/10 px-2 md:px-3 py-1 rounded-full">
          <span className="text-xs font-medium text-primary">Admin</span>
        </div>
      </div>

      {showNotifications && (
        <AdminNotificationsPopover
          notifications={recentNotifications}
          onClose={() => setShowNotifications(false)}
          onMarkAsRead={markAsRead}
          onMarkAllAsRead={markAllAsRead}
        />
      )}
    </header>
  );
};

export default AdminHeader;