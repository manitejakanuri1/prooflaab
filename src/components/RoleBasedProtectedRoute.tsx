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
          .select('role')
          .eq('user_id', user.id)
          .single();
        
        setUserRole(roleData?.role || 'student');
      } catch (error) {
        console.error('Error fetching user role:', error);
        setUserRole('student');
      } finally {
        setRoleLoading(false);
      }
    };

    fetchUserRole();
  }, [user]);

  if (loading || roleLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to={fallbackRoute} replace />;
  }

  // Check if user needs onboarding before proceeding
  useEffect(() => {
    const checkOnboardingStatus = async () => {
      if (!user || !userRole) return;

      // Check onboarding for college_admin
      if (userRole === 'college_admin') {
        const { data } = await supabase
          .from('colleges')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle();
        
        if (!data) {
          navigate('/onboarding/college', { replace: true });
          return;
        }
      }

      // Check onboarding for startup
      if (userRole === 'startup') {
        const { data } = await supabase
          .from('startups')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle();
        
        if (!data) {
          navigate('/onboarding/startup', { replace: true });
          return;
        }
      }
    };

    checkOnboardingStatus();
  }, [user, userRole, navigate]);

  if (userRole && !allowedRoles.includes(userRole)) {
    // Redirect to appropriate dashboard based on user's actual role
    switch (userRole) {
      case 'admin':
        return <Navigate to="/admin/dashboard" replace />;
      case 'college_admin':
        return <Navigate to="/college/dashboard" replace />;
      case 'startup':
        return <Navigate to="/startup/dashboard" replace />;
      case 'student':
      default:
        return <Navigate to="/student/dashboard" replace />;
    }
  }

  return <>{children}</>;
}