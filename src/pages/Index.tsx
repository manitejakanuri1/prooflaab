
import { useState } from "react";
import StudentSignupForm from "@/components/StudentSignupForm";
import { Button } from "@/components/ui/button";

const Index = () => {
  const [showStudentSignup, setShowStudentSignup] = useState(false);

  if (showStudentSignup) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <button 
              onClick={() => setShowStudentSignup(false)}
              className="text-slate-600 hover:text-slate-800 mb-4 inline-flex items-center text-sm"
            >
              ← Back to home
            </button>
            <h1 className="text-2xl font-bold text-slate-800 mb-2">ProofLabAI</h1>
          </div>
          <StudentSignupForm />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="px-6 py-4 flex justify-between items-center">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-slate-800 rounded flex items-center justify-center">
            <span className="text-white font-bold text-sm">P</span>
          </div>
          <span className="font-semibold text-slate-800">ProofLabAI</span>
        </div>
        <nav className="hidden md:flex space-x-6 text-slate-600">
          <a href="#" className="hover:text-slate-800">About</a>
          <a href="#" className="hover:text-slate-800">For business</a>
          <a href="#" className="hover:text-slate-800">Media</a>
          <a href="#" className="hover:text-slate-800">Blog</a>
        </nav>
        <Button variant="outline" className="text-slate-600 border-slate-300">
          Sign up
        </Button>
      </header>

      {/* Main Content */}
      <div className="flex flex-col items-center justify-center px-4 py-16">
        {/* Hero Section */}
        <div className="text-center mb-16 max-w-4xl">
          <h1 className="text-5xl md:text-6xl font-bold text-slate-800 mb-6 leading-tight">
            Connect. Learn. Earn
          </h1>
          <p className="text-xl text-slate-600 max-w-2xl mx-auto leading-relaxed">
            A Real Proof-of-Work Internship Platform for Engineering Students. 
            Gain experience, build your portfolio, and impress recruiters with actual work — not just certificates.
          </p>
        </div>

        {/* Three Cards Section */}
        <div className="grid md:grid-cols-3 gap-8 w-full max-w-6xl px-4">
          {/* Join as a Startup - Left Card */}
          <div className="bg-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all duration-300 border border-slate-200">
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-2xl">🏢</span>
              </div>
              <h3 className="text-xl font-semibold text-slate-800 mb-4">
                Join as a Startup
              </h3>
              <p className="text-slate-600 mb-6 text-sm leading-relaxed">
                Connect with talented engineering students and get real work done while providing valuable learning experiences.
              </p>
              <Button className="w-full bg-green-600 hover:bg-green-700 text-white">
                Get Started
              </Button>
            </div>
          </div>

          {/* Start as a Student - Center Card (Featured) */}
          <div className="bg-white rounded-2xl p-8 shadow-xl hover:shadow-2xl transition-all duration-300 border-2 border-slate-800 relative">
            <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
              <span className="bg-slate-800 text-white px-4 py-1 rounded-full text-xs font-medium">
                Most Popular
              </span>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-2xl">🚀</span>
              </div>
              <h3 className="text-xl font-semibold text-slate-800 mb-4">
                Start as a Student
              </h3>
              <p className="text-slate-600 mb-6 text-sm leading-relaxed">
                Begin your journey with real-world projects, build your portfolio, and earn while you learn from industry experts.
              </p>
              <Button 
                onClick={() => setShowStudentSignup(true)}
                className="w-full bg-slate-800 hover:bg-slate-900 text-white"
              >
                Get Started
              </Button>
            </div>
          </div>

          {/* Connect as a College - Right Card */}
          <div className="bg-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all duration-300 border border-slate-200">
            <div className="text-center">
              <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-2xl">🎓</span>
              </div>
              <h3 className="text-xl font-semibold text-slate-800 mb-4">
                Connect as a College
              </h3>
              <p className="text-slate-600 mb-6 text-sm leading-relaxed">
                Partner with us to provide your students with real industry experience and improve their employability.
              </p>
              <Button className="w-full bg-purple-600 hover:bg-purple-700 text-white">
                Get Started
              </Button>
            </div>
          </div>
        </div>

        {/* Additional Info Section */}
        <div className="mt-16 text-center">
          <div className="flex items-center justify-center space-x-2 text-slate-500">
            <div className="w-2 h-2 bg-slate-300 rounded-full"></div>
            <div className="w-2 h-2 bg-slate-400 rounded-full"></div>
            <div className="w-2 h-2 bg-slate-800 rounded-full"></div>
            <div className="w-2 h-2 bg-slate-400 rounded-full"></div>
            <div className="w-2 h-2 bg-slate-300 rounded-full"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
