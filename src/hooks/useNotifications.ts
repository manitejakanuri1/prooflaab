import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  link?: string;
  read_at?: string;
  triggered_by?: string;
  triggered_by_name?: string;
  triggered_by_avatar?: string;
  source: 'system' | 'social';
}

export const useNotifications = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // One table, one query. This used to read `notifications` and
  // `social_notifications` separately, map two different row shapes into one,
  // and then branch on source again on every read/delete. The two tables are
  // now one, keyed on the auth user id, so none of that is needed.
  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: async (): Promise<Notification[]> => {
      if (!user?.id) return [];

      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching notifications:', error);
        return [];
      }

      const rows = data ?? [];

      // Social notifications name the person who caused them. Look those up in
      // one go rather than per row.
      const actorIds = [...new Set(rows.map((n) => n.actor_id).filter(Boolean))] as string[];

      const actorMap = new Map<string, { full_name: string; profile_photo_url: string | null }>();
      if (actorIds.length > 0) {
        const { data: actors } = await supabase
          .from('student_profiles')
          .select('user_id, full_name, profile_photo_url')
          .in('user_id', actorIds);

        (actors ?? []).forEach((a) => actorMap.set(a.user_id, a));
      }

      return rows.map((n) => {
        const actor = n.actor_id ? actorMap.get(n.actor_id) : undefined;
        return {
          id: n.id,
          type: n.type,
          title: n.title,
          message: n.message,
          is_read: n.is_read,
          created_at: n.created_at,
          link: n.link || undefined,
          read_at: n.read_at || undefined,
          triggered_by: n.actor_id || undefined,
          triggered_by_name: actor?.full_name || (n.actor_id ? 'Someone' : undefined),
          triggered_by_avatar: actor?.profile_photo_url || undefined,
          source: n.source as 'system' | 'social',
        };
      });
    },
    enabled: !!user?.id,
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
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
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) return;

      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('is_read', false);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // Live updates. The old version only subscribed to social notifications, so
  // a verification result or a new task never appeared until a refresh.
  // Replaces the live subscription below, which cannot work against
  // PostgREST. Paused while the tab is hidden, and refreshes at once when
  // the tab is looked at again.
  useLiveRefresh(() => { queryClient.invalidateQueries({ queryKey: ['notifications'] }); });

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);

  const markAsRead = (notificationId: string) => {
    markAsReadMutation.mutate(notificationId);
  };

  const deleteNotification = (notificationId: string) => {
    deleteNotificationMutation.mutate(notificationId);
  };

  const markAllAsRead = () => {
    markAllAsReadMutation.mutate();
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return {
    notifications,
    isLoading,
    unreadCount,
    markAsRead,
    deleteNotification,
    markAllAsRead,
  };
};
