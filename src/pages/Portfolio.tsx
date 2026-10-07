import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { usePortfolio } from "@/hooks/usePortfolio";
import { usePublicScorecard } from "@/hooks/usePublicScorecard";
import { RoadmapStages } from "@/components/dashboard/student/RoadmapStages";
import { ShieldCheck } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import ProvenWork, { useProvenWork } from "@/components/portfolio/ProvenWork";
import { supabase } from "@/integrations/supabase/client";
import { RecruiterHeader } from "@/components/public/RecruiterHeader";
import {
  Mail,
  Trophy, Star,
  Briefcase
} from "lucide-react";
import { getInitials } from "@/lib/utils";

const Portfolio = () => {
  const { slug } = useParams<{ slug: string }>();
  const [currentUserId, setCurrentUserId] = useState<string | undefined>();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  
  const { portfolio, loading, error } = usePortfolio(slug);
  const { data: provenWork = [] } = useProvenWork(portfolio?.student_id);
  const { scorecard } = usePublicScorecard(portfolio?.student_id);

  // Get current user ID and check if they're a student
  useEffect(() => {
    const fetchCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);
      
      if (user) {
        // Get student profile ID from user_id
        const { data: profile } = await supabase
          .from('student_profiles')
          .select('id')
          .eq('user_id', user.id)
          .single();
        setCurrentUserId(profile?.id);
      }
      setIsAuthLoading(false);
    };
    fetchCurrentUser();
  }, []);
  
  // Derived state
  const isStudent = !!currentUserId;
  const isRecruiterMode = !isStudent && !isAuthLoading;

  // SEO Meta Tags
  useEffect(() => {
    if (!portfolio || !portfolio.student_profiles) return;

    const studentName = portfolio.student_profiles.full_name || "Student";
    const pageUrl = `${window.location.origin}/portfolio/${slug}`;
    const title = `${studentName} – ProofLabAI Portfolio`;
    const description = (
      portfolio.bio?.slice(0, 155) || 
      `View the work ${studentName} has passed on ProofLabAI.`
    );
    const image = portfolio.student_profiles.profile_photo_url || "https://prooflab.ai/og-default.png";

    // Document title
    document.title = title;

    const setMeta = (name: string, content: string, isProperty = false) => {
      if (!content) return;
      const attr = isProperty ? "property" : "name";
      let meta = document.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute(attr, name);
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", content);
    };

    const setLink = (rel: string, href: string) => {
      if (!href) return;
      let link = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
      if (!link) {
        link = document.createElement("link");
        link.setAttribute("rel", rel);
        document.head.appendChild(link);
      }
      link.setAttribute("href", href);
    };

    // Basic meta
    setMeta("description", description);
    setMeta("author", studentName);

    // Canonical URL
    setLink("canonical", pageUrl);

    // OpenGraph tags
    setMeta("og:title", title, true);
    setMeta("og:description", description, true);
    setMeta("og:type", "profile", true);
    setMeta("og:url", pageUrl, true);
    setMeta("og:image", image, true);
    setMeta("og:site_name", "ProofLabAI", true);
    setMeta("profile:username", studentName, true);

    // Twitter Card tags
    setMeta("twitter:card", "summary_large_image");
    setMeta("twitter:title", title);
    setMeta("twitter:description", description);
    setMeta("twitter:image", image);
    setMeta("twitter:site", "@ProofLabAI");

    // JSON-LD Structured Data
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Person",
      name: studentName,
      description: description,
      image: image,
      url: pageUrl,
      knowsAbout: portfolio.skills || [],
      memberOf: {
        "@type": "Organization",
        name: "ProofLabAI",
        url: "https://prooflab.ai",
      },
    };

    let script = document.querySelector('script[type="application/ld+json"]') as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.setAttribute("type", "application/ld+json");
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(jsonLd);

    return () => {
      document.title = "ProofLabAI";
    };
  }, [portfolio, slug]);

  const handleRetry = () => {
    window.location.reload();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading portfolio...</p>
        </div>
      </div>
    );
  }

  if (error || !portfolio) {
    const isInvalidSlug = error === 'Portfolio not found' || !portfolio;
    return (
      <div className="light min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-orange-100 flex items-center justify-center">
        <Card className="max-w-md mx-auto bg-white border-gray-200">
          <CardContent className="p-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-4">
              {isInvalidSlug ? 'Portfolio Not Found' : 'Something Went Wrong'}
            </h1>
            <p className="text-gray-600 mb-4">
              {isInvalidSlug 
                ? 'This portfolio link is invalid or has been removed.'
                : 'We encountered an error loading this portfolio.'
              }
            </p>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" onClick={handleRetry}>
                Try Again
              </Button>
              <Button onClick={() => window.location.href = '/'}>
                Go to ProofLabAI
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalXP = portfolio?.student_profiles?.total_xp || 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/30 to-background">
      {/* Header */}
      <RecruiterHeader 
        isLoggedIn={!!currentUser} 
        isStudent={isStudent} 
        isLoading={isAuthLoading}
      />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-12">
        <div className="flex gap-8">
          {/* Main Column */}
          <div className="flex-1 min-w-0">
            {/* Hero Section */}
            <div className="relative mb-12 bg-gradient-to-br from-primary/5 via-primary/10 to-primary/5 rounded-3xl p-8 md:p-12 border border-border shadow-lg">
          <div className="flex flex-col md:flex-row items-center gap-8">
            {/* Avatar */}
            <Avatar className="h-32 w-32 ring-4 ring-background shadow-xl">
              <AvatarImage
                src={portfolio?.student_profiles?.profile_photo_url || ""}
                alt={portfolio?.student_profiles?.full_name || "Student"}
              />
              <AvatarFallback className="text-4xl font-bold bg-primary/10">
                {getInitials(portfolio?.student_profiles?.full_name || "Student")}
              </AvatarFallback>
            </Avatar>

            {/* Info */}
            <div className="flex-1 text-center md:text-left">
              <h1 className="text-4xl md:text-5xl font-bold mb-3 bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                {portfolio?.student_profiles?.full_name || "Student"}
              </h1>
              <p className="text-muted-foreground text-lg mb-6 max-w-2xl">
                {portfolio?.bio ||
                  "Passionate student building real-world projects through ProofLabAI."}
              </p>

              {/* Skills */}
              {portfolio?.skills && portfolio.skills.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-6 justify-center md:justify-start">
                  {portfolio.skills.map((skill, index) => (
                    <Badge key={index} variant="secondary" className="text-sm">
                      {skill}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Stats Row */}
              <div className="flex flex-wrap gap-6 justify-center md:justify-start text-sm mb-6">
                <div className="flex items-center gap-2 bg-background/50 px-4 py-2 rounded-full border border-border">
                  <Star className="h-5 w-5 text-yellow-500" />
                  <span className="font-semibold">{totalXP} XP</span>
                </div>
                <div className="flex items-center gap-2 bg-background/50 px-4 py-2 rounded-full border border-border">
                  <Briefcase className="h-5 w-5 text-primary" />
                  <span className="font-semibold">{provenWork.length} Lots passed</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-3 justify-center md:justify-start">
                {/* Contact Button - Show for recruiters with different label */}
                <a
                  href={`mailto:contact@prooflab.ai?subject=Interest in ${portfolio?.student_profiles?.full_name || "Student"}'s Profile`}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-all shadow-md hover:shadow-lg font-medium"
                >
                  <Mail className="h-4 w-4" />
                  <span>{isRecruiterMode ? "Contact Student" : "Contact Me"}</span>
                </a>
              </div>
            </div>
          </div>
            </div>

            {/* Verified Skill Scorecard */}
            {scorecard && (
              <div className="mb-12">
                <div className="flex items-center gap-3 mb-6">
                  <ShieldCheck className="h-7 w-7 text-primary" />
                  <h2 className="text-3xl font-bold">Verified Skill Scorecard</h2>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
                  {[
                    ["Resume Quality", scorecard.resume_quality_score],
                    ["ATS Match", scorecard.ats_match_score],
                    ["Skill Proof", scorecard.skill_proof_score],
                    ["Project Proof", scorecard.project_proof_score],
                    ["Reasoning", scorecard.reasoning_score],
                    ["Interview Readiness", scorecard.interview_readiness_score],
                  ].map(([label, value]) => (
                    <div key={label as string} className="border rounded-xl p-4 text-center bg-card">
                      <div className="text-2xl font-bold">{value ?? "—"}</div>
                      <div className="text-xs text-muted-foreground mt-1">{label}</div>
                    </div>
                  ))}
                </div>
                {scorecard.roadmap && (
                  <div>
                    <p className="text-sm font-medium mb-2">Improvement roadmap</p>
                    <RoadmapStages roadmap={scorecard.roadmap} />
                  </div>
                )}
              </div>
            )}

            {/* Proven work: Lots passed, with the explanation score */}
            <div>
              <div className="flex items-center gap-3 mb-8">
                <Trophy className="h-7 w-7 text-primary" />
                <h2 className="text-3xl font-bold">Proven work</h2>
              </div>
              <ProvenWork studentId={portfolio?.student_id} emptyText="Nothing passed yet. Check back later." />
            </div>
          </div>

        </div>
      </main>

    </div>
  );
};

export default Portfolio;
