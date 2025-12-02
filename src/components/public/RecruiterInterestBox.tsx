import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Send, Check } from "lucide-react";

interface RecruiterInterestBoxProps {
  postId: string;
  studentId: string;
  postTitle: string;
}

export const RecruiterInterestBox = ({ postId, studentId, postTitle }: RecruiterInterestBoxProps) => {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email.trim()) {
      toast.error("Please enter your email");
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast.error("Please enter a valid email address");
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase
        .from("recruiter_interests")
        .insert({
          post_id: postId,
          student_id: studentId,
          recruiter_email: email.trim(),
          message: message.trim() || null,
        });

      if (error) throw error;

      setIsSubmitted(true);
      toast.success("Your message has been sent to the student");
    } catch (error) {
      console.error("Error submitting recruiter interest:", error);
      toast.error("Failed to send message. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-6 text-center">
        <div className="flex items-center justify-center gap-2 text-green-700 dark:text-green-400 mb-2">
          <Check className="h-5 w-5" />
          <span className="font-medium">Message Sent!</span>
        </div>
        <p className="text-sm text-green-600 dark:text-green-500">
          Your message has been sent to the student. They'll receive a notification and can contact you at {email}.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-muted/50 border border-border rounded-lg p-6">
      <h3 className="text-lg font-semibold text-foreground mb-2">
        Interested in this project?
      </h3>
      <p className="text-sm text-muted-foreground mb-4">
        Leave your email and the student will be notified of your interest.
      </p>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Input
            type="email"
            placeholder="Your email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full"
          />
        </div>
        
        <div>
          <Textarea
            placeholder="Optional message to the student..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            className="w-full resize-none"
          />
        </div>
        
        <Button 
          type="submit" 
          disabled={isSubmitting}
          className="w-full"
        >
          {isSubmitting ? (
            "Sending..."
          ) : (
            <>
              <Send className="h-4 w-4 mr-2" />
              Contact Student
            </>
          )}
        </Button>
      </form>
    </div>
  );
};
