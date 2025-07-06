
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
    <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
      <div className="p-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-slate-800 rounded-lg flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold">P</span>
          </div>
          <h2 className="text-2xl font-semibold text-slate-800 mb-2">
            {!showOtpInput ? "Create your account" : "Verify your email"}
          </h2>
          {!showOtpInput && (
            <p className="text-slate-600 text-sm">
              Join thousands of students building their careers
            </p>
          )}
        </div>
        
        {/* Form Content */}
        {!showOtpInput ? (
          <EmailForm onEmailVerified={handleEmailVerified} />
        ) : (
          <OtpVerificationForm 
            email={email} 
            onBackToEmail={handleBackToEmail} 
          />
        )}
        
        {/* Footer */}
        {!showOtpInput && (
          <div className="mt-6 pt-6 border-t border-slate-100">
            <p className="text-center text-xs text-slate-500">
              By signing up, you agree to our{" "}
              <a href="#" className="text-slate-800 hover:underline">Terms of Service</a>
              {" "}and{" "}
              <a href="#" className="text-slate-800 hover:underline">Privacy Policy</a>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
