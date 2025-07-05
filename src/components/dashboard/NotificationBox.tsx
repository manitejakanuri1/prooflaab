
import { Bell, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface Notification {
  id: string;
  message: string;
  type: 'task' | 'feedback' | 'achievement';
  time: string;
}

interface NotificationBoxProps {
  notifications: Notification[];
}

export default function NotificationBox({ notifications }: NotificationBoxProps) {
  const [activeNotifications, setActiveNotifications] = useState(notifications);

  const removeNotification = (id: string) => {
    setActiveNotifications(prev => prev.filter(n => n.id !== id));
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'task': return '📋';
      case 'feedback': return '💬';
      case 'achievement': return '🎉';
      default: return '🔔';
    }
  };

  if (activeNotifications.length === 0) return null;

  return (
    <Card className="mb-8 border-blue-200 bg-blue-50">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Bell className="h-5 w-5 text-blue-600" />
          🔔 Notifications
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {activeNotifications.map((notification) => (
            <div key={notification.id} className="flex items-start justify-between bg-white p-3 rounded-lg border">
              <div className="flex items-start gap-3">
                <span className="text-lg">{getNotificationIcon(notification.type)}</span>
                <div>
                  <p className="text-sm text-gray-900">{notification.message}</p>
                  <p className="text-xs text-gray-500 mt-1">{notification.time}</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => removeNotification(notification.id)}
                className="h-6 w-6 p-0 hover:bg-gray-100"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
