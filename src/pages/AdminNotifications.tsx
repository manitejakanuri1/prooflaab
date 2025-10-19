import React, { useState } from "react";
import AdminHeader from "@/components/dashboard/admin/AdminHeader";
import AdminSidebar from "@/components/dashboard/admin/AdminSidebar";
import { useAdminNotifications } from "@/hooks/useAdminNotifications";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, FileCheck, ListTodo, Users, AlertCircle, Trash2, CheckCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarProvider } from "@/components/ui/sidebar";

export default function AdminNotifications() {
  const { 
    notifications, 
    isLoading, 
    unreadCount, 
    markAsRead, 
    markAllAsRead, 
    deleteNotification 
  } = useAdminNotifications();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'all' | 'proof' | 'task' | 'user' | 'system'>('all');
  const [activeTab, setActiveTab] = useState("notifications");

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'proof': return <FileCheck className="h-5 w-5 text-blue-600" />;
      case 'task': return <ListTodo className="h-5 w-5 text-green-600" />;
      case 'user': return <Users className="h-5 w-5 text-purple-600" />;
      case 'system': return <AlertCircle className="h-5 w-5 text-orange-600" />;
      default: return <Bell className="h-5 w-5 text-gray-600" />;
    }
  };

  const filteredNotifications = filter === 'all' 
    ? notifications 
    : notifications.filter(n => n.type === filter);

  const handleNotificationClick = (notification: any) => {
    if (!notification.is_read) {
      markAsRead(notification.id);
    }
    if (notification.link) {
      navigate(notification.link);
    }
  };

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AdminSidebar activeTab={activeTab} onTabChange={setActiveTab} />
        
        <div className="flex-1 flex flex-col">
          <AdminHeader />
          
          <div className="container mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Bell className="h-8 w-8" />
              Notifications
            </h1>
            <p className="text-muted-foreground mt-1">
              {unreadCount > 0 ? `You have ${unreadCount} unread notifications` : 'All caught up!'}
            </p>
          </div>
          {unreadCount > 0 && (
            <Button onClick={markAllAsRead} variant="outline">
              <CheckCheck className="h-4 w-4 mr-2" />
              Mark All as Read
            </Button>
          )}
        </div>

        <Card>
          <CardHeader>
            <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
              <TabsList className="grid w-full grid-cols-5">
                <TabsTrigger value="all">
                  All ({notifications.length})
                </TabsTrigger>
                <TabsTrigger value="proof">
                  Proofs ({notifications.filter(n => n.type === 'proof').length})
                </TabsTrigger>
                <TabsTrigger value="task">
                  Tasks ({notifications.filter(n => n.type === 'task').length})
                </TabsTrigger>
                <TabsTrigger value="user">
                  Users ({notifications.filter(n => n.type === 'user').length})
                </TabsTrigger>
                <TabsTrigger value="system">
                  System ({notifications.filter(n => n.type === 'system').length})
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">
                Loading notifications...
              </div>
            ) : filteredNotifications.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <Bell className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p>No notifications found</p>
              </div>
            ) : (
              <ScrollArea className="h-[600px]">
                <div className="divide-y divide-border">
                  {filteredNotifications.map((notification) => (
                    <div
                      key={notification.id}
                      className={`p-4 transition-colors ${
                        !notification.is_read ? 'bg-primary/5' : ''
                      }`}
                    >
                      <div className="flex items-start space-x-4">
                        <div className="mt-1">
                          {getNotificationIcon(notification.type)}
                        </div>
                        <div 
                          className="flex-1 cursor-pointer" 
                          onClick={() => handleNotificationClick(notification)}
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <p className={`font-medium ${!notification.is_read ? 'text-foreground' : 'text-muted-foreground'}`}>
                                {notification.title}
                              </p>
                              <p className="text-sm text-muted-foreground mt-1">
                                {notification.message}
                              </p>
                              <p className="text-xs text-muted-foreground mt-2">
                                {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
                              </p>
                            </div>
                            <div className="flex items-center space-x-2">
                              {!notification.is_read && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    markAsRead(notification.id);
                                  }}
                                >
                                  Mark read
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteNotification(notification.id);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
}
