import { createContext, Fragment, useContext, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { ensureStudentProfile } from "@/lib/ensureStudentProfile";
import OnboardingModal from "@/components/OnboardingModal";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  const lastUserId = useRef<string | null | undefined>(undefined);

  // M1: cached data is not keyed by user, so when a different person signs in on the same tab
  // drop every cached answer first; the children are also keyed by user id below, so no screen
  // keeps the previous person's Lot or drawer in its own state.
  const adoptUser = (next: User | null) => {
    const id = next?.id ?? null;
    if (lastUserId.current !== undefined && lastUserId.current !== id) queryClient.clear();
    lastUserId.current = id;
    setUser(next);
  };

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // Handle auth errors (like invalid refresh token)
        if (event === 'TOKEN_REFRESHED' && !session) {
          await supabase.auth.signOut();
          setSession(null);
          adoptUser(null);
          setLoading(false);
          return;
        }

        setSession(session);
        adoptUser(session?.user ?? null);
        
        // Handle successful authentication
        if (session?.user && event === 'SIGNED_IN') {
          setTimeout(async () => {
            await ensureStudentProfile(session.user);
          }, 0);
        }
        
        setLoading(false);
      }
    );

    // Get initial session with error handling
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (error) {
        console.error('Error getting session:', error);
        await supabase.auth.signOut();
        setSession(null);
        adoptUser(null);
        setLoading(false);
        return;
      }

      setSession(session);
      adoptUser(session?.user ?? null);
      
      // Create student profile if user exists and profile doesn't exist
      if (session?.user) {
        setTimeout(() => {
          ensureStudentProfile(session.user);
        }, 0);
      }
      
      setLoading(false);
    }).catch(async (error) => {
      console.error('Failed to get session:', error);
      await supabase.auth.signOut();
      setSession(null);
      adoptUser(null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const value = {
    user,
    session,
    loading,
    signOut,
  };

  return (
    <AuthContext.Provider value={value}>
      <Fragment key={user?.id ?? "signed-out"}>{children}</Fragment>
      {/* Show onboarding modal for authenticated users */}
      {user && !loading && (
        <OnboardingModal 
          user={user} 
          onComplete={() => {
            // Modal handles its own completion logic
          }} 
        />
      )}
    </AuthContext.Provider>
  );
};
