
import { Bell, X, MessageCircle, Award as AwardIcon, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

interface Notification {
  id: string;
  message: string;
  type: 'task' | 'feedback' | 'achievement' | 'general';
  time: string;
  isRead: boolean;
}

interface NotificationsSectionProps {
  notifications: Notification[];
}

export default function NotificationsSection({ notifications }: NotificationsSectionProps) {
  const [activeNotifications, setActiveNotifications] = useState(notifications);

  const removeNotification = (id: string) => {
    setActiveNotifications(prev => prev.filter(n => n.id !== id));
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'task': return <CheckCircle className="h-4 w-4 text-blue-600" />;
      case 'feedback': return <MessageCircle className="h-4 w-4 text-green-600" />;
      case 'achievement': return <AwardIcon className="h-4 w-4 text-yellow-600" />;
      default: return <Bell className="h-4 w-4 text-gray-600" />;
    }
  };

  const getNotificationEmoji = (type: string) => {
    switch (type) {
      case 'task': return '📋';
      case 'feedback': return '💬';
      case 'achievement': return '🎉';
      default: return '🔔';
    }
  };

  const unreadCount = activeNotifications.filter(n => !n.isRead).length;

  return (
    <Card className="border-0 shadow-lg">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-t-lg">
        <CardTitle className="text-lg font-semibold text-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            🔔 Notifications
            <Bell className="h-5 w-5 text-blue-600" />
          </div>
          {unreadCount > 0 && (
            <Badge variant="default" className="bg-red-500 text-white">
              {unreadCount}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {activeNotifications.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            <Bell className="h-8 w-8 mx-auto mb-2 text-gray-300" />
            <p>No notifications</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
            {activeNotifications.map((notification) => (
              <div key={notification.id} className={`p-4 hover:bg-gray-50 transition-colors ${!notification.isRead ? 'bg-blue-50/50' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-lg">{getNotificationEmoji(notification.type)}</span>
                      {getNotificationIcon(notification.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 leading-relaxed">{notification.message}</p>
                      <p className="text-xs text-gray-500 mt-1">{notification.time}</p>
                      {!notification.isRead && (
                        <div className="w-2 h-2 bg-blue-500 rounded-full mt-1"></div>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeNotification(notification.id)}
                    className="h-6 w-6 p-0 hover:bg-gray-200 shrink-0"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
