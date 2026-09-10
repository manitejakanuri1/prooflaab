import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, Check, X, AlertCircle, Info, CheckCircle2, Clock } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useCollegeNotifications } from "@/hooks/useCollegeNotifications";
import { ADMIN_LIST_CAP } from "@/lib/listCaps";

const VIEWED_NOTIFICATIONS_KEY = 'college_viewed_notifications';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  student_name?: string;
  task_title?: string;
}

const NotificationsSection = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { markAsViewed, refetch: refetchBadge } = useCollegeNotifications();

  useEffect(() => {
    fetchNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchNotifications = async () => {
    try {
      setLoading(true);
      
      // Get viewed notifications from localStorage
      const viewedNotifications = JSON.parse(
        localStorage.getItem(VIEWED_NOTIFICATIONS_KEY) || '[]'
      ) as string[];
      
      // Get recent proof submissions and task applications as notifications
      const { data: proofs, error: proofsError } = await supabase
        .from('proof_uploads')
        .select(`
          id,
          submitted_at,
          status,
          student_id,
          task_id,
          student_profiles!inner(full_name),
          tasks!inner(title)
        `)
        .order('submitted_at', { ascending: false }).limit(ADMIN_LIST_CAP)
        .limit(20);

      if (proofsError) {
        console.error('Error fetching proof notifications:', proofsError);
      }

      const { data: applications, error: appsError } = await supabase
        .from('task_applications')
        .select(`
          id,
          created_at,
          status,
          student_id,
          task_id,
          student_profiles!inner(full_name),
          tasks!inner(title)
        `)
        .order('created_at', { ascending: false }).limit(ADMIN_LIST_CAP)
        .limit(20);

      if (appsError) {
        console.error('Error fetching application notifications:', appsError);
      }

      // Transform data into notifications
      const proofNotifications = (proofs || []).map(proof => ({
        id: `proof-${proof.id}`,
        type: 'proof',
        title: proof.status === 'Under Review' ? 'New Proof Submitted' : `Proof ${proof.status}`,
        message: `${proof.student_profiles.full_name} submitted proof for "${proof.tasks.title}"`,
        is_read: viewedNotifications.includes(`proof-${proof.id}`),
        created_at: proof.submitted_at,
        student_name: proof.student_profiles.full_name,
        task_title: proof.tasks.title,
      }));

      const appNotifications = (applications || []).map(app => ({
        id: `app-${app.id}`,
        type: 'application',
        title: 'New Task Application',
        message: `${app.student_profiles.full_name} applied for "${app.tasks.title}"`,
        is_read: viewedNotifications.includes(`app-${app.id}`),
        created_at: app.created_at,
        student_name: app.student_profiles.full_name,
        task_title: app.tasks.title,
      }));

      // Combine and sort by date
      const allNotifications = [...proofNotifications, ...appNotifications]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setNotifications(allNotifications);
    } catch (error) {
      console.error('Error fetching notifications:', error);
      toast({
        title: "Error",
        description: "Failed to fetch notifications",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'proof':
        return <CheckCircle2 className="h-4 w-4 text-blue-500" />;
      case 'application':
        return <Clock className="h-4 w-4 text-orange-500" />;
      case 'task':
        return <AlertCircle className="h-4 w-4 text-green-500" />;
      default:
        return <Info className="h-4 w-4 text-gray-500" />;
    }
  };

  const getNotificationBadge = (type: string) => {
    switch (type) {
      case 'proof':
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Proof</Badge>;
      case 'application':
        return <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">Application</Badge>;
      case 'task':
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Task</Badge>;
      default:
        return <Badge variant="outline">General</Badge>;
    }
  };

  const markAsRead = (notificationId: string) => {
    // Update local state
    setNotifications(prev =>
      prev.map(notif =>
        notif.id === notificationId
          ? { ...notif, is_read: true }
          : notif
      )
    );
    
    // Persist to localStorage
    markAsViewed([notificationId]);
  };

  const markAllAsRead = () => {
    // Get all notification IDs
    const allIds = notifications.map(n => n.id);
    
    // Update local state
    setNotifications(prev =>
      prev.map(notif => ({ ...notif, is_read: true }))
    );
    
    // Persist to localStorage
    markAsViewed(allIds);
    
    toast({
      title: "Success",
      description: "All notifications marked as read",
    });
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <span className="ml-2">Loading notifications...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Notifications
              {unreadCount > 0 && (
                <Badge variant="destructive" className="ml-2">
                  {unreadCount} new
                </Badge>
              )}
            </CardTitle>
            {unreadCount > 0 && (
              <Button variant="outline" size="sm" onClick={markAllAsRead}>
                <Check className="h-4 w-4 mr-2" />
                Mark all as read
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Notifications List */}
      <Card>
        <CardContent className="p-0">
          {notifications.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Bell className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-medium mb-2">No notifications yet</h3>
              <p>You'll see notifications here when students submit proofs or apply for tasks.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`p-4 hover:bg-gray-50 transition-colors ${
                    !notification.is_read ? 'bg-blue-50/50 border-l-4 border-l-blue-500' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      {getNotificationIcon(notification.type)}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-medium text-gray-900">
                          {notification.title}
                        </h4>
                        {getNotificationBadge(notification.type)}
                        {!notification.is_read && (
                          <Badge variant="secondary" className="bg-blue-100 text-blue-800 text-xs">
                            New
                          </Badge>
                        )}
                      </div>
                      
                      <p className="text-sm text-gray-600 mb-2">
                        {notification.message}
                      </p>
                      
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">
                          {format(new Date(notification.created_at), 'MMM dd, yyyy • h:mm a')}
                        </span>
                        
                        {!notification.is_read && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => markAsRead(notification.id)}
                            className="text-xs"
                          >
                            Mark as read
                          </Button>
                        )}
                      </div>
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
};

export default NotificationsSection;