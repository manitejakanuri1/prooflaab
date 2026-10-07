import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useNotifications } from "@/hooks/useNotifications";
import { formatDistanceToNow } from "date-fns";
import { Bell, Check, CheckCheck, Trash2, Filter, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const StudentNotificationsPage = () => {
  const { notifications, isLoading, markAsRead, deleteNotification, markAllAsRead } = useNotifications();
  const [filter, setFilter] = useState<string[]>(['all']);
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleDelete = (notificationId: string) => {
    deleteNotification(notificationId);
    toast({
      title: "Notification deleted",
      description: "The notification has been removed.",
    });
  };

  const handleMarkAllAsRead = () => {
    markAllAsRead();
    toast({
      title: "All notifications marked as read",
      description: "All unread notifications have been marked as read.",
    });
  };

  const handleNotificationClick = (notification: any) => {
    if (!notification.is_read) {
      markAsRead(notification.id);
    }
    if (notification.link) {
      navigate(notification.link);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const unreadCount = notifications?.filter(n => !n.is_read).length || 0;

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'task':
      case 'task_posted':
        return '📋';
      case 'announcement':
        return '📢';
      case 'proof':
        return '📤';
      case 'review':
        return '✅';
      case 'achievement':
        return '🎉';
      case 'follow':
        return '👤';
      case 'like':
        return '❤️';
      case 'comment':
        return '💬';
      case 'new_post':
        return '📝';
      default:
        return '🔔';
    }
  };

  const getNotificationColor = (type: string) => {
    switch (type) {
      case 'task':
      case 'task_posted':
        return 'bg-blue-100 text-blue-800';
      case 'announcement':
        return 'bg-purple-100 text-purple-800';
      case 'proof':
        return 'bg-indigo-100 text-indigo-800';
      case 'review':
        return 'bg-green-100 text-green-800';
      case 'achievement':
        return 'bg-orange-100 text-orange-800';
      case 'follow':
        return 'bg-pink-100 text-pink-800';
      case 'like':
        return 'bg-red-100 text-red-800';
      case 'comment':
        return 'bg-cyan-100 text-cyan-800';
      case 'new_post':
        return 'bg-emerald-100 text-emerald-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const filteredNotifications = notifications?.filter(notification => {
    if (filter.includes('all')) return true;
    return filter.includes(notification.type);
  }) || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <CardTitle className="text-xl font-semibold">Notifications</CardTitle>
              {unreadCount > 0 && (
                <Badge className="bg-red-100 text-red-800">
                  {unreadCount} unread
                </Badge>
              )}
            </div>
            <div className="flex items-center space-x-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Filter className="h-4 w-4 mr-2" />
                    Filter
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuCheckboxItem
                    checked={filter.includes('all')}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setFilter(['all']);
                      }
                    }}
                  >
                    All Notifications
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={filter.includes('task')}
                    onCheckedChange={(checked) => {
                      setFilter(prev => 
                        checked 
                          ? [...prev.filter(f => f !== 'all'), 'task']
                          : prev.filter(f => f !== 'task')
                      );
                    }}
                  >
                    Tasks
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={filter.includes('review')}
                    onCheckedChange={(checked) => {
                      setFilter(prev => 
                        checked 
                          ? [...prev.filter(f => f !== 'all'), 'review']
                          : prev.filter(f => f !== 'review')
                      );
                    }}
                  >
                    Reviews
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={filter.includes('achievement')}
                    onCheckedChange={(checked) => {
                      setFilter(prev => 
                        checked 
                          ? [...prev.filter(f => f !== 'all'), 'achievement']
                          : prev.filter(f => f !== 'achievement')
                      );
                    }}
                  >
                    Achievements
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={filter.includes('announcement')}
                    onCheckedChange={(checked) => {
                      setFilter(prev => 
                        checked 
                          ? [...prev.filter(f => f !== 'all'), 'announcement']
                          : prev.filter(f => f !== 'announcement')
                      );
                    }}
                  >
                    Announcements
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={filter.includes('follow')}
                    onCheckedChange={(checked) => {
                      setFilter(prev => 
                        checked 
                          ? [...prev.filter(f => f !== 'all'), 'follow']
                          : prev.filter(f => f !== 'follow')
                      );
                    }}
                  >
                    Follows
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={filter.includes('like')}
                    onCheckedChange={(checked) => {
                      setFilter(prev => 
                        checked 
                          ? [...prev.filter(f => f !== 'all'), 'like']
                          : prev.filter(f => f !== 'like')
                      );
                    }}
                  >
                    Likes
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={filter.includes('comment')}
                    onCheckedChange={(checked) => {
                      setFilter(prev => 
                        checked 
                          ? [...prev.filter(f => f !== 'all'), 'comment']
                          : prev.filter(f => f !== 'comment')
                      );
                    }}
                  >
                    Comments
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={filter.includes('new_post')}
                    onCheckedChange={(checked) => {
                      setFilter(prev => 
                        checked 
                          ? [...prev.filter(f => f !== 'all'), 'new_post']
                          : prev.filter(f => f !== 'new_post')
                      );
                    }}
                  >
                    New Posts
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
              
              {unreadCount > 0 && (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleMarkAllAsRead}
                >
                  <CheckCheck className="h-4 w-4 mr-2" />
                  Mark All Read
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Notifications List */}
      <Card>
        <CardContent className="p-0">
          {filteredNotifications.length === 0 ? (
            <div className="text-center py-12">
              <Bell className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No notifications</h3>
              <p className="text-gray-500">You're all caught up! New notifications will appear here.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {filteredNotifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`p-4 hover:bg-gray-50 transition-colors ${
                    !notification.is_read ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                  } ${notification.link ? 'cursor-pointer' : ''}`}
                  onClick={() => handleNotificationClick(notification)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-3 flex-1">
                      {notification.source === 'social' && notification.triggered_by_avatar ? (
                        <Avatar className="h-10 w-10 mt-1">
                          <AvatarImage src={notification.triggered_by_avatar} />
                          <AvatarFallback>
                            <User className="h-5 w-5" />
                          </AvatarFallback>
                        </Avatar>
                      ) : (
                        <div className="text-2xl">
                          {getNotificationIcon(notification.type)}
                        </div>
                      )}
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2 mb-1">
                          <h4 className="text-sm font-medium text-gray-900">
                            {/* The social message already names the person. */}
                            {notification.source === 'social'
                              ? notification.message
                              : notification.title || 'Notification'}
                          </h4>
                          <Badge className={getNotificationColor(notification.type)}>
                            {notification.type}
                          </Badge>
                          {!notification.is_read && (
                            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                          )}
                        </div>
                        
                        {notification.source === 'system' && (
                          <p className="text-sm text-gray-600 mb-2">
                            {notification.message}
                          </p>
                        )}
                        
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500">
                            {notification.created_at && (
                              (() => {
                                const date = new Date(notification.created_at);
                                return !isNaN(date.getTime()) 
                                  ? formatDistanceToNow(date, { addSuffix: true })
                                  : 'Recently';
                              })()
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2 ml-4">
                      {!notification.is_read && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            markAsRead(notification.id);
                          }}
                          className="text-blue-600 hover:text-blue-700"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-gray-400 hover:text-red-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(notification.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
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

export default StudentNotificationsPage;