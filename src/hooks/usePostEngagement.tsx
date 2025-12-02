import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

type EngagementType = 'view' | 'email_click' | 'linkedin_click' | 'github_click' | 'resume_click';
type ViewerType = 'guest' | 'student' | 'recruiter';

interface UsePostEngagementOptions {
  postId: string;
  postOwnerId: string;
  isStudent?: boolean;
}

// Simple hash function for IP anonymization (client-side approximation using fingerprint)
const generateViewerHash = (): string => {
  const nav = navigator;
  const screen = window.screen;
  const fingerprint = [
    nav.userAgent,
    nav.language,
    screen.width,
    screen.height,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
  ].join('|');
  
  // Simple hash
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    const char = fingerprint.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
};

export const usePostEngagement = ({ postId, postOwnerId, isStudent = false }: UsePostEngagementOptions) => {
  const { user } = useAuth();
  const viewTrackedRef = useRef(false);

  const getViewerType = useCallback((): ViewerType => {
    if (!user) return 'guest';
    if (isStudent) return 'student';
    return 'recruiter';
  }, [user, isStudent]);

  const trackEngagement = useCallback(async (engagementType: EngagementType) => {
    if (!postId || !postOwnerId) return;

    try {
      const viewerType = getViewerType();
      const viewerHash = generateViewerHash();
      
      await supabase.from('post_engagements').insert({
        post_id: postId,
        post_owner_id: postOwnerId,
        viewer_id: user?.id || null,
        viewer_type: viewerType,
        engagement_type: engagementType,
        viewer_ip_hash: viewerHash,
        user_agent: navigator.userAgent,
        referrer: typeof document !== 'undefined' ? document.referrer : null,
      });
    } catch (error) {
      console.error('Failed to track engagement:', error);
    }
  }, [postId, postOwnerId, user, getViewerType]);

  // Track view on page load with cooldown
  const trackView = useCallback(async () => {
    if (!postId || !postOwnerId || viewTrackedRef.current) return;

    // Check localStorage for cooldown (1 hour per post)
    const cooldownKey = `post_view_${postId}`;
    const lastView = localStorage.getItem(cooldownKey);
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    if (lastView && (now - parseInt(lastView)) < oneHour) {
      return; // Still in cooldown
    }

    viewTrackedRef.current = true;
    localStorage.setItem(cooldownKey, now.toString());
    await trackEngagement('view');
  }, [postId, postOwnerId, trackEngagement]);

  // Track contact button clicks
  const trackEmailClick = useCallback(() => trackEngagement('email_click'), [trackEngagement]);
  const trackLinkedinClick = useCallback(() => trackEngagement('linkedin_click'), [trackEngagement]);
  const trackGithubClick = useCallback(() => trackEngagement('github_click'), [trackEngagement]);
  const trackResumeClick = useCallback(() => trackEngagement('resume_click'), [trackEngagement]);

  return {
    trackView,
    trackEmailClick,
    trackLinkedinClick,
    trackGithubClick,
    trackResumeClick,
  };
};

// Hook to fetch engagement stats for post owner
export const usePostEngagementStats = (postId: string | undefined) => {
  const { user } = useAuth();

  const fetchStats = useCallback(async () => {
    if (!postId || !user) return null;

    try {
      const { data, error } = await supabase
        .rpc('get_post_engagement_summary', { p_post_id: postId });

      if (error) throw error;
      return data?.[0] || null;
    } catch (error) {
      console.error('Failed to fetch engagement stats:', error);
      return null;
    }
  }, [postId, user]);

  return { fetchStats };
};
