
const StudentDashboard = () => {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Student Dashboard</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-4 text-blue-600">🎯 Your Projects</h2>
            <p className="text-gray-600">View and manage your internship projects</p>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-4 text-green-600">📊 Progress</h2>
            <p className="text-gray-600">Track your learning progress and achievements</p>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-4 text-purple-600">🏢 Opportunities</h2>
            <p className="text-gray-600">Explore new internship opportunities</p>
          </div>
        </div>
        
        <div className="mt-8 bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-2xl font-semibold mb-4">Welcome to ProofLabAI!</h2>
          <p className="text-gray-600 mb-4">
            You've successfully verified your email and joined our platform. Here you can:
          </p>
          <ul className="list-disc list-inside text-gray-600 space-y-2">
            <li>Work on real-world projects with startup companies</li>
            <li>Build a portfolio that impresses recruiters</li>
            <li>Gain actual work experience, not just certificates</li>
            <li>Connect with industry professionals</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default StudentDashboard;
