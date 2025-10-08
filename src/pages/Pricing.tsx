import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import { Link } from "react-router-dom";
import { Logo } from "@/components/Logo";

type AudienceType = "student" | "college" | "startup";
type BillingType = "monthly" | "annual";

interface PlanData {
  title: string;
  price: number | { monthly: number; annual: number };
  features: string[];
  popular?: boolean;
}

const Pricing = () => {
  const [selectedAudience, setSelectedAudience] = useState<AudienceType>("student");
  const [billingType, setBillingType] = useState<BillingType>("monthly");

  const getDiscount = (price: number) => {
    return billingType === "annual" ? Math.round(price * 0.8) : price;
  };

  const pricingData = {
    student: {
      freemium: {
        title: "Freemium",
        price: 0,
        features: [
          "2 tasks per month",
          "Basic feedback",
          "Public proof link",
          "Community access",
          "Basic portfolio"
        ]
      },
      basic: {
        title: "Basic",
        price: { monthly: 99, annual: 999 },
        features: [
          "10 tasks per month",
          "Advanced feedback",
          "Custom portfolio page",
          "AI resume assistance",
          "Priority support"
        ]
      },
      pro: {
        title: "Pro",
        price: { monthly: 499, annual: 3999 },
        features: [
          "Unlimited tasks",
          "AI-powered feedback",
          "Mock interview reviews",
          "Certification generation",
          "Early startup access",
          "1-on-1 mentorship"
        ],
        popular: true
      }
    },
    college: {
      freemium: {
        title: "Freemium",
        price: 0,
        features: [
          "5 students maximum",
          "Dashboard preview",
          "Limited review tools",
          "Basic analytics",
          "Community support"
        ]
      },
      basic: {
        title: "Basic",
        price: { monthly: 999, annual: 7999 },
        features: [
          "50 students",
          "Task assignment tools",
          "Performance tracking",
          "Student progress reports",
          "Email support"
        ]
      },
      pro: {
        title: "Pro",
        price: { monthly: 1999, annual: 15999 },
        features: [
          "150 students",
          "Full review dashboard",
          "AI progress tracking",
          "TPO analytics",
          "Custom branding",
          "Dedicated support"
        ],
        popular: true
      }
    },
    startup: {
      freemium: {
        title: "Freemium",
        price: 0,
        features: [
          "5 tasks per month",
          "Access to public proofs",
          "Basic talent search",
          "Community access",
          "Standard support"
        ]
      },
      basic: {
        title: "Basic",
        price: { monthly: 499, annual: 3999 },
        features: [
          "20 tasks per month",
          "Filter talent by skills",
          "Direct student messaging",
          "Proof verification",
          "Priority listings"
        ]
      },
      pro: {
        title: "Pro",
        price: { monthly: 1499, annual: 11999 },
        features: [
          "Unlimited tasks",
          "AI talent matching",
          "Batch hiring tools",
          "Trust score insights",
          "Custom branding",
          "Dedicated account manager"
        ],
        popular: true
      }
    }
  };

  const currentData = pricingData[selectedAudience];

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation with Logo */}
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center space-x-3 cursor-pointer">
              <Logo />
              <span className="text-xl font-bold text-foreground">ProofLabAI</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Header */}
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4">
            Choose the plan that fits you
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Affordable plans for Students, Colleges, and Startups – with verified proof-of-work for everyone.
          </p>
        </div>

        {/* Audience Tabs */}
        <div className="flex justify-center mb-8">
          <div className="bg-muted rounded-2xl p-1 inline-flex">
            {(["student", "college", "startup"] as AudienceType[]).map((audience) => (
              <button
                key={audience}
                onClick={() => setSelectedAudience(audience)}
                className={`px-6 py-3 rounded-xl font-medium transition-all ${
                  selectedAudience === audience
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {audience.charAt(0).toUpperCase() + audience.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Billing Toggle */}
        <div className="flex justify-center items-center gap-4 mb-12">
          <span className={`font-medium ${billingType === "monthly" ? "text-foreground" : "text-muted-foreground"}`}>
            Monthly
          </span>
          <button
            onClick={() => setBillingType(billingType === "monthly" ? "annual" : "monthly")}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              billingType === "annual" ? "bg-primary" : "bg-muted"
            }`}
          >
            <div
              className={`absolute w-5 h-5 bg-white rounded-full top-0.5 transition-transform ${
                billingType === "annual" ? "translate-x-6" : "translate-x-0.5"
              }`}
            />
          </button>
          <span className={`font-medium ${billingType === "annual" ? "text-foreground" : "text-muted-foreground"}`}>
            Annual
          </span>
          {billingType === "annual" && (
            <Badge variant="secondary" className="ml-2">
              Save 20%
            </Badge>
          )}
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
        {Object.entries(currentData).map(([planKey, plan]: [string, PlanData]) => {
            const isPopular = plan.popular;
            const price = typeof plan.price === "object" 
              ? getDiscount(plan.price[billingType]) 
              : plan.price;

            return (
              <Card
                key={planKey}
                className={`relative rounded-2xl border-2 transition-all hover:shadow-lg ${
                  isPopular 
                    ? "border-primary shadow-lg scale-105" 
                    : "border-border hover:border-primary/50"
                }`}
              >
                {isPopular && (
                  <Badge className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-primary text-primary-foreground">
                    Most Popular
                  </Badge>
                )}
                
                <CardHeader className="text-center pb-4">
                  <CardTitle className="text-xl font-semibold">
                    {plan.title}
                  </CardTitle>
                  <div className="mt-4">
                    {price === 0 ? (
                      <div className="text-3xl font-bold">Free</div>
                    ) : (
                      <div>
                        <div className="text-3xl font-bold">
                          ₹{price.toLocaleString()}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          per {billingType === "monthly" ? "month" : "year"}
                        </div>
                        {billingType === "annual" && typeof plan.price === "object" && (
                          <div className="text-xs text-muted-foreground line-through">
                            ₹{plan.price.annual.toLocaleString()} / year
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </CardHeader>

                <CardContent>
                  <ul className="space-y-3 mb-6">
                    {plan.features.map((feature, index) => (
                      <li key={index} className="flex items-start gap-3">
                        <Check className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>
                  
                  <Button 
                    className={`w-full rounded-xl ${
                      isPopular 
                        ? "bg-primary hover:bg-primary/90" 
                        : "variant-outline"
                    }`}
                    variant={isPopular ? "default" : "outline"}
                  >
                    {price === 0 ? "Get Started Free" : "Choose Plan"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* CTA Section */}
        <div className="text-center mt-16 p-8 bg-muted/50 rounded-2xl">
          <h2 className="text-2xl font-bold mb-4">Ready to get started?</h2>
          <p className="text-muted-foreground mb-6">
            Join thousands of students, colleges, and startups building verified proof-of-work.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild size="lg" className="rounded-xl">
              <Link to="/auth?role=student">Create Student Account</Link>
            </Button>
            <Button asChild size="lg" className="rounded-xl">
              <Link to="/auth?role=college">Join as College</Link>
            </Button>
            <Button asChild size="lg" className="rounded-xl">
              <Link to="/auth?role=startup">Hire via Startup Account</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Pricing;