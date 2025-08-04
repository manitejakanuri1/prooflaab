import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Link } from "react-router-dom";
import { CheckCircle, Users, Target, TrendingUp, Star, Award, Zap, Shield, ChevronRight } from "lucide-react";

const Index = () => {
  return (
    <div className="min-h-screen bg-background font-sans">
      {/* Top Navigation - Sticky */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <img 
                src="/lovable-uploads/b9197a47-7e43-4b27-8ab7-ce8138fcd94c.png" 
                alt="ProofLabAI Logo" 
                className="h-10 w-10"
              />
              <span className="text-xl font-bold text-foreground">ProofLabAI</span>
            </div>
            
            <nav className="hidden md:flex items-center space-x-8">
              <a href="#features" className="text-muted-foreground hover:text-foreground transition-colors">Features</a>
              <a href="#students" className="text-muted-foreground hover:text-foreground transition-colors">For Students</a>
              <a href="#colleges" className="text-muted-foreground hover:text-foreground transition-colors">For Colleges</a>
              <a href="#startups" className="text-muted-foreground hover:text-foreground transition-colors">For Startups</a>
              <a href="#pricing" className="text-muted-foreground hover:text-foreground transition-colors">Pricing</a>
              <a href="#faq" className="text-muted-foreground hover:text-foreground transition-colors">FAQ</a>
            </nav>

            <div className="flex items-center space-x-4">
              <Link to="/auth" className="text-muted-foreground hover:text-foreground transition-colors">
                🔐 Login
              </Link>
              <Button asChild size="sm" className="rounded-2xl">
                <Link to="/auth">🔵 Get Started</Link>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-20 lg:py-32">
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
                <Button size="lg" className="rounded-2xl px-8 py-6 text-lg">
                  Start Your Proof
                </Button>
                <Button variant="outline" size="lg" className="rounded-2xl px-8 py-6 text-lg">
                  Try as College
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

      {/* How It Works */}
      <section id="features" className="py-20">
        <div className="container mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-5xl font-bold text-foreground mb-6">
              How ProofLab Works
            </h2>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                step: "1",
                icon: Target,
                title: "Get a Task",
                description: "Receive tasks from AI, your college, or platform admins"
              },
              {
                step: "2",
                icon: TrendingUp,
                title: "Complete in 7 Days",
                description: "Work on real-world projects within the deadline"
              },
              {
                step: "3",
                icon: CheckCircle,
                title: "Upload Your Proof",
                description: "Submit files, links, or documentation of your work"
              },
              {
                step: "4",
                icon: Award,
                title: "Get Verified",
                description: "Earn XP, Trust Score, and build your public portfolio"
              }
            ].map((item, index) => (
              <Card key={index} className="rounded-2xl border-2 hover:shadow-lg transition-all duration-300">
                <CardHeader className="text-center p-6">
                  <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto mb-4">
                    <item.icon className="w-8 h-8 text-primary-foreground" />
                  </div>
                  <div className="w-8 h-8 bg-accent rounded-full flex items-center justify-center mx-auto mb-2 text-sm font-bold">
                    {item.step}
                  </div>
                  <CardTitle className="text-xl">{item.title}</CardTitle>
                </CardHeader>
                <CardContent className="text-center p-6 pt-0">
                  <CardDescription className="text-base">{item.description}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Features Comparison */}
      <section className="py-20 bg-muted/30">
        <div className="container mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-5xl font-bold text-foreground mb-6">
              What You Get — Free vs Premium
            </h2>
          </div>
          
          <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            <Card className="rounded-2xl border-2">
              <CardHeader className="p-8">
                <CardTitle className="text-2xl text-center">Free Plan</CardTitle>
                <CardDescription className="text-center text-lg">Perfect for getting started</CardDescription>
              </CardHeader>
              <CardContent className="p-8 pt-0 space-y-4">
                {[
                  "AI Tasks ✅",
                  "Upload Proofs ✅", 
                  "Proof Reviews (Slow)",
                  "XP & Trust Panel ✅",
                  "Jobs & Resources (Manual)",
                  "Public Portfolio ✅"
                ].map((feature, index) => (
                  <div key={index} className="flex items-center space-x-3">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    <span>{feature}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-2 border-primary shadow-lg">
              <CardHeader className="p-8">
                <CardTitle className="text-2xl text-center">Premium Plan</CardTitle>
                <CardDescription className="text-center text-lg">For serious learners</CardDescription>
              </CardHeader>
              <CardContent className="p-8 pt-0 space-y-4">
                {[
                  "AI Tasks ✅",
                  "Upload Proofs ✅",
                  "Proof Reviews (Fast 🚀)",
                  "Resume Feedback ✅",
                  "XP & Trust Panel ✅",
                  "AI-Personalised Jobs 🔥",
                  "Public Portfolio ✅",
                  "Early Access to Startups ✅"
                ].map((feature, index) => (
                  <div key={index} className="flex items-center space-x-3">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    <span>{feature}</span>
                  </div>
                ))}
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

      {/* Pricing */}
      <section id="pricing" className="py-20 bg-muted/30">
        <div className="container mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl lg:text-5xl font-bold text-foreground mb-6">
              Simple Pricing for Serious Learners
            </h2>
          </div>
          
          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            <Card className="rounded-2xl border-2 p-8">
              <CardHeader className="text-center">
                <div className="text-4xl mb-4">🎓</div>
                <CardTitle className="text-2xl">Free Plan</CardTitle>
                <div className="text-3xl font-bold">₹0<span className="text-base font-normal">/month</span></div>
                <CardDescription>Always free for every student</CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full rounded-2xl" variant="outline">Get Started Free</Button>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-2 border-primary shadow-lg p-8">
              <CardHeader className="text-center">
                <div className="text-4xl mb-4">🚀</div>
                <CardTitle className="text-2xl">Premium Plan</CardTitle>
                <div className="text-3xl font-bold">₹99<span className="text-base font-normal">/month</span></div>
                <CardDescription>Faster reviews, resume feedback, AI job matches</CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full rounded-2xl">Upgrade to Premium</Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Final CTA & Email Capture */}
      <section className="py-20">
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
                <a href="#" className="block text-muted-foreground hover:text-foreground transition-colors">Features</a>
                <a href="#" className="block text-muted-foreground hover:text-foreground transition-colors">Pricing</a>
                <a href="#" className="block text-muted-foreground hover:text-foreground transition-colors">For Students</a>
                <a href="#" className="block text-muted-foreground hover:text-foreground transition-colors">For Colleges</a>
              </div>
            </div>
            
            <div className="space-y-4">
              <h4 className="font-semibold">Company</h4>
              <div className="space-y-2">
                <a href="#" className="block text-muted-foreground hover:text-foreground transition-colors">About</a>
                <a href="#" className="block text-muted-foreground hover:text-foreground transition-colors">Blog</a>
                <a href="#" className="block text-muted-foreground hover:text-foreground transition-colors">Contact</a>
              </div>
            </div>
            
            <div className="space-y-4">
              <h4 className="font-semibold">Legal</h4>
              <div className="space-y-2">
                <a href="#" className="block text-muted-foreground hover:text-foreground transition-colors">Terms</a>
                <a href="#" className="block text-muted-foreground hover:text-foreground transition-colors">Privacy</a>
                <a href="#" className="block text-muted-foreground hover:text-foreground transition-colors">LinkedIn</a>
                <a href="#" className="block text-muted-foreground hover:text-foreground transition-colors">Instagram</a>
              </div>
            </div>
          </div>
          
          <div className="border-t border-border pt-8 text-center text-muted-foreground">
            <p>&copy; 2024 ProofLabAI. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
