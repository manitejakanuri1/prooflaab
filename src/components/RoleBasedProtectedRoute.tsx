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
  // 🚨 DEVELOPMENT BYPASS - Set to true to bypass auth temporarily
  const BYPASS_AUTH = false;
  
  const { user, loading } = useAuth();
  const [userRole, setUserRole] = useState<string | null>(BYPASS_AUTH ? 'student' : null);
  const [roleLoading, setRoleLoading] = useState(!BYPASS_AUTH);
  const navigate = useNavigate();

  useEffect(() => {
    if (BYPASS_AUTH) {
      // When bypassing auth, skip all database checks and allow access
      setUserRole('student');
      setRoleLoading(false);
      return;
    }

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
          
          // Skip wizard completion check for admin users
          if (!roleData.has_completed_wizard && roleData.role !== 'admin') {
            navigate('/onboarding-wizard', { replace: true });
            return;
          }
        } else {
          // Special handling for mohan.padavala@gmail.com - make them admin
          if (user.email === 'mohan.padavala@gmail.com') {
            const { error } = await supabase.from('user_roles').insert({
              user_id: user.id,
              role: 'admin',
              has_completed_wizard: true
            });
            if (!error) {
              setUserRole('admin');
              setRoleLoading(false);
              return;
            }
          }
          
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

  // If bypassing auth, always allow access
  if (BYPASS_AUTH) {
    return <>{children}</>;
  }

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