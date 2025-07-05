
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
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

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
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">College Email</Label>
        <Input
          id="email"
          type="email"
          placeholder="Enter your college email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={isLoading}
        />
      </div>
      <Button 
        type="submit" 
        className="w-full" 
        disabled={isLoading}
      >
        {isLoading ? "Sending..." : "Send Verification Code"}
      </Button>
    </form>
  );
}
