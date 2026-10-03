import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const VIEWED_KEY = "college_viewed_notifications";

export interface CollegeNotification {
  id: string;            // attention-<student>-<reason codes>: a new reason is a new notification
  student_id: string;
  full_name: string;
  roll_number: string | null;
  branch: string | null;
  days_quiet: number;
  reasons: string[];
  severity: string;
  is_read: boolean;
}

const viewed = (): string[] => {
  try { return JSON.parse(localStorage.getItem(VIEWED_KEY) || "[]") as string[]; } catch { return []; }
};

/**
 * The college bell. It used to count proof uploads waiting for review - the proof
 * system is retired, so it was always empty. It now shows what the placement office
 * actually acts on: students who need attention (tpo_attention(): gone quiet, stuck
 * in onboarding, and so on). "Read" is remembered in this browser only.
 */
export const useCollegeNotifications = () => {
  const { data: notifications = [], isLoading, refetch } = useQuery({
    queryKey: ["college-notifications"],
    queryFn: async (): Promise<CollegeNotification[]> => {
      const { data, error } = await supabase.rpc("tpo_attention" as never);
      if (error) throw error;
      const seen = new Set(viewed());
      return ((data ?? []) as unknown as Omit<CollegeNotification, "id" | "is_read">[] & { reason_codes?: string[] }[])
        .map((r) => {
          const id = `attention-${r.student_id}-${((r as { reason_codes?: string[] }).reason_codes ?? []).join("+")}`;
          return { ...r, id, is_read: seen.has(id) };
        });
    },
    refetchInterval: 60_000,
  });

  const markAsViewed = (ids: string[]) => {
    localStorage.setItem(VIEWED_KEY, JSON.stringify([...new Set([...viewed(), ...ids])].slice(-2000)));
    void refetch();
  };

  return {
    notifications,
    unreadCount: notifications.filter((n) => !n.is_read).length,
    isLoading,
    markAsViewed,
    markAllAsViewed: () => markAsViewed(notifications.map((n) => n.id)),
    refetch,
  };
};
