import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useToast } from "@/hooks/use-toast";

export default function StudentSignupForm() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [showOtpInput, setShowOtpInput] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

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
      
      setShowOtpInput(true);
      
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

  const handleOtpVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (otp.length !== 6) {
      toast({
        title: "Invalid Code",
        description: "Please enter a 6-digit verification code.",
        variant: "destructive",
      });
      return;
    }

    setIsVerifying(true);

    try {
      // Check if OTP exists and is valid (not older than 10 minutes)
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      
      const { data: otpRecord, error } = await supabase
        .from("student_otps")
        .select("*")
        .eq("email", email)
        .eq("otp_code", otp)
        .eq("is_used", false)
        .gt("created_at", tenMinutesAgo)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("Database error:", error);
        toast({
          title: "Error",
          description: "Something went wrong. Please try again.",
          variant: "destructive",
        });
        return;
      }

      if (!otpRecord) {
        toast({
          title: "Invalid Code",
          description: "Invalid or expired code. Please check and try again.",
          variant: "destructive",
        });
        return;
      }

      // Mark OTP as used
      const { error: updateError } = await supabase
        .from("student_otps")
        .update({ is_used: true })
        .eq("id", otpRecord.id);

      if (updateError) {
        console.error("Update error:", updateError);
        toast({
          title: "Error",
          description: "Something went wrong. Please try again.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "✅ Verified!",
        description: "Email successfully verified.",
      });

      // Reset form
      setEmail("");
      setOtp("");
      setShowOtpInput(false);
      
      // Redirect to student dashboard after 1 second delay
      setTimeout(() => {
        navigate("/student/dashboard");
      }, 1000);
      
    } catch (error) {
      console.error("Unexpected error:", error);
      toast({
        title: "Error",
        description: "An unexpected error occurred. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleBackToEmail = () => {
    setShowOtpInput(false);
    setOtp("");
  };

  return (
    <div className="p-6 max-w-md mx-auto bg-white shadow-lg rounded-xl border">
      <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">Student Signup</h2>
      
      {!showOtpInput ? (
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
      ) : (
        <form onSubmit={handleOtpVerification} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="otp">Verification Code</Label>
            <p className="text-sm text-gray-600 mb-4">
              Enter the 6-digit code sent to {email}
            </p>
            <div className="flex justify-center">
              <InputOTP
                maxLength={6}
                value={otp}
                onChange={(value) => setOtp(value)}
                disabled={isVerifying}
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>
          </div>
          <Button 
            type="submit" 
            className="w-full" 
            disabled={isVerifying || otp.length !== 6}
          >
            {isVerifying ? "Verifying..." : "Verify Code"}
          </Button>
          <Button 
            type="button" 
            variant="outline" 
            className="w-full"
            onClick={handleBackToEmail}
            disabled={isVerifying}
          >
            Back to Email
          </Button>
        </form>
      )}
    </div>
  );
}
