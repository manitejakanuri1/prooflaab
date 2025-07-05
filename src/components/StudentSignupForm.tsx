
import { useState } from "react";
import EmailForm from "./EmailForm";
import OtpVerificationForm from "./OtpVerificationForm";

export default function StudentSignupForm() {
  const [email, setEmail] = useState("");
  const [showOtpInput, setShowOtpInput] = useState(false);

  const handleEmailVerified = (verifiedEmail: string) => {
    setEmail(verifiedEmail);
    setShowOtpInput(true);
  };

  const handleBackToEmail = () => {
    setShowOtpInput(false);
    setEmail("");
  };

  return (
    <div className="p-6 max-w-md mx-auto bg-white shadow-lg rounded-xl border">
      <h2 className="text-2xl font-bold mb-6 text-center text-gray-800">Student Signup</h2>
      
      {!showOtpInput ? (
        <EmailForm onEmailVerified={handleEmailVerified} />
      ) : (
        <OtpVerificationForm 
          email={email} 
          onBackToEmail={handleBackToEmail} 
        />
      )}
    </div>
  );
}
