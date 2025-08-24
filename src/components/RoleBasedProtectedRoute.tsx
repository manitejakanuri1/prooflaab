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
          .single();

        if (roleData) {
          setUserRole(roleData.role);
          
          // Check if wizard needs to be completed
          if (!roleData.has_completed_wizard) {
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
          navigate('/onboarding-wizard', { replace: true });
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