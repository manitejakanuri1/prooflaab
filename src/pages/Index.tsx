import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "react-router-dom";
import { CheckCircle, Users, Target, TrendingUp, Star, Award, Zap, Shield, ChevronRight, Menu, X, Building, Briefcase, GraduationCap, Upload, Clock, Trophy } from "lucide-react";
import { useState } from "react";
import StickyCtaBar from "@/components/StickyCtaBar";

const Index = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("students");
  const navigate = useNavigate();

  useEffect(() => {
    // Check if this is an auth callback with tokens in the hash
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');
    
    if (accessToken && refreshToken) {
      console.log('Index: Auth tokens found in hash, redirecting to callback handler');
      // Redirect to auth callback with the hash intact
      navigate(`/auth/callback${window.location.hash}`, { replace: true });
      return;
    }

    // Only redirect authenticated users, don't interfere with public access
    const checkUser = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          // Get user role and redirect accordingly  
          const { data: roleData } = await supabase
            .from('user_roles')
            .select('role, has_completed_wizard')
            .eq('user_id', session.user.id)
            .maybeSingle();
          
          if (roleData) {
            if (!roleData.has_completed_wizard && roleData.role !== 'admin') {
              navigate('/onboarding-wizard', { replace: true });
            } else {
              // Redirect to appropriate dashboard
              const role = roleData.role;
              switch (role) {
                case 'admin':
                  navigate('/admin/dashboard', { replace: true });
                  break;
                case 'college_admin':
                  navigate('/college/dashboard', { replace: true });
                  break;
                case 'startup':
                  navigate('/startup/dashboard', { replace: true });
                  break;
                case 'student':
                default:
                  navigate('/student/dashboard', { replace: true });
                  break;
              }
            }
          }
        }
      } catch (error) {
        console.error('Error checking user session:', error);
        // Don't redirect on error, let them access the landing page
      }
    };
    
    checkUser();
  }, [navigate]);

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
    setMobileMenuOpen(false);
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setMobileMenuOpen(false);
  };


  return (
    <div className="min-h-screen bg-background font-sans scroll-smooth">
      {/* Top Navigation - Sticky */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 cursor-pointer" onClick={scrollToTop}>
              <img 
                src="/lovable-uploads/b9197a47-7e43-4b27-8ab7-ce8138fcd94c.png" 
                alt="ProofLabAI Logo" 
                className="h-10 w-10"
              />
              <span className="text-xl font-bold text-foreground">ProofLabAI</span>
            </div>
            
            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center space-x-8">
              <button onClick={() => scrollToSection('workflow')} className="text-muted-foreground hover:text-foreground transition-colors">How It Works</button>
              <button onClick={() => scrollToSection('colleges')} className="text-muted-foreground hover:text-foreground transition-colors">For Colleges</button>
              <button onClick={() => scrollToSection('startups')} className="text-muted-foreground hover:text-foreground transition-colors">For Startups</button>
              <Link to="/pricing" className="text-muted-foreground hover:text-foreground transition-colors">Try Premium</Link>
            </nav>

            {/* Desktop Auth Buttons */}
            <div className="hidden md:flex items-center space-x-4">
              <Link to="/auth" className="text-muted-foreground hover:text-foreground transition-colors">
                Login
              </Link>
              <Button asChild size="sm" className="rounded-2xl">
                <Link to="/auth">Get Started</Link>
              </Button>
            </div>

            {/* Mobile Menu Button */}
            <button 
              className="md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>

          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="md:hidden mt-4 pb-4 border-t border-border">
              <div className="flex flex-col space-y-4 pt-4">
                <button onClick={() => scrollToSection('workflow')} className="text-left text-muted-foreground hover:text-foreground transition-colors">How It Works</button>
                <button onClick={() => scrollToSection('colleges')} className="text-left text-muted-foreground hover:text-foreground transition-colors">For Colleges</button>
                <button onClick={() => scrollToSection('startups')} className="text-left text-muted-foreground hover:text-foreground transition-colors">For Startups</button>
                <Link to="/pricing" className="text-muted-foreground hover:text-foreground transition-colors" onClick={() => setMobileMenuOpen(false)}>Pricing</Link>
                <div className="flex flex-col space-y-2 pt-4 border-t border-border">
                  <Link to="/auth" className="text-muted-foreground hover:text-foreground transition-colors" onClick={() => setMobileMenuOpen(false)}>Login</Link>
                  <Button asChild size="sm" className="rounded-2xl w-fit">
                    <Link to="/auth" onClick={() => setMobileMenuOpen(false)}>Get Started</Link>
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-12 lg:py-20">
        <div className="container mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <div className="space-y-6">
                <h1 className="text-4xl lg:text-6xl font-bold text-foreground leading-tight">
                  Build Real-World Proof. Land Real Internships.
                </h1>
                <p className="text-xl text-muted-foreground leading-relaxed">
                  India's first AI-powered internship proof platform for engineering students. 
                  No fake certificates. Only verified work that builds your credibility.
                </p>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <Button asChild size="lg" className="rounded-2xl px-8 py-6 text-lg">
                  <Link to="/auth">Start Your Proof</Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="rounded-2xl px-8 py-6 text-lg">
                  <Link to="/auth">Try as College</Link>
                </Button>
              </div>
            </div>
            
            <div className="relative">
              <div className="bg-muted rounded-3xl p-8 shadow-2xl">
                <img 
                  src="/lovable-uploads/dba3a561-930a-4e90-84a7-09a19371deb3.png" 
                  alt="Dashboard Preview" 
                  className="w-full h-auto rounded-2xl"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem Section */}
      <section className="py-20 bg-muted/30">
        <div className="container mx-auto px-6 text-center">
          <div className="max-w-4xl mx-auto space-y-6">
            <h2 className="text-3xl lg:text-5xl font-bold text-foreground">
              Fake Internships Are Killing Trust.
            </h2>
            <p className="text-xl text-muted-foreground leading-relaxed">
              78% of engineering students submit unverifiable certificates. Recruiters don't trust them. 
              ProofLab is here to fix that — with real tasks, verified proofs, and public portfolios.
            </p>
          </div>
        </div>
      </section>

      {/* How ProofLab Works - 3-Tab Section */}
      <section id="workflow" className="py-20">
        <div className="container mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-5xl font-bold text-foreground mb-6">
              How ProofLab Works
            </h2>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
              Choose your path: Student building proof, College tracking progress, or Startup hiring talent
            </p>
          </div>
          
          <Tabs value={activeTab} onValueChange={setActiveTab} className="max-w-6xl mx-auto">
            <TabsList className="grid w-full grid-cols-3 mb-12 h-14">
              <TabsTrigger value="students" className="flex items-center gap-2 text-base">
                <GraduationCap className="w-5 h-5" />
                For Students
              </TabsTrigger>
              <TabsTrigger value="colleges" className="flex items-center gap-2 text-base">
                <Building className="w-5 h-5" />
                For Colleges
              </TabsTrigger>
              <TabsTrigger value="startups" className="flex items-center gap-2 text-base">
                <Briefcase className="w-5 h-5" />
                For Startups
              </TabsTrigger>
            </TabsList>

            <TabsContent value="students">
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
                {[
                  {
                    icon: Target,
                    title: "Discover Real Tasks",
                    description: "Get tasks designed by real startups and verified by AI"
                  },
                  {
                    icon: Clock,
                    title: "Build in 7 Days",
                    description: "Work on meaningful projects with clear deadlines"
                  },
                  {
                    icon: Upload,
                    title: "Upload Your Work",
                    description: "Submit files, links, or documentation as proof"
                  },
                  {
                    icon: Trophy,
                    title: "Get Verified & Rewarded",
                    description: "Earn XP, Trust Score, and unlock internship opportunities"
                  }
                ].map((item, index) => (
                  <Card key={index} className="rounded-2xl border-2 hover:shadow-lg transition-all duration-300">
                    <CardHeader className="text-center p-6">
                      <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto mb-4">
                        <item.icon className="w-8 h-8 text-primary-foreground" />
                      </div>
                      <CardTitle className="text-xl">{item.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="text-center p-6 pt-0">
                      <CardDescription className="text-base">{item.description}</CardDescription>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="text-center">
                <Button asChild size="lg" className="rounded-2xl px-8 py-4">
                  <Link to="/pricing">
                    See full pricing plans <ChevronRight className="w-5 h-5 ml-2" />
                  </Link>
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="colleges">
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
                {[
                  {
                    icon: Users,
                    title: "Upload Students",
                    description: "Add your students and track their real-world progress"
                  },
                  {
                    icon: Target,
                    title: "Assign Tasks",
                    description: "Create custom tasks or use AI-generated assignments"
                  },
                  {
                    icon: TrendingUp,
                    title: "Monitor Progress",
                    description: "View portfolio, trust scores, and proof reviews in real-time"
                  },
                  {
                    icon: Shield,
                    title: "Verified Skills",
                    description: "No fake internships. Only documented skill development"
                  }
                ].map((item, index) => (
                  <Card key={index} className="rounded-2xl border-2 hover:shadow-lg transition-all duration-300">
                    <CardHeader className="text-center p-6">
                      <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto mb-4">
                        <item.icon className="w-8 h-8 text-primary-foreground" />
                      </div>
                      <CardTitle className="text-xl">{item.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="text-center p-6 pt-0">
                      <CardDescription className="text-base">{item.description}</CardDescription>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="text-center">
                <Button asChild size="lg" className="rounded-2xl px-8 py-4">
                  <Link to="/pricing">
                    See full pricing plans <ChevronRight className="w-5 h-5 ml-2" />
                  </Link>
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="startups">
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
                {[
                  {
                    icon: Zap,
                    title: "Post Tasks Fast",
                    description: "Create real-world microtasks in under 2 minutes"
                  },
                  {
                    icon: Users,
                    title: "Discover Talent",
                    description: "Find skilled students from top engineering colleges across India"
                  },
                  {
                    icon: CheckCircle,
                    title: "Review Work",
                    description: "Manually review submissions or use our auto-review system"
                  },
                  {
                    icon: Award,
                    title: "Hire with Confidence",
                    description: "Make hiring decisions based on actual proof, not certificates"
                  }
                ].map((item, index) => (
                  <Card key={index} className="rounded-2xl border-2 hover:shadow-lg transition-all duration-300">
                    <CardHeader className="text-center p-6">
                      <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto mb-4">
                        <item.icon className="w-8 h-8 text-primary-foreground" />
                      </div>
                      <CardTitle className="text-xl">{item.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="text-center p-6 pt-0">
                      <CardDescription className="text-base">{item.description}</CardDescription>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="text-center">
                <Button asChild size="lg" className="rounded-2xl px-8 py-4">
                  <Link to="/pricing">
                    See full pricing plans <ChevronRight className="w-5 h-5 ml-2" />
                  </Link>
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </section>


      {/* Colleges Section */}
      <section id="colleges" className="py-20">
        <div className="container mx-auto px-6 text-center">
          <div className="max-w-4xl mx-auto space-y-6 mb-16">
            <h2 className="text-3xl lg:text-5xl font-bold text-foreground">
              For Colleges & Universities
            </h2>
            <p className="text-xl text-muted-foreground leading-relaxed">
              Track your students' real-world skill development. No more fake internships or unverifiable certificates.
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            <Card className="rounded-2xl p-8">
              <CardContent className="space-y-4">
                <Building className="w-12 h-12 text-primary mx-auto" />
                <h3 className="text-xl font-bold">Student Management</h3>
                <p>Upload and track students across departments</p>
              </CardContent>
            </Card>
            
            <Card className="rounded-2xl p-8">
              <CardContent className="space-y-4">
                <Target className="w-12 h-12 text-primary mx-auto" />
                <h3 className="text-xl font-bold">Custom Tasks</h3>
                <p>Create assignments or use AI-generated tasks</p>
              </CardContent>
            </Card>
            
            <Card className="rounded-2xl p-8">
              <CardContent className="space-y-4">
                <TrendingUp className="w-12 h-12 text-primary mx-auto" />
                <h3 className="text-xl font-bold">Progress Analytics</h3>
                <p>View portfolios, trust scores, and skill growth</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Startups Section */}
      <section id="startups" className="py-20 bg-muted/30">
        <div className="container mx-auto px-6 text-center">
          <div className="max-w-4xl mx-auto space-y-6 mb-16">
            <h2 className="text-3xl lg:text-5xl font-bold text-foreground">
              For Startups & Companies
            </h2>
            <p className="text-xl text-muted-foreground leading-relaxed">
              Discover talented engineering students through verified proof of work. Hire with confidence.
            </p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            <Card className="rounded-2xl p-8">
              <CardContent className="space-y-4">
                <Zap className="w-12 h-12 text-primary mx-auto" />
                <h3 className="text-xl font-bold">Quick Task Creation</h3>
                <p>Post real-world tasks in under 2 minutes</p>
              </CardContent>
            </Card>
            
            <Card className="rounded-2xl p-8">
              <CardContent className="space-y-4">
                <Users className="w-12 h-12 text-primary mx-auto" />
                <h3 className="text-xl font-bold">Talent Discovery</h3>
                <p>Find skilled students from top colleges</p>
              </CardContent>
            </Card>
            
            <Card className="rounded-2xl p-8">
              <CardContent className="space-y-4">
                <Award className="w-12 h-12 text-primary mx-auto" />
                <h3 className="text-xl font-bold">Proof-Based Hiring</h3>
                <p>Make decisions based on actual work, not certificates</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Community & Testimonials */}
      <section className="py-20">
        <div className="container mx-auto px-6 text-center">
          <h2 className="text-3xl lg:text-5xl font-bold text-foreground mb-16">
            Join the ProofLab Community
          </h2>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 mb-16">
            <Card className="rounded-2xl p-8">
              <CardContent className="space-y-4">
                <div className="flex justify-center mb-4">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-5 h-5 text-yellow-400 fill-current" />
                  ))}
                </div>
                <p className="text-lg italic">"I finally have proof of what I can do. No more random certificates."</p>
                <p className="font-semibold">– Sanya R.</p>
              </CardContent>
            </Card>
            
            <Card className="rounded-2xl p-8">
              <CardContent className="space-y-4">
                <Users className="w-12 h-12 text-primary mx-auto" />
                <h3 className="text-xl font-bold">5,000+ Students</h3>
                <p>Building verified portfolios</p>
              </CardContent>
            </Card>
            
            <Card className="rounded-2xl p-8">
              <CardContent className="space-y-4">
                <Shield className="w-12 h-12 text-green-500 mx-auto" />
                <h3 className="text-xl font-bold">100% Verified</h3>
                <p>All proofs are reviewed</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>


      {/* About Section */}
      <section id="about" className="py-20">
        <div className="container mx-auto px-6 text-center">
          <div className="max-w-4xl mx-auto space-y-8">
            <h2 className="text-3xl lg:text-5xl font-bold text-foreground">
              About ProofLab
            </h2>
            <p className="text-xl text-muted-foreground leading-relaxed">
              ProofLab is India's first AI-powered proof-of-work platform designed to bridge the gap between 
              academic learning and real-world application. We're on a mission to eliminate fake internships 
              and unverifiable certificates by providing a transparent, skill-based verification system.
            </p>
            <p className="text-lg text-muted-foreground">
              Our platform connects engineering students with real tasks from startups, enables colleges to 
              track meaningful progress, and helps companies hire based on actual proof of work rather than 
              questionable certificates.
            </p>
          </div>
        </div>
      </section>

      {/* Final CTA & Email Capture */}
      <section id="contact" className="py-20 bg-muted/30">
        <div className="container mx-auto px-6 text-center">
          <div className="max-w-2xl mx-auto space-y-8">
            <h2 className="text-3xl lg:text-5xl font-bold text-foreground">
              Ready to Build Your Proof?
            </h2>
            <Button size="lg" className="rounded-2xl px-8 py-6 text-lg">
              Start Now – It's Free
            </Button>
            
            <div className="space-y-4">
              <p className="text-muted-foreground">Get weekly job & task updates via email</p>
              <div className="flex max-w-md mx-auto space-x-2">
                <Input 
                  placeholder="Enter your email" 
                  className="rounded-2xl"
                />
                <Button className="rounded-2xl">
                  Subscribe
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16 bg-muted border-t border-border">
        <div className="container mx-auto px-6">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div className="space-y-4">
              <div className="flex items-center space-x-3">
                <img 
                  src="/lovable-uploads/b9197a47-7e43-4b27-8ab7-ce8138fcd94c.png" 
                  alt="ProofLabAI Logo" 
                  className="h-8 w-8"
                />
                <span className="text-lg font-bold">ProofLabAI</span>
              </div>
              <p className="text-muted-foreground">Building verified proof for engineering students.</p>
            </div>
            
            <div className="space-y-4">
              <h4 className="font-semibold">Product</h4>
              <div className="space-y-2">
                <Link to="/pricing" className="block text-muted-foreground hover:text-foreground transition-colors">Pricing</Link>
                <button onClick={() => scrollToSection('workflow')} className="block text-left text-muted-foreground hover:text-foreground transition-colors">For Students</button>
                <button onClick={() => scrollToSection('colleges')} className="block text-left text-muted-foreground hover:text-foreground transition-colors">For Colleges</button>
              </div>
            </div>
            
            <div className="space-y-4">
              <h4 className="font-semibold">Company</h4>
              <div className="space-y-2">
                <button onClick={() => scrollToSection('about')} className="block text-left text-muted-foreground hover:text-foreground transition-colors">About ProofLab</button>
                <a href="#" className="block text-muted-foreground hover:text-foreground transition-colors">Blog</a>
                <button onClick={() => scrollToSection('contact')} className="block text-left text-muted-foreground hover:text-foreground transition-colors">Contact</button>
              </div>
            </div>
            
            <div className="space-y-4">
              <h4 className="font-semibold">Legal & Social</h4>
              <div className="space-y-2">
                <Link to="/terms" className="block text-muted-foreground hover:text-foreground transition-colors">Terms & Conditions</Link>
                <Link to="/privacy-policy" className="block text-muted-foreground hover:text-foreground transition-colors">Privacy Policy</Link>
                <a href="https://linkedin.com/company/prooflabai" target="_blank" rel="noopener noreferrer" className="block text-muted-foreground hover:text-foreground transition-colors">LinkedIn</a>
                <a href="https://instagram.com/prooflabai" target="_blank" rel="noopener noreferrer" className="block text-muted-foreground hover:text-foreground transition-colors">Instagram</a>
              </div>
            </div>
          </div>
          
          <div className="border-t border-border pt-8 text-center text-muted-foreground">
            <p>&copy; 2024 ProofLabAI. All rights reserved.</p>
          </div>
        </div>
      </footer>

      {/* Sticky CTA Bar */}
      <StickyCtaBar activeTab={activeTab} />
    </div>
  );
};

export default Index;
