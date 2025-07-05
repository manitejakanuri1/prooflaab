
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useToast } from "@/hooks/use-toast";

interface OtpVerificationFormProps {
  email: string;
  onBackToEmail: () => void;
}

export default function OtpVerificationForm({ email, onBackToEmail }: OtpVerificationFormProps) {
  const [otp, setOtp] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

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

  return (
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
        onClick={onBackToEmail}
        disabled={isVerifying}
      >
        Back to Email
      </Button>
    </form>
  );
}
