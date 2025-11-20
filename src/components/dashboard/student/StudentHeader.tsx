import { Menu, Bell, CheckCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useNotifications } from "@/hooks/useNotifications";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Logo } from "@/components/Logo";

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
  const { notifications, unreadCount, markAsRead, markAllAsRead, deleteNotification } = useNotifications();
  
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <header className="bg-background/90 backdrop-blur-sm border-b border-border px-3 sm:px-6 py-3 sm:py-4 dark:bg-card/90">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        {/* Logo and Menu */}
        <div className="flex items-center space-x-2 md:space-x-6">
          {showMenuButton && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onMenuClick}
              className="p-1.5 sm:p-2"
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
          
          <div className="text-gray-900 dark:text-white px-3 md:px-6 py-2 md:py-3 rounded-2xl font-bold text-sm md:text-lg flex items-center space-x-2 md:space-x-3">
            <Logo className="h-8 w-8 md:h-12 md:w-12" />
            <span className="hidden sm:inline">ProofLabAI</span>
          </div>
          
          <h1 className="text-xl font-bold hidden sm:block">Students Dashboard</h1>
        </div>
        
        {/* User Profile */}
        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="relative p-1.5 sm:p-2 hover:bg-accent">
                <Bell className="h-4 w-4 sm:h-5 sm:w-5" />
                {unreadCount > 0 && (
                  <Badge 
                    variant="destructive" 
                    className="absolute -top-1 -right-1 h-4 w-4 sm:h-5 sm:w-5 min-w-[16px] sm:min-w-[20px] p-0 flex items-center justify-center text-[9px] sm:text-[10px] font-bold rounded-full pointer-events-none"
                    style={{ zIndex: 10 }}
                  >
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[calc(100vw-2rem)] sm:w-96 p-0" align="end" sideOffset={8}>
              <div className="flex items-center justify-between p-4 border-b">
                <h3 className="font-semibold text-base">Notifications</h3>
                {unreadCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={markAllAsRead}
                    className="h-8 text-xs"
                  >
                    <CheckCheck className="h-4 w-4 mr-1" />
                    Mark all read
                  </Button>
                )}
              </div>
              <ScrollArea className="h-[400px]">
                {notifications.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <Bell className="h-12 w-12 mx-auto mb-2 opacity-20" />
                    <p>No notifications</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {notifications.map((notification) => (
                      <div
                        key={notification.id}
                        className={`p-4 hover:bg-accent/50 transition-colors cursor-pointer ${
                          !notification.is_read ? 'bg-primary/5' : ''
                        }`}
                        onClick={() => {
                          if (!notification.is_read) {
                            markAsRead(notification.id);
                          }
                        }}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-1 space-y-1">
                            <div className="flex items-start justify-between gap-2">
                              <p className={`text-sm ${!notification.is_read ? 'font-semibold' : 'font-normal'}`}>
                                {notification.title}
                              </p>
                              {!notification.is_read && (
                                <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1.5" />
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {notification.message}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteNotification(notification.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </PopoverContent>
          </Popover>
          
          <span className="text-xs sm:text-sm text-muted-foreground hidden md:block truncate max-w-[120px]">
            Welcome, {studentName}
          </span>
          <Avatar className="h-8 w-8 sm:h-10 sm:w-10">
            <AvatarImage src={profilePhoto || undefined} alt={studentName} />
            <AvatarFallback className="bg-primary/10 text-primary text-xs sm:text-sm">
              {getInitials(studentName)}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>
    </header>
  );
};

export default StudentHeader;