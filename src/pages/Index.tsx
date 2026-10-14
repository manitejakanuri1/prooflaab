import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "react-router-dom";
import { CheckCircle, Users, Target, TrendingUp, Star, Award, Zap, Shield, ChevronRight, Menu, X, Building, Briefcase, GraduationCap, Clock, Trophy } from "lucide-react";
import { useState } from "react";
import StickyCtaBar from "@/components/StickyCtaBar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Logo } from "@/components/Logo";

const Index = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("students");
  const navigate = useNavigate();

  useEffect(() => {
    // Only redirect authenticated users.
    const checkUser = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('Error getting session:', error);
          return; // Show landing page on error
        }
        
        if (session?.user) {
          const { data: roleData, error: roleError } = await supabase
            .from('user_roles')
            .select('role, has_completed_wizard')
            .eq('user_id', session.user.id)
            .maybeSingle();
          
          if (roleError) {
            console.error('Error fetching role:', roleError);
            return; // Show landing page on error
          }
          
          if (roleData) {
            if (roleData.role === 'student') {
              // Students are gated by intake, not the wizard flag.
              navigate('/student/start', { replace: true });
            } else if (!roleData.has_completed_wizard && roleData.role !== 'admin') {
              navigate('/onboarding-wizard', { replace: true });
            } else {
              const role = roleData.role;
              switch (role) {
                case 'admin':
                  navigate('/admin/dashboard', { replace: true });
                  break;
                case 'college_admin':
                  navigate('/college/dashboard', { replace: true });
                  break;
                case 'startup':
                case 'recruiter':
                  navigate('/company/dashboard', { replace: true });
                  break;
                // No 'student' case: students are sent to /student/start above
                // and can never reach this switch.
                default:
                  navigate('/student/dashboard', { replace: true });
                  break;
              }
            }
          }
        }
      } catch (error) {
        console.error('Error checking user session:', error);
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
              <Logo />
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
              <ThemeToggle />
              <Button asChild size="sm" className="rounded-2xl">
                <Link to="/auth">Sign In</Link>
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
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Theme:</span>
                    <ThemeToggle />
                  </div>
                  <Button asChild size="sm" className="rounded-2xl w-fit">
                    <Link to="/auth" onClick={() => setMobileMenuOpen(false)}>Sign In</Link>
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
                  <Link to="/auth">Student Sign In</Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="rounded-2xl px-8 py-6 text-lg">
                  <Link to="/auth">College Sign In</Link>
                </Button>
              </div>
            </div>
            
            <div className="relative">
              <div className="bg-muted rounded-3xl p-8 shadow-2xl">
                <img 
                  src="/images/dba3a561-930a-4e90-84a7-09a19371deb3.png" 
                  alt="Dashboard Preview" 
                  className="w-full h-auto rounded-2xl dark:invert dark:brightness-90"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trusted Companies Section */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-6 text-center">
          <div className="max-w-4xl mx-auto space-y-12">
            <h2 className="text-3xl lg:text-5xl font-bold text-foreground">
              Trusted by Startups Hiring Through ProofLabAI
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-8 md:gap-12 lg:gap-16 items-center justify-items-center max-w-3xl mx-auto">
              <img 
                src="/logos/company1.svg" 
                alt="TechCorp" 
                className="w-24 md:w-32 lg:w-36 h-auto text-muted-foreground grayscale hover:grayscale-0 transition-all duration-300 hover:scale-105"
              />
              <img 
                src="/logos/company2.svg" 
                alt="StartupX" 
                className="w-24 md:w-32 lg:w-36 h-auto text-muted-foreground grayscale hover:grayscale-0 transition-all duration-300 hover:scale-105"
              />
              <img 
                src="/logos/company3.svg" 
                alt="InnovateLab" 
                className="w-24 md:w-32 lg:w-36 h-auto text-muted-foreground grayscale hover:grayscale-0 transition-all duration-300 hover:scale-105 md:col-span-1 col-span-2 md:mx-0 mx-auto"
              />
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
                    title: "One Lot a Day",
                    description: "Get one real task each day, built from real industry material"
                  },
                  {
                    icon: Clock,
                    title: "Do It In The App",
                    description: "Write code in the editor or a written answer, checked on the spot"
                  },
                  {
                    icon: Clock,
                    title: "Explain In 60 Seconds",
                    description: "Record a short explanation of your own work"
                  },
                  {
                    icon: Trophy,
                    title: "Build Your Record",
                    description: "Every score comes with the evidence behind it, for companies to read"
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
                    description: "Upload a student CSV; squads are formed automatically"
                  },
                  {
                    icon: Target,
                    title: "Daily Lots",
                    description: "Every student gets a daily real-world task, no setup needed"
                  },
                  {
                    icon: TrendingUp,
                    title: "Monitor Progress",
                    description: "See each student's submissions, scores and learning paths"
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
                <p>See submissions, scores and learning progress</p>
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
                    <Star key={i} className="w-5 h-5 text-warning fill-current" />
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
                <Shield className="w-12 h-12 text-success mx-auto" />
                <h3 className="text-xl font-bold">Checked On The Spot</h3>
                <p>Code runs against tests; written answers are graded against a rubric</p>
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
            <Button asChild size="lg" className="rounded-2xl px-8 py-6 text-lg">
              <Link to="/auth">Sign In</Link>
            </Button>
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
                  src="/images/b9197a47-7e43-4b27-8ab7-ce8138fcd94c.png" 
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
