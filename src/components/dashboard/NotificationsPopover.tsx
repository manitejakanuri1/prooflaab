
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, Bell, CheckCircle, MessageCircle, Award } from "lucide-react";

interface Notification {
  id: string;
  message: string;
  type: 'task' | 'feedback' | 'achievement' | 'general';
  time: string;
  isRead: boolean;
}

interface NotificationsPopoverProps {
  notifications: Notification[];
  onClose: () => void;
}

export default function NotificationsPopover({ notifications, onClose }: NotificationsPopoverProps) {
  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'task': return <CheckCircle className="h-4 w-4 text-blue-600" />;
      case 'feedback': return <MessageCircle className="h-4 w-4 text-green-600" />;
      case 'achievement': return <Award className="h-4 w-4 text-yellow-600" />;
      default: return <Bell className="h-4 w-4 text-gray-600" />;
    }
  };

  return (
    <div className="absolute right-0 top-12 z-50">
      <Card className="w-80 bg-white border shadow-xl rounded-2xl">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
            <Bell className="h-5 w-5" />
            <span>Notifications</span>
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="p-0 max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              <Bell className="h-8 w-8 mx-auto mb-2 text-gray-300" />
              <p>No notifications</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {notifications.map((notification) => (
                <div key={notification.id} className={`p-4 hover:bg-gray-50 transition-colors ${
                  !notification.isRead ? 'bg-blue-50/50' : ''
                }`}>
                  <div className="flex items-start space-x-3">
                    <div className="mt-0.5">
                      {getNotificationIcon(notification.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 leading-relaxed">
                        {notification.message}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">{notification.time}</p>
                      {!notification.isRead && (
                        <div className="w-2 h-2 bg-blue-500 rounded-full mt-1"></div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
