import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { setTracking, startDomTracking, track, flush } from "@/lib/tracker";

/**
 * Turns the student step trail on while a logged-in student is inside the student area, records each page
 * they open, and flushes when they leave. Renders nothing. See src/lib/tracker.ts for what is (and is not) recorded.
 */
const TrackerBridge = () => {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const active = Boolean(user) && pathname.startsWith("/student");

  useEffect(() => {
    setTracking(active);
    if (!active) return;
    const stop = startDomTracking();
    return () => { stop(); void flush(); };
  }, [active]);

  useEffect(() => {
    if (active) track({ kind: "page", screen: pathname });
  }, [active, pathname]);

  return null;
};

export default TrackerBridge;
