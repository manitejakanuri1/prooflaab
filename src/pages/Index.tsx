
import { useState } from "react";
import StudentSignupForm from "@/components/StudentSignupForm";
import StartupSignupForm from "@/components/StartupSignupForm";
import CollegeSignupForm from "@/components/CollegeSignupForm";
import { Button } from "@/components/ui/button";

const Index = () => {
  const [signupType, setSignupType] = useState<'student' | 'startup' | 'college' | null>(null);

  const getSignupTitle = () => {
    switch (signupType) {
      case 'student': return 'Student Registration';
      case 'startup': return 'Startup Registration';
      case 'college': return 'College Registration';
      default: return 'ProofLabAI';
    }
  };

  const renderSignupForm = () => {
    switch (signupType) {
      case 'student': return <StudentSignupForm />;
      case 'startup': return <StartupSignupForm />;
      case 'college': return <CollegeSignupForm />;
      default: return null;
    }
  };

  if (signupType) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <button 
              onClick={() => setSignupType(null)}
              className="text-gray-600 hover:text-gray-800 mb-4 inline-flex items-center text-sm font-medium transition-colors"
            >
              ← Back to home
            </button>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">{getSignupTitle()}</h1>
          </div>
          {renderSignupForm()}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Header */}
      <header className="px-6 py-4 flex justify-between items-center bg-white/50 backdrop-blur-sm border-b border-white/20">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
            <span className="text-white font-bold text-lg">P</span>
          </div>
          <span className="font-bold text-xl text-gray-800">ProofLabAI</span>
        </div>
        <nav className="hidden md:flex space-x-8 text-gray-600">
          <a href="#" className="hover:text-blue-600 transition-colors font-medium">About</a>
          <a href="#" className="hover:text-blue-600 transition-colors font-medium">For business</a>
          <a href="#" className="hover:text-blue-600 transition-colors font-medium">Media</a>
          <a href="#" className="hover:text-blue-600 transition-colors font-medium">Blog</a>
        </nav>
        <Button variant="outline" className="text-gray-600 border-gray-300 hover:bg-blue-50 hover:border-blue-300 font-medium">
          Sign in
        </Button>
      </header>

      {/* Main Content */}
      <div className="flex flex-col items-center justify-center px-4 py-16">
        {/* Hero Section */}
        <div className="text-center mb-20 max-w-4xl">
          <h1 className="text-6xl md:text-7xl font-bold text-gray-800 mb-8 leading-tight">
            Connect. Learn. Earn
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
            A Real Proof-of-Work Internship Platform for Engineering Students. 
            Gain experience, build your portfolio, and impress recruiters with actual work — not just certificates.
          </p>
        </div>

        {/* Three Cards Section */}
        <div className="grid md:grid-cols-3 gap-8 w-full max-w-6xl px-4">
          {/* Join as a Startup - Left Card */}
          <div className="group bg-white/80 backdrop-blur-sm border-2 border-green-300 rounded-3xl p-4 hover:shadow-2xl hover:bg-white/90 transition-all duration-500 hover:-translate-y-2">
            <div className="text-center">
              <div className="text-4xl mb-4">
                🏢
              </div>
              <h3 className="text-lg font-bold text-gray-800 mb-2">
                Join as a Startup
              </h3>
              <p className="text-gray-600 mb-4 text-sm leading-relaxed">
                Connect with talented engineering students and get real work done while providing valuable learning experiences.
              </p>
              <Button 
                onClick={() => setSignupType('startup')}
                className="w-full h-10 bg-black hover:bg-gray-800 text-white font-semibold rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 text-sm"
              >
                Get Started
              </Button>
            </div>
          </div>

          {/* Start as a Student - Center Card */}
          <div className="group bg-white/80 backdrop-blur-sm border-2 border-blue-300 rounded-3xl p-4 hover:shadow-2xl hover:bg-white/90 transition-all duration-500 hover:-translate-y-2 relative">
            <div className="text-center">
              <div className="text-4xl mb-4">
                🚀
              </div>
              <h3 className="text-lg font-bold text-gray-800 mb-2">
                Start as a Student
              </h3>
              <p className="text-gray-600 mb-4 text-sm leading-relaxed">
                Begin your journey with real-world projects, build your portfolio, and earn while you learn from industry experts.
              </p>
              <Button 
                onClick={() => setSignupType('student')}
                className="w-full h-10 bg-black hover:bg-gray-800 text-white font-semibold rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 text-sm"
              >
                Get Started
              </Button>
            </div>
          </div>

          {/* Connect as a College - Right Card */}
          <div className="group bg-white/80 backdrop-blur-sm border-2 border-purple-300 rounded-3xl p-4 hover:shadow-2xl hover:bg-white/90 transition-all duration-500 hover:-translate-y-2">
            <div className="text-center">
              <div className="text-4xl mb-4">
                🎓
              </div>
              <h3 className="text-lg font-bold text-gray-800 mb-2">
                Connect as a College
              </h3>
              <p className="text-gray-600 mb-4 text-sm leading-relaxed">
                Partner with us to provide your students with real industry experience and improve their employability.
              </p>
              <Button 
                onClick={() => setSignupType('college')}
                className="w-full h-10 bg-black hover:bg-gray-800 text-white font-semibold rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 text-sm"
              >
                Get Started
              </Button>
            </div>
          </div>
        </div>

        {/* Additional Info Section */}
        <div className="mt-20 text-center">
          <div className="flex items-center justify-center space-x-2 text-gray-400">
            <div className="w-2 h-2 bg-gray-300 rounded-full"></div>
            <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
            <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
            <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
            <div className="w-2 h-2 bg-gray-300 rounded-full"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
