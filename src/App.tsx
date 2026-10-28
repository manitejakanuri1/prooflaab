import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import TrackerBridge from "@/components/TrackerBridge";
import AppGuideChatbot from "@/components/AppGuideChatbot";
import ErrorBoundary from "@/components/ErrorBoundary";

// Critical path - load immediately
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

// Lazy load all other routes for faster initial load
const StudentDashboard = lazy(() => import("./pages/StudentDashboard"));
const StudentResumeOnboarding = lazy(() => import("./pages/StudentResumeOnboarding"));
const StudentInterestOnboarding = lazy(() => import("./pages/StudentInterestOnboarding"));
const StudentStart = lazy(() => import("./pages/StudentStart"));
const CollegeDashboard = lazy(() => import("./pages/CollegeDashboard"));
// RecruiterDashboard page is no longer routed: /recruiter/dashboard opens the Company dashboard.
const StartupDashboard = lazy(() => import("./pages/StartupDashboard"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AdminNotifications = lazy(() => import("./pages/AdminNotifications"));
const Portfolio = lazy(() => import("./pages/Portfolio"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const OnboardingCollege = lazy(() => import("./pages/OnboardingCollege"));
const OnboardingStartup = lazy(() => import("./pages/OnboardingStartup"));
const OnboardingStudent = lazy(() => import("./pages/OnboardingStudent"));
const OnboardingWizard = lazy(() => import("./pages/OnboardingWizard"));
const Terms = lazy(() => import("./pages/Legal").then((m) => ({ default: m.Terms })));
const PrivacyPolicy = lazy(() => import("./pages/Legal").then((m) => ({ default: m.PrivacyPolicy })));

// Lazy load route guards
const ProtectedRoute = lazy(() => import("./components/ProtectedRoute"));
const RoleBasedProtectedRoute = lazy(() => import("./components/RoleBasedProtectedRoute"));

// Lightweight loading fallback - no spinner, just reserve space
const PageLoader = () => (
  <div className="min-h-screen bg-background" aria-busy="true" aria-live="polite" />
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Was 5min + no focus refetch, so trust score/XP/tasks/etc only ever
      // updated on a full remount — a college assigning a task or a proof
      // getting verified elsewhere never showed up on an open dashboard.
      staleTime: 1000 * 60, // 1 minute
      gcTime: 1000 * 60 * 30, // 30 minutes (formerly cacheTime)
      refetchOnWindowFocus: true,
      // And every minute while the tab is visible, so a change made elsewhere
      // shows without pressing refresh (paused in background tabs).
      refetchInterval: 1000 * 60,
      retry: 1,
    },
  },
});

// MF-021: a page the browser restores from its back-forward cache is a frozen copy from before a sign-out.
// Reload it so the normal sign-in check runs again instead of showing the old dashboard.
if (typeof window !== "undefined") {
  window.addEventListener("pageshow", (e) => { if (e.persisted) window.location.reload(); });
}

// MF-005: /logout and /signout (were 404s) end the session and go to sign in.
const Logout = () => {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    signOut().finally(() => navigate("/auth", { replace: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <PageLoader />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
            {/* Inside the router and the providers, so the crash screen still
                has them and a reload lands back on the same URL. */}
            <ErrorBoundary area="page">
            <Suspense fallback={<PageLoader />}>
              <TrackerBridge />
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/logout" element={<Logout />} />
                <Route path="/signout" element={<Logout />} />
                <Route path="/auth/callback" element={<AuthCallback />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/onboarding-wizard" element={
                  <ProtectedRoute>
                    <OnboardingWizard />
                  </ProtectedRoute>
                } />
                <Route path="/onboarding/college" element={
                  <ProtectedRoute>
                    <OnboardingCollege />
                  </ProtectedRoute>
                } />
                <Route path="/onboarding/startup" element={
                  <ProtectedRoute>
                    <OnboardingStartup />
                  </ProtectedRoute>
                } />
                <Route path="/onboarding/student" element={
                  <ProtectedRoute>
                    <OnboardingStudent />
                  </ProtectedRoute>
                } />
                {/* The old pricing page advertised plans and features the product does not have; nothing links to it. */}
                <Route path="/pricing" element={<Navigate to="/" replace />} />
                <Route path="/portfolio/:slug" element={<Portfolio />} />
                
                {/* Student Routes */}
                <Route
                  path="/student/start"
                  element={
                    <RoleBasedProtectedRoute allowedRoles={['student']}>
                      <StudentStart />
                    </RoleBasedProtectedRoute>
                  }
                />
                <Route
                  path="/student/resume-onboarding"
                  element={
                    <RoleBasedProtectedRoute allowedRoles={['student']}>
                      <StudentResumeOnboarding />
                    </RoleBasedProtectedRoute>
                  }
                />
                {/* The Skip half of intake. Same test, same scorecard, built
                    from the interests picked instead of from a resume. */}
                <Route
                  path="/student/interest-onboarding"
                  element={
                    <RoleBasedProtectedRoute allowedRoles={['student']}>
                      <StudentInterestOnboarding />
                    </RoleBasedProtectedRoute>
                  }
                />
                <Route
                  path="/student/dashboard"
                  element={
                    <RoleBasedProtectedRoute allowedRoles={['student']}>
                      <StudentDashboard />
                    </RoleBasedProtectedRoute>
                  } 
                />
                <Route 
                  path="/student/tasks/*" 
                  element={
                    <RoleBasedProtectedRoute allowedRoles={['student']}>
                      <StudentDashboard />
                    </RoleBasedProtectedRoute>
                  } 
                />
                <Route
                  path="/student/roadmap"
                  element={
                    <RoleBasedProtectedRoute allowedRoles={['student']}>
                      <StudentDashboard />
                    </RoleBasedProtectedRoute>
                  }
                />
                {/* Legacy proof route - redirects to post page */}
                
                {/* College Admin Routes */}
                <Route 
                  path="/college/dashboard" 
                  element={
                    <RoleBasedProtectedRoute allowedRoles={['college_admin']}>
                      <CollegeDashboard />
                    </RoleBasedProtectedRoute>
                  } 
                />
                
                {/* Company: the Startup and Recruiter dashboards merged (17 Sep 2026).
                    Both old addresses still work and land here. A login still
                    holding the old recruiter role is let in too. */}
                <Route
                  path="/company/dashboard"
                  element={
                    <RoleBasedProtectedRoute allowedRoles={['startup', 'recruiter']}>
                      <StartupDashboard />
                    </RoleBasedProtectedRoute>
                  }
                />
                <Route path="/startup/dashboard" element={<Navigate to="/company/dashboard" replace />} />
                <Route path="/recruiter/dashboard" element={<Navigate to="/company/dashboard" replace />} />

                {/* Admin Routes */}
                <Route 
                  path="/admin/dashboard" 
                  element={
                    <RoleBasedProtectedRoute allowedRoles={['admin']}>
                      <AdminDashboard />
                    </RoleBasedProtectedRoute>
                  } 
                />
                <Route 
                  path="/admin/notifications" 
                  element={
                    <RoleBasedProtectedRoute allowedRoles={['admin']}>
                      <AdminNotifications />
                    </RoleBasedProtectedRoute>
                  } 
                />
                <Route 
                  path="/admin/dashboard/user-management/:userType" 
                  element={
                    <RoleBasedProtectedRoute allowedRoles={['admin']}>
                      <AdminDashboard />
                    </RoleBasedProtectedRoute>
                  } 
                />
                {/* Legacy Routes - redirect to proper paths */}
                <Route 
                  path="/college" 
                  element={
                    <RoleBasedProtectedRoute allowedRoles={['college_admin']} fallbackRoute="/college/dashboard">
                      <CollegeDashboard />
                    </RoleBasedProtectedRoute>
                  } 
                />
                
                
                <Route path="/terms" element={<Terms />} />
                <Route path="/privacy-policy" element={<PrivacyPolicy />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
            </ErrorBoundary>
            <AppGuideChatbot />
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
);

export default App;
