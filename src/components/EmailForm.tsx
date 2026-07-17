
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
  const { toast } = useToast();

  // ponytail: Google signup cut — was a dead "coming soon" toast. Real version
  // needs the Google provider enabled in Supabase Auth + signInWithOAuth here.

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
