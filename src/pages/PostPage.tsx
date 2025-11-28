import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Heart, MessageCircle, ExternalLink, Shield, ArrowLeft, Lock } from "lucide-react";
import { format } from "date-fns";

interface PostData {
  id: string;
  title: string;
  description: string | null;
  emoji_code: string;
  skills: string[] | null;
  external_link: string | null;
  proof_id: string | null;
  student_id: string;
  verified_badge: boolean | null;
  likes_count: number | null;
  comments_count: number | null;
  created_at: string | null;
  visibility: string;
  status: string | null;
  student: {
    full_name: string;
    profile_photo_url: string | null;
    career_goals: string | null;
    slug: string | null;
  } | null;
  proof_upload: {
    is_public: boolean;
    status: string | null;
  } | null;
}

interface RelatedPost {
  id: string;
  title: string;
  emoji_code: string;
  created_at: string | null;
  likes_count: number | null;
}

const PostPage = () => {
  const { postId } = useParams<{ postId: string }>();
  const [post, setPost] = useState<PostData | null>(null);
  const [relatedPosts, setRelatedPosts] = useState<RelatedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getEmoji = (emojiCode: string): string => {
    if (!emojiCode) return "🎯";
    try {
      if (emojiCode.includes("-")) {
        return emojiCode
          .split("-")
          .map((code) => String.fromCodePoint(parseInt(code, 16)))
          .join("");
      }
      return String.fromCodePoint(parseInt(emojiCode, 16));
    } catch {
      return emojiCode;
    }
  };

  useEffect(() => {
    const fetchPost = async () => {
      if (!postId) {
        setError("Post ID is required");
        setLoading(false);
        return;
      }

      try {
        // Fetch post with student info
        const { data: postData, error: postError } = await supabase
          .from("proof_posts")
          .select(`
            id,
            title,
            description,
            emoji_code,
            skills,
            external_link,
            proof_id,
            student_id,
            verified_badge,
            likes_count,
            comments_count,
            created_at,
            visibility,
            status,
            student_profiles!proof_posts_student_id_fkey (
              full_name,
              profile_photo_url,
              career_goals,
              slug
            )
          `)
          .eq("id", postId)
          .single();

        if (postError) {
          if (postError.code === "PGRST116") {
            setError("Post not found");
          } else {
            setError("Failed to load post");
          }
          setLoading(false);
          return;
        }

        // Check if post is accessible (public or verified)
        if (postData.visibility !== "public" && !postData.verified_badge) {
          setError("This post is private");
          setLoading(false);
          return;
        }

        // If internal post, check proof visibility
        let proofData = null;
        if (postData.proof_id) {
          const { data: proof } = await supabase
            .from("proof_uploads")
            .select("is_public, status")
            .eq("id", postData.proof_id)
            .single();
          
          proofData = proof;
          
          // For internal verified posts, proof must be public
          if (proof && !proof.is_public && postData.verified_badge) {
            setError("This proof is private");
            setLoading(false);
            return;
          }
        }

        const formattedPost: PostData = {
          ...postData,
          student: Array.isArray(postData.student_profiles) 
            ? postData.student_profiles[0] 
            : postData.student_profiles,
          proof_upload: proofData,
        };

        setPost(formattedPost);

        // Update SEO meta tags
        document.title = `${postData.title} | ProofLabAI`;
        updateMetaTags(formattedPost);

        // Fetch related posts from same student
        if (postData.student_id) {
          const { data: related } = await supabase
            .from("proof_posts")
            .select("id, title, emoji_code, created_at, likes_count")
            .eq("student_id", postData.student_id)
            .eq("visibility", "public")
            .eq("status", "active")
            .neq("id", postId)
            .order("created_at", { ascending: false })
            .limit(3);

          if (related) {
            setRelatedPosts(related);
          }
        }
      } catch (err) {
        console.error("Error fetching post:", err);
        setError("Something went wrong");
      } finally {
        setLoading(false);
      }
    };

    fetchPost();

    return () => {
      // Reset meta tags on unmount
      document.title = "ProofLabAI";
    };
  }, [postId]);

  const updateMetaTags = (postData: PostData) => {
    const studentName = postData.student?.full_name || "Student";
    const description = postData.description?.slice(0, 155) || `Project by ${studentName}`;
    
    // Update or create meta tags
    const setMeta = (name: string, content: string, property?: boolean) => {
      const attr = property ? "property" : "name";
      let meta = document.querySelector(`meta[${attr}="${name}"]`);
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute(attr, name);
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", content);
    };

    setMeta("description", description);
    setMeta("og:title", `${postData.title} | ProofLabAI`, true);
    setMeta("og:description", description, true);
    setMeta("og:type", "article", true);
    setMeta("twitter:card", "summary_large_image");
    setMeta("twitter:title", `${postData.title} | ProofLabAI`);
    setMeta("twitter:description", description);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-4 py-12">
          <Skeleton className="h-8 w-24 mb-8" />
          <Skeleton className="h-12 w-3/4 mb-4" />
          <Skeleton className="h-6 w-1/2 mb-8" />
          <Skeleton className="h-40 w-full mb-6" />
          <div className="flex gap-2 mb-8">
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-14" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center px-4">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-muted flex items-center justify-center">
            {error.includes("private") ? (
              <Lock className="w-10 h-10 text-muted-foreground" />
            ) : (
              <span className="text-4xl">🔍</span>
            )}
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {error.includes("private") ? "Private Content" : "Post Not Found"}
          </h1>
          <p className="text-muted-foreground mb-6 max-w-md">
            {error.includes("private")
              ? "This content is not publicly available. The owner may have set it to private."
              : "The post you're looking for doesn't exist or may have been removed."}
          </p>
          <Link to="/">
            <Button variant="outline">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Go Home
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!post) return null;

  const isInternalPost = !!post.proof_id;
  const studentName = post.student?.full_name || "Student";
  const formattedDate = post.created_at
    ? format(new Date(post.created_at), "MMMM d, yyyy")
    : "";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-foreground hover:opacity-80 transition-opacity">
            <ArrowLeft className="w-4 h-4" />
            <span className="font-medium">ProofLabAI</span>
          </Link>
          {post.student?.slug && (
            <Link to={`/portfolio/${post.student.slug}`}>
              <Button variant="outline" size="sm">
                View Portfolio
              </Button>
            </Link>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
        {/* Post Header */}
        <div className="relative mb-8">
          {/* Floating Emoji */}
          <div className="absolute -top-2 right-0 sm:right-4">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-muted/50 flex items-center justify-center shadow-sm">
              <span className="text-4xl sm:text-5xl">{getEmoji(post.emoji_code)}</span>
            </div>
          </div>

          {/* Verification Badge */}
          <div className="mb-4">
            {isInternalPost && post.verified_badge ? (
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0">
                <Shield className="w-3 h-3 mr-1" />
                Verified Proof • ProofLabAI
              </Badge>
            ) : (
              <Badge variant="secondary" className="bg-muted text-muted-foreground border-0">
                External Project
              </Badge>
            )}
          </div>

          {/* Title */}
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground mb-4 pr-24 sm:pr-32">
            {post.title}
          </h1>

          {/* Author Info */}
          <div className="flex items-center gap-3">
            <Avatar className="w-10 h-10">
              <AvatarImage src={post.student?.profile_photo_url || undefined} />
              <AvatarFallback className="bg-primary/10 text-primary">
                {studentName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium text-foreground">{studentName}</p>
              <p className="text-sm text-muted-foreground">{formattedDate}</p>
            </div>
          </div>
        </div>

        {/* Description */}
        {post.description && (
          <div className="prose prose-neutral dark:prose-invert max-w-none mb-8">
            <p className="text-foreground/90 text-base sm:text-lg leading-relaxed whitespace-pre-wrap">
              {post.description}
            </p>
          </div>
        )}

        {/* Skills */}
        {post.skills && post.skills.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-8">
            {post.skills.map((skill, index) => (
              <Badge
                key={index}
                variant="secondary"
                className="bg-primary/10 text-primary border-0 px-3 py-1"
              >
                {skill}
              </Badge>
            ))}
          </div>
        )}

        {/* Action Button */}
        <div className="mb-8">
          {isInternalPost && post.proof_id ? (
            <Link to={`/student/proof/${post.proof_id}`}>
              <Button className="gap-2">
                <Shield className="w-4 h-4" />
                View Verified Proof
              </Button>
            </Link>
          ) : post.external_link ? (
            <a href={post.external_link} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="gap-2">
                <ExternalLink className="w-4 h-4" />
                Open Project
              </Button>
            </a>
          ) : null}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-6 py-4 border-t border-b border-border/40 mb-8">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Heart className="w-5 h-5" />
            <span className="font-medium">{post.likes_count || 0} likes</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <MessageCircle className="w-5 h-5" />
            <span className="font-medium">{post.comments_count || 0} comments</span>
          </div>
        </div>

        {/* Related Posts */}
        {relatedPosts.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-4">
              More from {studentName}
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {relatedPosts.map((relatedPost) => (
                <Link key={relatedPost.id} to={`/post/${relatedPost.id}`}>
                  <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-lg bg-muted/50 flex items-center justify-center flex-shrink-0">
                          <span className="text-xl">{getEmoji(relatedPost.emoji_code)}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-medium text-sm text-foreground line-clamp-2 mb-1">
                            {relatedPost.title}
                          </h3>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Heart className="w-3 h-3" />
                            <span>{relatedPost.likes_count || 0}</span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border/40 py-8 mt-12">
        <div className="max-w-3xl mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>
            Built with{" "}
            <Link to="/" className="text-primary hover:underline">
              ProofLabAI
            </Link>
            {" "}— Verified student portfolios
          </p>
        </div>
      </footer>
    </div>
  );
};

export default PostPage;
