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
          <div className="group bg-white/70 backdrop-blur-sm border border-white/30 rounded-3xl p-8 hover:shadow-2xl hover:bg-white/80 transition-all duration-500 hover:-translate-y-2">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-green-400 to-green-600 rounded-2xl mx-auto mb-8 shadow-lg group-hover:scale-110 transition-transform duration-300">
                <span className="text-3xl">🏢</span>
              </div>
              <h3 className="text-2xl font-bold text-gray-800 mb-4">
                Join as a Startup
              </h3>
              <p className="text-gray-600 mb-8 text-base leading-relaxed">
                Connect with talented engineering students and get real work done while providing valuable learning experiences.
              </p>
              <Button 
                onClick={() => setSignupType('startup')}
                className="w-full h-14 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 text-base"
              >
                Get Started
              </Button>
            </div>
          </div>

          {/* Start as a Student - Center Card (Featured) */}
          <div className="group bg-white/80 backdrop-blur-sm border-2 border-blue-200 rounded-3xl p-8 hover:shadow-2xl hover:bg-white/90 transition-all duration-500 hover:-translate-y-2 relative">
            <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
              <span className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-2 rounded-full text-sm font-bold shadow-lg">
                Most Popular
              </span>
            </div>
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl mx-auto mb-8 shadow-lg group-hover:scale-110 transition-transform duration-300">
                <span className="text-3xl">🚀</span>
              </div>
              <h3 className="text-2xl font-bold text-gray-800 mb-4">
                Start as a Student
              </h3>
              <p className="text-gray-600 mb-8 text-base leading-relaxed">
                Begin your journey with real-world projects, build your portfolio, and earn while you learn from industry experts.
              </p>
              <Button 
                onClick={() => setSignupType('student')}
                className="w-full h-14 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 text-base"
              >
                Get Started
              </Button>
            </div>
          </div>

          {/* Connect as a College - Right Card */}
          <div className="group bg-white/70 backdrop-blur-sm border border-white/30 rounded-3xl p-8 hover:shadow-2xl hover:bg-white/80 transition-all duration-500 hover:-translate-y-2">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-purple-500 to-purple-700 rounded-2xl mx-auto mb-8 shadow-lg group-hover:scale-110 transition-transform duration-300">
                <span className="text-3xl">🎓</span>
              </div>
              <h3 className="text-2xl font-bold text-gray-800 mb-4">
                Connect as a College
              </h3>
              <p className="text-gray-600 mb-8 text-base leading-relaxed">
                Partner with us to provide your students with real industry experience and improve their employability.
              </p>
              <Button 
                onClick={() => setSignupType('college')}
                className="w-full h-14 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-semibold rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 text-base"
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
