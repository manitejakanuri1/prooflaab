import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import StudentWizard from "@/components/onboarding/StudentWizard";
import CollegeWizard from "@/components/onboarding/CollegeWizard";
import StartupWizard from "@/components/onboarding/StartupWizard";

type UserRole = 'student' | 'college_admin' | 'startup' | 'admin';

export default function OnboardingWizard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);

  useEffect(() => {
    const fetchUserRole = async () => {
      if (!user) {
        navigate('/auth', { replace: true });
        return;
      }

      try {
        const { data: roleData } = await supabase
          .from('user_roles')
          .select('role, has_completed_wizard')
          .eq('user_id', user.id)
          .single();

        if (roleData) {
          if (roleData.has_completed_wizard) {
            // Already completed wizard, redirect to appropriate dashboard
            redirectToDashboard(roleData.role);
            return;
          }
          setUserRole(roleData.role);
        } else {
          // No role found, default to student
          const { error } = await supabase.from('user_roles').insert({
            user_id: user.id,
            role: 'student'
          });
          
          if (error) {
            console.error('Error creating default role:', error);
          }
          setUserRole('student');
        }
      } catch (error) {
        console.error('Error fetching user role:', error);
        setUserRole('student');
      } finally {
        setRoleLoading(false);
      }
    };

    fetchUserRole();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, navigate]);

  const redirectToDashboard = (role: UserRole) => {
    switch (role) {
      case 'admin':
        navigate('/admin/dashboard', { replace: true });
        break;
      case 'college_admin':
        navigate('/college/dashboard', { replace: true });
        break;
      case 'startup':
        navigate('/startup/dashboard', { replace: true });
        break;
      case 'student':
      default:
        navigate('/student/dashboard', { replace: true });
        break;
    }
  };

  const handleWizardComplete = async () => {
    if (userRole) {
      // Mark wizard as completed in the database. Students can't UPDATE their own
      // user_roles row directly (RLS only allows admins), so this goes through a
      // narrow RPC that flips just this one flag.
      try {
        const { error } = await supabase.rpc('complete_own_wizard');

        if (error) {
          console.error('Error updating wizard completion status:', error);
        }
      } catch (error) {
        console.error('Error marking wizard as complete:', error);
      }

      redirectToDashboard(userRole);
    }
  };

  if (loading || roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return null; // This will trigger redirect in useEffect
  }

  switch (userRole) {
    case 'student':
      return <StudentWizard onComplete={handleWizardComplete} />;
    case 'college_admin':
      return <CollegeWizard onComplete={handleWizardComplete} />;
    case 'startup':
      return <StartupWizard onComplete={handleWizardComplete} />;
    case 'admin':
      // Admin doesn't need wizard, redirect directly
      redirectToDashboard('admin');
      return null;
    default:
      return <StudentWizard onComplete={handleWizardComplete} />;
  }
}