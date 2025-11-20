import React, { useState } from "react";
import { Bell, Menu } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useAdminNotifications } from "@/hooks/useAdminNotifications";
import AdminNotificationsPopover from "./AdminNotificationsPopover";

interface AdminHeaderProps {
  onMenuClick?: () => void;
  showMenuButton?: boolean;
}

const AdminHeader = ({ onMenuClick, showMenuButton }: AdminHeaderProps) => {
  const { recentNotifications, unreadCount, markAsRead, markAllAsRead } = useAdminNotifications();
  const [showNotifications, setShowNotifications] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-background border-b border-border h-16 flex items-center justify-between px-3 md:px-6">
      <div className="flex items-center space-x-2 md:space-x-4">
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
        <h1 className="text-xl font-bold">Admin Dashboard</h1>
      </div>
      
      <div className="flex items-center space-x-2">
        <ThemeToggle />
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
        <div className="bg-primary/10 px-3 py-1 rounded-full">
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