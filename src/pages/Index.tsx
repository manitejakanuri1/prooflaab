import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Landing from "@/components/landing/Landing";

const Index = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Only redirect authenticated users.
    const checkUser = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('Error getting session:', error);
          return; // Show landing page on error
        }
        
        if (session?.user) {
          const { data: roleData, error: roleError } = await supabase
            .from('user_roles')
            .select('role, has_completed_wizard')
            .eq('user_id', session.user.id)
            .maybeSingle();
          
          if (roleError) {
            console.error('Error fetching role:', roleError);
            return; // Show landing page on error
          }
          
          if (roleData) {
            if (roleData.role === 'student') {
              // Students are gated by intake, not the wizard flag.
              navigate('/student/start', { replace: true });
            } else if (!roleData.has_completed_wizard && roleData.role !== 'admin') {
              navigate('/onboarding-wizard', { replace: true });
            } else {
              const role = roleData.role;
              switch (role) {
                case 'admin':
                  navigate('/admin/dashboard', { replace: true });
                  break;
                case 'college_admin':
                  navigate('/college/dashboard', { replace: true });
                  break;
                case 'startup':
                case 'recruiter':
                  navigate('/company/dashboard', { replace: true });
                  break;
                // No 'student' case: students are sent to /student/start above
                // and can never reach this switch.
                default:
                  navigate('/student/dashboard', { replace: true });
                  break;
              }
            }
          }
        }
      } catch (error) {
        console.error('Error checking user session:', error);
      }
    };
    
    checkUser();
  }, [navigate]);

  // The page itself is the brand home page (owner decision 25 Oct 2026).
  return <Landing />;
};

export default Index;
