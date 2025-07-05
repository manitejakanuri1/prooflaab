
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export default function StudentSignupForm() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Generate 6-digit verification code
      const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

      // Insert into students_auth table
      const { error } = await supabase.from("students_auth").insert([
        {
          email,
          verification_code: verificationCode,
          is_verified: false,
        },
      ]);

      if (error) {
        console.error("Database error:", error);
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
          description: "Account created but email sending failed. Please contact support.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Success!",
        description: "Verification email sent. Check your inbox!",
      });
      
      // Reset form
      setEmail("");
      
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
    <div className="p-6 max-w-md mx-auto bg-white shadow-lg rounded-xl border">
      <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">Student Signup</h2>
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
    </div>
  );
}
