
import { useState } from "react";
import EmailForm from "./EmailForm";
import OtpVerificationForm from "./OtpVerificationForm";

export default function StartupSignupForm() {
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
    <div className="w-full max-w-md mx-auto bg-white/95 backdrop-blur-sm border border-white/20 rounded-3xl shadow-2xl p-8">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-green-500 to-green-600 rounded-2xl mb-6 shadow-lg">
          <span className="text-2xl">🏢</span>
        </div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">
          {!showOtpInput ? "Join as a Startup" : "Verify your email"}
        </h2>
        {!showOtpInput && (
          <p className="text-gray-600 text-sm">
            Connect with talented students and get real work done
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
        <div className="mt-6 pt-6 border-t border-gray-100">
          <p className="text-center text-xs text-gray-500">
            By signing up, you agree to our{" "}
            <a href="#" className="text-green-600 hover:underline">Terms of Service</a>
            {" "}and{" "}
            <a href="#" className="text-green-600 hover:underline">Privacy Policy</a>
          </p>
        </div>
      )}
    </div>
  );
}
