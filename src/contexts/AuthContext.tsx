
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
      // Only create profile if email is confirmed
      if (!user.email_confirmed_at) {
        console.log('Email not confirmed, skipping profile creation');
        return;
      }

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
          } else {
            console.log('Student profile created successfully');
          }
        }
      }
    } catch (error) {
      console.error('Error checking/creating student profile:', error);
    }
  };

  const getUserRole = async (userId: string) => {
    try {
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .single();
      
      return roleData?.role || 'student';
    } catch (error) {
      console.error('Error fetching user role:', error);
      return 'student';
    }
  };

  const redirectToDashboard = (role: string) => {
    switch (role) {
      case 'admin':
        window.location.href = '/admin-dashboard';
        break;
      case 'college_admin':
        window.location.href = '/college-dashboard';
        break;
      case 'startup':
        window.location.href = '/startup-dashboard';
        break;
      case 'student':
      default:
        window.location.href = '/student-dashboard';
        break;
    }
  };

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        
        // Handle successful authentication - only redirect if email is confirmed
        if (session?.user && event === 'SIGNED_IN') {
          setTimeout(async () => {
            // Check if email is confirmed before proceeding
            if (!session.user.email_confirmed_at) {
              console.log('Email not confirmed, not redirecting');
              return;
            }
            
            await createStudentProfileIfNeeded(session.user);
            
            // Only redirect if we're on the auth page and email is confirmed
            if (window.location.pathname === '/auth' || 
                window.location.pathname === '/auth/callback') {
              const role = await getUserRole(session.user.id);
              redirectToDashboard(role);
            }
          }, 0);
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
        setTimeout(() => {
          createStudentProfileIfNeeded(session.user);
        }, 0);
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
