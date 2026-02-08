import { createContext, useContext, useEffect, useState } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
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

  const createStudentProfileIfNeeded = async (user: User) => {
    try {
      // Check if profile already exists
      const { data: existingProfile } = await supabase
        .from('student_profiles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!existingProfile) {
        // Get user role to determine if this is a student
        const { data: roleData } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .maybeSingle();

        // Only create student profile for students
        if (roleData?.role === 'student') {
          const { error } = await supabase
            .from('student_profiles')
            .upsert([
              {
                user_id: user.id,
                full_name: user.user_metadata.full_name || user.email?.split('@')[0] || 'Student',
                email: user.email || '',
                total_xp: 0,
                trust_score: 0,
              }
            ], {
              onConflict: 'user_id'
            });
          
          if (error) {
            console.error('Error creating student profile:', error);
          } else {
            console.log('Student profile created successfully');
          }
        }
      }
    } catch (error) {
      console.error('Error checking/creating student profile:', error);
    }
  };

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // Handle auth errors (like invalid refresh token)
        if (event === 'TOKEN_REFRESHED' && !session) {
          console.log('Token refresh failed, clearing auth state');
          await supabase.auth.signOut();
          setSession(null);
          setUser(null);
          setLoading(false);
          return;
        }

        setSession(session);
        setUser(session?.user ?? null);
        
        // Handle successful authentication
        if (session?.user && event === 'SIGNED_IN') {
          setTimeout(async () => {
            await createStudentProfileIfNeeded(session.user);
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
        setUser(null);
        setLoading(false);
        return;
      }

      setSession(session);
      setUser(session?.user ?? null);
      
      // Create student profile if user exists and profile doesn't exist
      if (session?.user) {
        setTimeout(() => {
          createStudentProfileIfNeeded(session.user);
        }, 0);
      }
      
      setLoading(false);
    }).catch(async (error) => {
      console.error('Failed to get session:', error);
      await supabase.auth.signOut();
      setSession(null);
      setUser(null);
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
      {children}
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
