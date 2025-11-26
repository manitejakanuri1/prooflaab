
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface Notification {
  id: string;
  student_id?: string;
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
  post_id?: string;
  source: 'system' | 'social';
}

export const useNotifications = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Fetch both system and social notifications
  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      // Fetch system notifications
      const { data: profile } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!profile) return [];

      const { data: systemNotifications, error: systemError } = await supabase
        .from('notifications')
        .select('*')
        .eq('student_id', profile.id)
        .order('created_at', { ascending: false });

      if (systemError) {
        console.error('Error fetching system notifications:', systemError);
      }

      // Fetch social notifications
      const { data: socialNotifications, error: socialError } = await supabase
        .from('social_notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (socialError) {
        console.error('Error fetching social notifications:', socialError);
      }

      // Map system notifications to unified format
      const mappedSystemNotifications: Notification[] = (systemNotifications || []).map(n => ({
        id: n.id,
        student_id: n.student_id,
        type: n.type || 'general',
        title: n.title,
        message: n.message,
        is_read: n.is_read || false,
        created_at: n.created_at || new Date().toISOString(),
        link: n.link || undefined,
        read_at: n.read_at || undefined,
        source: 'system' as const,
      }));

      // Fetch profiles for triggered_by users
      const triggeredByIds = (socialNotifications || [])
        .map(n => n.triggered_by)
        .filter(Boolean) as string[];
      
      const { data: triggeredByProfiles } = await supabase
        .from('student_profiles')
        .select('user_id, full_name, profile_photo_url')
        .in('user_id', triggeredByIds);

      const profileMap = new Map(
        (triggeredByProfiles || []).map(p => [p.user_id, p])
      );

      // Map social notifications to unified format
      const mappedSocialNotifications: Notification[] = (socialNotifications || []).map(n => {
        const triggeredByProfile = n.triggered_by ? profileMap.get(n.triggered_by) : null;
        
        // Generate titles based on type
        let title = '';
        let link = '';
        
        switch (n.type) {
          case 'follow':
            title = 'New Follower';
            link = `/portfolio/${n.triggered_by}`;
            break;
          case 'like':
            title = 'Post Liked';
            link = `/student/feed?post=${n.post_id}`;
            break;
          case 'comment':
            title = 'New Comment';
            link = `/student/feed?post=${n.post_id}`;
            break;
          case 'new_post':
            title = 'New Post';
            link = `/student/feed?post=${n.post_id}`;
            break;
          default:
            title = 'Notification';
        }

        return {
          id: n.id,
          type: n.type,
          title,
          message: n.message,
          is_read: n.read || false,
          created_at: n.created_at,
          link,
          triggered_by: n.triggered_by || undefined,
          triggered_by_name: triggeredByProfile?.full_name || 'Someone',
          triggered_by_avatar: triggeredByProfile?.profile_photo_url || undefined,
          post_id: n.post_id || undefined,
          source: 'social' as const,
        };
      });

      // Merge and sort by created_at DESC
      const merged = [...mappedSystemNotifications, ...mappedSocialNotifications];
      merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      return merged;
    },
    enabled: !!user?.id,
  });

  // Mark notification as read
  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      // Find the notification to determine its source
      const notification = notifications.find(n => n.id === notificationId);
      
      if (!notification) return;

      if (notification.source === 'system') {
        const { error } = await supabase
          .from('notifications')
          .update({ is_read: true, read_at: new Date().toISOString() })
          .eq('id', notificationId);

        if (error) throw error;
      } else if (notification.source === 'social') {
        const { error } = await supabase
          .from('social_notifications')
          .update({ read: true })
          .eq('id', notificationId);

        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // Delete notification
  const deleteNotificationMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      // Find the notification to determine its source
      const notification = notifications.find(n => n.id === notificationId);
      
      if (!notification) return;

      if (notification.source === 'system') {
        const { error } = await supabase
          .from('notifications')
          .delete()
          .eq('id', notificationId);

        if (error) throw error;
      } else if (notification.source === 'social') {
        const { error } = await supabase
          .from('social_notifications')
          .delete()
          .eq('id', notificationId);

        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // Mark all as read
  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) return;

      // Get student profile
      const { data: profile } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (!profile) return;

      // Mark all system notifications as read
      const { error: systemError } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('student_id', profile.id)
        .eq('is_read', false);

      if (systemError) {
        console.error('Error marking system notifications as read:', systemError);
      }

      // Mark all social notifications as read
      const { error: socialError } = await supabase
        .from('social_notifications')
        .update({ read: true })
        .eq('user_id', user.id)
        .eq('read', false);

      if (socialError) {
        console.error('Error marking social notifications as read:', socialError);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // Realtime subscription for social notifications
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('social-notifications-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'social_notifications',
          filter: `user_id=eq.${user.id}`
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'social_notifications',
          filter: `user_id=eq.${user.id}`
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
        }
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

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return {
    notifications,
    isLoading,
    unreadCount,
    markAsRead,
    deleteNotification,
    markAllAsRead,
  };
};
