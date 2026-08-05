import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import AppGuideChatbot from "@/components/AppGuideChatbot";
import ErrorBoundary from "@/components/ErrorBoundary";

// Critical path - load immediately
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

// Lazy load all other routes for faster initial load
const StudentDashboard = lazy(() => import("./pages/StudentDashboard"));
const StudentResumeOnboarding = lazy(() => import("./pages/StudentResumeOnboarding"));
const StudentStart = lazy(() => import("./pages/StudentStart"));
const CollegeDashboard = lazy(() => import("./pages/CollegeDashboard"));
const StartupDashboard = lazy(() => import("./pages/StartupDashboard"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AdminNotifications = lazy(() => import("./pages/AdminNotifications"));
const RecruiterView = lazy(() => import("./pages/RecruiterView"));
const Portfolio = lazy(() => import("./pages/Portfolio"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const InviteCodeVerification = lazy(() => import("./pages/InviteCodeVerification"));
const ReviewProofs = lazy(() => import("./pages/ReviewProofs"));
const Pricing = lazy(() => import("./pages/Pricing"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const OnboardingCollege = lazy(() => import("./pages/OnboardingCollege"));
const OnboardingStartup = lazy(() => import("./pages/OnboardingStartup"));
const OnboardingStudent = lazy(() => import("./pages/OnboardingStudent"));
const OnboardingWizard = lazy(() => import("./pages/OnboardingWizard"));
const ProofViewer = lazy(() => import("./pages/ProofViewer"));
const PostPage = lazy(() => import("./pages/PostPage"));

// Lazy load route guards
const ProtectedRoute = lazy(() => import("./components/ProtectedRoute"));
const RoleBasedProtectedRoute = lazy(() => import("./components/RoleBasedProtectedRoute"));
const ProofRedirect = lazy(() => import("./components/ProofRedirect"));

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
      retry: 1,
    },
  },
});

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
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/auth/callback" element={<AuthCallback />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/invite-verification" element={<InviteCodeVerification />} />
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
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/post/:postId" element={<PostPage />} />
                <Route path="/portfolio/:slug" element={<Portfolio />} />
                <Route path="/recruiter/:linkId" element={<RecruiterView />} />
                
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
                <Route 
                  path="/student/proof/:id" 
                  element={<ProofRedirect />}
                />
                
                {/* College Admin Routes */}
                <Route 
                  path="/college/dashboard" 
                  element={
                    <RoleBasedProtectedRoute allowedRoles={['college_admin']}>
                      <CollegeDashboard />
                    </RoleBasedProtectedRoute>
                  } 
                />
                
                {/* Startup Routes */}
                <Route 
                  path="/startup/dashboard" 
                  element={
                    <RoleBasedProtectedRoute allowedRoles={['startup']}>
                      <StartupDashboard />
                    </RoleBasedProtectedRoute>
                  } 
                />
                
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
                
                {/* Review Proofs - Accessible by admins and college admins */}
                <Route 
                  path="/review-proofs"
                  element={
                    // Admin-only: this page is a full Admin Dashboard duplicate and
                    // includes TrustXPModeration, which WRITES trust scores. Allowing
                    // college_admin here was a privilege escalation.
                    <RoleBasedProtectedRoute allowedRoles={['admin']}>
                      <ReviewProofs />
                    </RoleBasedProtectedRoute>
                  }
                />
                
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
