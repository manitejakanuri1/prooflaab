
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import StudentDashboard from "./pages/StudentDashboard";
import CollegeDashboard from "./pages/CollegeDashboard";
import StartupDashboard from "./pages/StartupDashboard";
import Portfolio from "./pages/Portfolio";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";
import ReviewProofs from "./pages/ReviewProofs";
import Pricing from "./pages/Pricing";

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
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/portfolio/:slug" element={<Portfolio />} />
            <Route 
              path="/student/dashboard" 
              element={
                <ProtectedRoute>
                  <StudentDashboard />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/college" 
              element={
                <ProtectedRoute>
                  <CollegeDashboard />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/startup/dashboard" 
              element={
                <ProtectedRoute>
                  <StartupDashboard />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/review-proofs" 
              element={
                <ProtectedRoute>
                  <ReviewProofs />
                </ProtectedRoute>
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
