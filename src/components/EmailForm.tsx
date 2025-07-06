
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

interface EmailFormProps {
  onEmailVerified: (email: string) => void;
}

export default function EmailForm({ onEmailVerified }: EmailFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const { toast } = useToast();

  const handleGoogleSignup = async () => {
    setIsGoogleLoading(true);
    // TODO: Implement Google auth
    toast({
      title: "Coming Soon",
      description: "Google authentication will be available soon!",
      variant: "default",
    });
    setIsGoogleLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Generate 6-digit verification code
      const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

      // Insert OTP into student_otps table
      const { error: otpError } = await supabase.from("student_otps").insert([
        {
          email,
          otp_code: verificationCode,
        },
      ]);

      if (otpError) {
        console.error("Database error:", otpError);
        toast({
          title: "Error",
          description: "Something went wrong. Please try again.",
          variant: "destructive",
        });
        return;
      }

      // Send verification email via edge function
      const { error: emailError } = await supabase.functions.invoke('send-verification-email', {
        body: { email, code: verificationCode }
      });

      if (emailError) {
        console.error("Email error:", emailError);
        toast({
          title: "Email Error",
          description: "OTP generated but email sending failed. Please contact support.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Success!",
        description: "Verification code sent to your email. Please check your inbox!",
      });
      
      onEmailVerified(email);
      
    } catch (error) {
      console.error("Unexpected error:", error);
      toast({
        title: "Error",
        description: "An unexpected error occurred. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Google Sign Up Button */}
      <Button
        type="button"
        variant="outline"
        className="w-full h-12 border-slate-300 text-slate-700 hover:bg-slate-50"
        onClick={handleGoogleSignup}
        disabled={isGoogleLoading}
      >
        <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        {isGoogleLoading ? "Connecting..." : "Continue with Google"}
      </Button>

      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200"></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-4 bg-white text-slate-500">or</span>
        </div>
      </div>

      {/* Email Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email" className="text-slate-700 font-medium">
            Your email
          </Label>
          <Input
            id="email"
            type="email"
            placeholder="Enter your college email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={isLoading}
            className="h-12 border-slate-300 focus:border-slate-800 focus:ring-slate-800"
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="password" className="text-slate-700 font-medium">
            Create a password
          </Label>
          <Input
            id="password"
            type="password"
            placeholder="Create a strong password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={isLoading}
            className="h-12 border-slate-300 focus:border-slate-800 focus:ring-slate-800"
          />
        </div>

        <Button 
          type="submit" 
          className="w-full h-12 bg-slate-800 hover:bg-slate-900 text-white font-medium" 
          disabled={isLoading}
        >
          {isLoading ? "Sending verification..." : "Continue with email"}
        </Button>
      </form>

      {/* Already have account */}
      <div className="text-center">
        <p className="text-sm text-slate-600">
          Already have an account?{" "}
          <a href="#" className="text-slate-800 hover:underline font-medium">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
