
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import RoleBasedProtectedRoute from "@/components/RoleBasedProtectedRoute";
import Index from "./pages/Index";
import StudentDashboard from "./pages/StudentDashboard";
import CollegeDashboard from "./pages/CollegeDashboard";
import StartupDashboard from "./pages/StartupDashboard";

import Portfolio from "./pages/Portfolio";
import Auth from "./pages/Auth";
import AuthCallback from "./pages/AuthCallback";
import InviteCodeVerification from "./pages/InviteCodeVerification";
import NotFound from "./pages/NotFound";
import ReviewProofs from "./pages/ReviewProofs";
import Pricing from "./pages/Pricing";
import ResetPassword from "./pages/ResetPassword";
import OnboardingCollege from "./pages/OnboardingCollege";
import OnboardingStartup from "./pages/OnboardingStartup";
import OnboardingStudent from "./pages/OnboardingStudent";
import OnboardingWizard from "./pages/OnboardingWizard";
import ProtectedRoute from "./components/ProtectedRoute";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
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
            <Route path="/portfolio/:slug" element={<Portfolio />} />
            
            {/* Student Routes */}
            <Route 
              path="/student/dashboard" 
              element={
                <RoleBasedProtectedRoute allowedRoles={['student']}>
                  <StudentDashboard />
                </RoleBasedProtectedRoute>
              } 
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
                <RoleBasedProtectedRoute allowedRoles={['admin', 'college_admin']}>
                  <ReviewProofs />
                </RoleBasedProtectedRoute>
              } 
            />
            
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
