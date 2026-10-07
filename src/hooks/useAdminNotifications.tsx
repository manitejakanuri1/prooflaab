import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

interface AdminNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
  metadata: any;
}

export function useAdminNotifications() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // AdminHeader, AdminSidebar, the notifications popover and the notifications
  // page all call this hook at once. A fixed channel name meant whichever one
  // mounted second reused the first one's already-subscribed channel and
  // crashed calling .on() after .subscribe(). Each instance now gets its own
  // channel — Supabase allows any number of channels to watch the same table.
  const instanceId = useRef(crypto.randomUUID()).current;

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['admin-notifications', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      // admin_notifications was merged into notifications. The old table's
      // policies only checked that the caller was an admin, not that the row
      // was theirs, so every admin could read every other admin's inbox.
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .eq('audience', 'admin')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Error fetching admin notifications:', error);
        return [];
      }

      return data as AdminNotification[];
    },
    enabled: !!user?.id,
  });

  // Set up real-time subscription
  // Replaces the live subscription below, which cannot work against
  // PostgREST. Paused while the tab is hidden, and refreshes at once when
  // the tab is looked at again.
  useLiveRefresh(() => { queryClient.invalidateQueries({ queryKey: ['admin-notifications'] }); });

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`admin-notifications-changes-${instanceId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newNotification = payload.new as AdminNotification & { audience?: string };

          // One table now carries every audience, so an admin who is also a
          // student would otherwise get their student notifications toasted here.
          if (newNotification.audience !== 'admin') return;

          // Show toast for new notification
          toast(newNotification.title, {
            description: newNotification.message,
            action: newNotification.link ? {
              label: 'View',
              onClick: () => window.location.href = newNotification.link,
            } : undefined,
          });

          // Invalidate queries to refetch
          queryClient.invalidateQueries({ queryKey: ['admin-notifications'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient, instanceId]);

  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-notifications'] });
    },
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) return;

      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('audience', 'admin')
        .eq('is_read', false);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-notifications'] });
    },
  });

  const deleteNotificationMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', notificationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-notifications'] });
    },
  });

  const markAsRead = (notificationId: string) => {
    markAsReadMutation.mutate(notificationId);
  };

  const markAllAsRead = () => {
    markAllAsReadMutation.mutate();
  };

  const deleteNotification = (notificationId: string) => {
    deleteNotificationMutation.mutate(notificationId);
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;
  const recentNotifications = notifications.slice(0, 5);

  return {
    notifications,
    recentNotifications,
    isLoading,
    unreadCount,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  };
}

export type { AdminNotification };
