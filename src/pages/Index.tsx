
import StudentSignupForm from "@/components/StudentSignupForm";

const Index = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 px-4 py-8">
      <h1 className="text-4xl font-bold text-blue-900 mb-4 text-center">
        Welcome to ProofLabAI 👨‍💻
      </h1>
      <p className="text-lg text-gray-700 max-w-xl text-center mb-8">
        A Real Proof-of-Work Internship Platform for Engineering Students. 
        Gain experience, build your portfolio, and impress recruiters with actual work — not just certificates.
      </p>
      
      <div className="mb-8">
        <StudentSignupForm />
      </div>
      
      <div className="flex gap-4 flex-wrap justify-center">
        <button className="bg-blue-600 text-white px-5 py-2 rounded-full hover:bg-blue-700 transition-colors">
          🚀 Start as a Student
        </button>
        <button className="bg-green-600 text-white px-5 py-2 rounded-full hover:bg-green-700 transition-colors">
          🏢 Join as a Startup
        </button>
        <button className="bg-purple-600 text-white px-5 py-2 rounded-full hover:bg-purple-700 transition-colors">
          🎓 Connect as a College
        </button>
      </div>
    </div>
  );
};

export default Index;
