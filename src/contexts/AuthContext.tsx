
import { createContext, useContext, useEffect, useState } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

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
        .single();

      if (!existingProfile) {
        // Create profile if it doesn't exist
        const { error } = await supabase
          .from('student_profiles')
          .insert([
            {
              user_id: user.id,
              full_name: user.user_metadata.full_name || user.email?.split('@')[0] || 'Student',
              email: user.email || '',
              total_xp: 0,
              trust_score: 0,
            }
          ]);
        
        if (error) {
          console.error('Error creating student profile:', error);
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
        setSession(session);
        setUser(session?.user ?? null);
        
        // Create student profile if user exists and profile doesn't exist
        if (session?.user && event === 'SIGNED_IN') {
          await createStudentProfileIfNeeded(session.user);
        }
        
        setLoading(false);
      }
    );

    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      // Create student profile if user exists and profile doesn't exist
      if (session?.user) {
        await createStudentProfileIfNeeded(session.user);
      }
      
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
    </AuthContext.Provider>
  );
};
