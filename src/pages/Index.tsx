import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

const Index = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100">
      <header className="bg-white/90 backdrop-blur-sm border-b border-orange-200/30 px-6 py-4">
        <div className="container mx-auto flex items-center justify-between">
          <div className="text-gray-900 px-6 py-3 rounded-2xl font-bold text-lg flex items-center space-x-3">
            <img 
              src="/lovable-uploads/b9197a47-7e43-4b27-8ab7-ce8138fcd94c.png" 
              alt="ProofLabAI Logo" 
              className="h-12 w-12"
            />
            <span>ProofLabAI</span>
          </div>
          <nav className="space-x-6">
            <a href="#" className="text-gray-700 hover:text-gray-900">
              Features
            </a>
            <a href="#" className="text-gray-700 hover:text-gray-900">
              Pricing
            </a>
            <a href="#" className="text-gray-700 hover:text-gray-900">
              About
            </a>
            <a href="#" className="text-gray-700 hover:text-gray-900">
              Contact
            </a>
          </nav>
        </div>
      </header>
      
      <main className="container mx-auto px-4 py-16">
        <div className="text-center max-w-4xl mx-auto">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 mb-6">
            Unlock Your Potential with ProofLabAI
          </h1>
          <p className="text-lg text-gray-700 mb-8">
            Revolutionize your learning experience with AI-powered tools and personalized feedback.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mt-8">
            <Button size="lg" className="bg-gray-900 hover:bg-gray-800 text-white px-8 py-3 rounded-full">
              Get Started
            </Button>
            <Button 
              variant="outline" 
              size="lg" 
              className="border-gray-900 text-gray-900 hover:bg-gray-900 hover:text-white px-8 py-3 rounded-full"
              asChild
            >
              <Link to="/auth">Student Login</Link>
            </Button>
            <Button 
              variant="outline" 
              size="lg" 
              className="border-gray-900 text-gray-900 hover:bg-gray-900 hover:text-white px-8 py-3 rounded-full"
              asChild
            >
              <Link to="/student/dashboard">Dashboard</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;
