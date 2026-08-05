import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Navigate, useNavigate } from "react-router-dom";

interface RoleBasedProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles: string[];
  fallbackRoute?: string;
}

export default function RoleBasedProtectedRoute({ 
  children, 
  allowedRoles, 
  fallbackRoute = "/auth" 
}: RoleBasedProtectedRouteProps) {
  const { user, loading } = useAuth();
  const [userRole, setUserRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchUserRole = async () => {
      if (!user) {
        setRoleLoading(false);
        return;
      }

      try {
        const { data: roleData } = await supabase
          .from('user_roles')
          .select('role, has_completed_wizard')
          .eq('user_id', user.id)
          // maybeSingle: a role row can be absent if signup's role insert failed,
          // and single() turns that into a 406 the caller reads as a broken query
          // rather than as "no role yet".
          .maybeSingle();

        if (roleData) {
          setUserRole(roleData.role);
          
          // Admins skip onboarding entirely. Students are gated by their own
          // intake flow (/student/start) rather than the generic wizard, so the
          // wizard check must not fire for them or it would pre-empt the
          // welcome screen and trap them after intake.
          if (
            !roleData.has_completed_wizard &&
            roleData.role !== 'admin' &&
            roleData.role !== 'student'
          ) {
            navigate('/onboarding-wizard', { replace: true });
            return;
          }
        } else {
          // Default to student if no role found
          await supabase.from('user_roles').insert({
            user_id: user.id,
            role: 'student'
          });
          setUserRole('student');
          navigate('/student/start', { replace: true });
          return;
        }
      } catch (error) {
        console.error('Error fetching user role:', error);
        setUserRole('student');
      } finally {
        setRoleLoading(false);
      }
    };

    fetchUserRole();
  }, [user, navigate]);

  if (loading || roleLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to={fallbackRoute} replace />;
  }

  if (userRole && !allowedRoles.includes(userRole)) {
    return <Navigate to={fallbackRoute} replace />;
  }

  return <>{children}</>;
}