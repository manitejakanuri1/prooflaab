import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { 
  Heart, 
  MessageCircle, 
  ExternalLink, 
  Shield, 
  ArrowLeft, 
  Lock, 
  Share2,
  Send,
  LogIn,
  Mail,
  Eye,
  MousePointerClick
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { FollowButton } from "@/components/dashboard/student/FollowButton";
import { RecruiterHeader } from "@/components/public/RecruiterHeader";
import { ContactStudentModal } from "@/components/public/ContactStudentModal";
import { usePostEngagement, usePostEngagementStats } from "@/hooks/usePostEngagement";

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
    id: string;
    user_id: string | null;
    full_name: string;
    profile_photo_url: string | null;
    career_goals: string | null;
    slug: string | null;
    branch: string | null;
    college_id: string | null;
    email: string | null;
    total_xp: number | null;
    trust_score: number | null;
    linkedin_url: string | null;
    github_url: string | null;
    resume_url: string | null;
  } | null;
  proof_upload: {
    is_public: boolean;
    status: string | null;
    file_url: string | null;
  } | null;
}

interface RelatedPost {
  id: string;
  title: string;
  emoji_code: string;
  created_at: string | null;
  likes_count: number | null;
}

interface Comment {
  id: string;
  comment: string;
  created_at: string;
  user_id: string;
  student_profiles?: {
    full_name: string;
    profile_photo_url: string | null;
  };
}

const PostPage = () => {
  const { postId } = useParams<{ postId: string }>();
  const navigate = useNavigate();
  const [post, setPost] = useState<PostData | null>(null);
  const [relatedPosts, setRelatedPosts] = useState<RelatedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Auth state
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [currentStudentId, setCurrentStudentId] = useState<string | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  
  // Like state
  const [isLiked, setIsLiked] = useState(false);
  const [localLikesCount, setLocalLikesCount] = useState(0);
  const [isLiking, setIsLiking] = useState(false);
  
  // Comments state
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [isSendingComment, setIsSendingComment] = useState(false);
  const commentsRef = useRef<HTMLDivElement>(null);
  
  // Contact modal state
  const [contactModalOpen, setContactModalOpen] = useState(false);
  
  // Engagement analytics state
  const [engagementStats, setEngagementStats] = useState<{
    views_count: number;
    email_clicks: number;
    linkedin_clicks: number;
    github_clicks: number;
    resume_clicks: number;
  } | null>(null);

  // Post engagement tracking - must be called at top level before any returns
  const postOwnerId = post?.student?.user_id || '';
  const {
    trackView,
    trackEmailClick,
    trackLinkedinClick,
    trackGithubClick,
    trackResumeClick,
  } = usePostEngagement({ 
    postId: postId || '', 
    postOwnerId, 
    isStudent: !!currentStudentId 
  });
  
  const { fetchStats } = usePostEngagementStats(postId);

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

  // Check auth status
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);
      
      if (user) {
        const { data: profile } = await supabase
          .from("student_profiles")
          .select("id")
          .eq("user_id", user.id)
          .single();
        
        if (profile) {
          setCurrentStudentId(profile.id);
        }
      }
      setIsAuthChecking(false);
    };
    
    checkAuth();
  }, []);

  // Fetch post data
  useEffect(() => {
    const fetchPost = async () => {
      if (!postId) {
        setError("Post ID is required");
        setLoading(false);
        return;
      }

      try {
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
              id,
              user_id,
              full_name,
              profile_photo_url,
              career_goals,
              slug,
              branch,
              college_id,
              email,
              total_xp,
              trust_score,
              linkedin_url,
              github_url,
              resume_url
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

        // Check post visibility
        if (postData.visibility !== "public" && !postData.verified_badge) {
          setError("This post is not public");
          setLoading(false);
          return;
        }

        // Check if post is deleted/inactive
        if (postData.status === "deleted") {
          setError("This post is no longer available");
          setLoading(false);
          return;
        }

        // If internal post, check proof visibility
        let proofData = null;
        if (postData.proof_id) {
          const { data: proof } = await supabase
            .from("proof_uploads")
            .select("is_public, status, file_url")
            .eq("id", postData.proof_id)
            .single();
          
          proofData = proof;
          
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
        setLocalLikesCount(postData.likes_count || 0);

        // Update SEO meta tags
        document.title = `${postData.title} | ProofLabAI`;
        updateMetaTags(formattedPost);

        // Fetch related posts
        if (postData.student_id) {
          const { data: related } = await supabase
            .from("proof_posts")
            .select("id, title, emoji_code, created_at, likes_count")
            .eq("student_id", postData.student_id)
            .eq("visibility", "public")
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
      document.title = "ProofLabAI";
    };
  }, [postId]);

  // Check if user has liked the post
  useEffect(() => {
    const checkLikeStatus = async () => {
      if (!currentUser || !postId) return;
      
      const { data } = await supabase
        .from("post_likes")
        .select("id")
        .eq("post_id", postId)
        .eq("user_id", currentUser.id)
        .single();
      
      setIsLiked(!!data);
    };
    
    checkLikeStatus();
  }, [currentUser, postId]);

  // Fetch comments
  useEffect(() => {
    const fetchComments = async () => {
      if (!postId) return;
      
      setIsLoadingComments(true);
      
      const { data: commentsData, error: commentsError } = await supabase
        .from("post_comments")
        .select("*")
        .eq("post_id", postId)
        .order("created_at", { ascending: true });

      if (commentsError) {
        console.error("Error fetching comments:", commentsError);
        setIsLoadingComments(false);
        return;
      }

      const userIds = [...new Set(commentsData?.map((c) => c.user_id) || [])];
      
      if (userIds.length === 0) {
        setComments([]);
        setIsLoadingComments(false);
        return;
      }

      const { data: profilesData } = await supabase
        .from("student_profiles")
        .select("user_id, full_name, profile_photo_url")
        .in("user_id", userIds);

      const profilesMap = new Map(
        profilesData?.map((p) => [p.user_id, p]) || []
      );

      const commentsWithProfiles = commentsData?.map((comment) => ({
        ...comment,
        student_profiles: profilesMap.get(comment.user_id),
      })) || [];

      setComments(commentsWithProfiles);
      setIsLoadingComments(false);
    };

    fetchComments();

    // Setup realtime subscription
    const channel = supabase
      .channel(`public-post-comments-${postId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "post_comments",
          filter: `post_id=eq.${postId}`,
        },
        async (payload) => {
          const newComment = payload.new as any;
          
          // Fetch profile for new comment
          const { data: profile } = await supabase
            .from("student_profiles")
            .select("user_id, full_name, profile_photo_url")
            .eq("user_id", newComment.user_id)
            .single();

          setComments((prev) => {
            if (prev.some(c => c.id === newComment.id)) return prev;
            return [...prev, { ...newComment, student_profiles: profile || undefined }];
          });
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [postId]);

  // Track view on page load
  useEffect(() => {
    if (postId && postOwnerId) {
      trackView();
    }
  }, [postId, postOwnerId, trackView]);

  // Fetch engagement stats for post owner
  useEffect(() => {
    const loadStats = async () => {
      const isOwner = currentStudentId === post?.student_id;
      if (isOwner && postId) {
        const stats = await fetchStats();
        setEngagementStats(stats);
      }
    };
    loadStats();
  }, [currentStudentId, post?.student_id, postId, fetchStats]);

  const updateMetaTags = (postData: PostData) => {
    const studentName = postData.student?.full_name || "Student";
    const pageUrl = `${window.location.origin}/post/${postData.id}`;
    const description = (
      postData.description?.slice(0, 155) || 
      `A verified project by ${studentName} on ProofLabAI`
    );
    const title = `${postData.title} – Verified Proof by ${studentName}`;
    const image = postData.emoji_code 
      ? `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${postData.emoji_code.toLowerCase()}.png`
      : "https://prooflab.ai/og-default.png";
    const datePublished = postData.created_at || new Date().toISOString();
    
    const setMeta = (name: string, content: string, property?: boolean) => {
      if (!content) return;
      const attr = property ? "property" : "name";
      let meta = document.querySelector(`meta[${attr}="${name}"]`);
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

    // Document title
    document.title = title;

    // Basic meta
    setMeta("description", description);
    setMeta("author", studentName);

    // Canonical URL
    setLink("canonical", pageUrl);

    // OpenGraph tags
    setMeta("og:title", title, true);
    setMeta("og:description", description, true);
    setMeta("og:type", "article", true);
    setMeta("og:url", pageUrl, true);
    setMeta("og:image", image, true);
    setMeta("og:site_name", "ProofLabAI", true);
    setMeta("article:published_time", datePublished, true);
    setMeta("article:author", studentName, true);

    // Twitter Card tags
    setMeta("twitter:card", "summary_large_image");
    setMeta("twitter:title", title);
    setMeta("twitter:description", description);
    setMeta("twitter:image", image);
    setMeta("twitter:site", "@ProofLabAI");

    // JSON-LD Structured Data
    const jsonLd = {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: postData.title,
      description: description,
      author: {
        "@type": "Person",
        name: studentName,
      },
      publisher: {
        "@type": "Organization",
        name: "ProofLabAI",
        url: "https://prooflab.ai",
        logo: {
          "@type": "ImageObject",
          url: "https://prooflab.ai/logo.png",
        },
      },
      datePublished: datePublished,
      dateModified: datePublished,
      image: image,
      url: pageUrl,
      mainEntityOfPage: {
        "@type": "WebPage",
        "@id": pageUrl,
      },
    };

    let script = document.querySelector('script[type="application/ld+json"]') as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.setAttribute("type", "application/ld+json");
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(jsonLd);
  };

  const handleLike = async () => {
    if (!currentUser) {
      toast.info("Please login to like posts");
      return;
    }
    
    if (isLiking || !postId) return;
    
    setIsLiking(true);
    const wasLiked = isLiked;
    
    // Optimistic update
    setIsLiked(!wasLiked);
    setLocalLikesCount(prev => wasLiked ? prev - 1 : prev + 1);
    
    try {
      if (wasLiked) {
        await supabase
          .from("post_likes")
          .delete()
          .eq("post_id", postId)
          .eq("user_id", currentUser.id);
      } else {
        await supabase
          .from("post_likes")
          .insert({ post_id: postId, user_id: currentUser.id });
      }
    } catch (error) {
      // Revert on error
      setIsLiked(wasLiked);
      setLocalLikesCount(prev => wasLiked ? prev + 1 : prev - 1);
      toast.error("Failed to update like");
    } finally {
      setIsLiking(false);
    }
  };

  const handleComment = async () => {
    if (!currentUser) {
      toast.info("Please login to comment");
      return;
    }
    
    if (!commentText.trim() || !postId || isSendingComment) return;
    
    setIsSendingComment(true);
    const tempText = commentText.trim();
    setCommentText("");
    
    try {
      const { data: newComment, error } = await supabase
        .from("post_comments")
        .insert({
          post_id: postId,
          user_id: currentUser.id,
          comment: tempText,
        })
        .select()
        .single();

      if (error) throw error;

      const { data: profile } = await supabase
        .from("student_profiles")
        .select("user_id, full_name, profile_photo_url")
        .eq("user_id", currentUser.id)
        .single();

      if (newComment) {
        setComments((prev) => {
          if (prev.some(c => c.id === newComment.id)) return prev;
          return [...prev, { ...newComment, student_profiles: profile || undefined }];
        });
      }

      toast.success("Comment posted!");
      
      // Scroll to comments
      setTimeout(() => {
        commentsRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } catch (error) {
      console.error("Error posting comment:", error);
      toast.error("Failed to post comment");
      setCommentText(tempText);
    } finally {
      setIsSendingComment(false);
    }
  };

  const handleShare = async () => {
    const publicUrl = `${window.location.origin}/post/${postId}`;
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success("Post link copied!");
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = publicUrl;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      toast.success("Post link copied!");
    }
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
            {error.includes("private") || error.includes("public") ? (
              <Lock className="w-10 h-10 text-muted-foreground" />
            ) : (
              <span className="text-4xl">🔍</span>
            )}
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {error.includes("private") || error.includes("public") 
              ? "Private Content" 
              : error.includes("no longer") 
                ? "Post Unavailable"
                : "Post Not Found"}
          </h1>
          <p className="text-muted-foreground mb-6 max-w-md">
            {error}
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
  const isOwner = currentStudentId === post.student_id;
  
  // Recruiter mode: not logged in OR logged in but not a student
  const isStudent = !!currentStudentId;
  const isRecruiterMode = !isStudent && !isAuthChecking;


  const totalContactClicks = engagementStats 
    ? engagementStats.email_clicks + engagementStats.linkedin_clicks + engagementStats.github_clicks + engagementStats.resume_clicks
    : 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <RecruiterHeader 
        isLoggedIn={!!currentUser} 
        isStudent={isStudent} 
        isLoading={isAuthChecking}
      />

      {/* Main Content */}
      <main className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
        {/* Post Header */}
        <div className="relative mb-8">
          {/* Floating Emoji - Animated */}
          <div className="absolute -top-2 right-0 sm:right-4">
            <div 
              className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center shadow-lg animate-bounce"
              style={{ animationDuration: '3s' }}
            >
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
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground mb-2 pr-24 sm:pr-32">
            {post.title}
          </h1>

          {/* Subtitle */}
          <p className="text-muted-foreground mb-4">
            By {studentName} • {formattedDate}
          </p>

          {/* Analytics Box - Only visible to post owner */}
          {isOwner && engagementStats && (
            <div className="flex items-center gap-4 mb-6 p-3 rounded-lg bg-muted/50 border border-border/50">
              <div className="flex items-center gap-2 text-sm">
                <Eye className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium">{engagementStats.views_count}</span>
                <span className="text-muted-foreground">views</span>
              </div>
              <div className="h-4 w-px bg-border" />
              <div className="flex items-center gap-2 text-sm">
                <MousePointerClick className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium">{totalContactClicks}</span>
                <span className="text-muted-foreground">contact actions</span>
              </div>
            </div>
          )}
        </div>

        {/* Author Bio Section */}
        <Card className="mb-8 border-border/50">
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-start gap-4">
              <Link to={post.student?.slug ? `/portfolio/${post.student.slug}` : "#"}>
                <Avatar className="w-14 h-14 sm:w-16 sm:h-16 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all">
                  <AvatarImage src={post.student?.profile_photo_url || undefined} />
                  <AvatarFallback className="bg-primary/10 text-primary text-lg">
                    {studentName.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </Link>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <Link 
                      to={post.student?.slug ? `/portfolio/${post.student.slug}` : "#"}
                      className="hover:underline"
                    >
                      <h3 className="font-semibold text-foreground text-lg">{studentName}</h3>
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {post.student?.branch || "Student"} 
                      {post.student?.career_goals && ` • ${post.student.career_goals.slice(0, 60)}${post.student.career_goals.length > 60 ? '...' : ''}`}
                    </p>
                  </div>
                  {/* Follow Button - Only show if logged in as student and not owner */}
                  {isStudent && !isOwner && post.student_id && (
                    <FollowButton
                      targetUserId={post.student_id}
                      currentUserId={currentStudentId}
                      variant="feed"
                      size="sm"
                    />
                  )}
                </div>
                
                {/* Contact Student Button - Show in Recruiter Mode */}
                {isRecruiterMode && post.student && (
                  <button
                    onClick={() => setContactModalOpen(true)}
                    className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium"
                  >
                    <Mail className="w-4 h-4" />
                    Contact Student
                  </button>
                )}
                
                {post.student?.slug && !isRecruiterMode && (
                  <Link 
                    to={`/portfolio/${post.student.slug}`}
                    className="text-sm text-primary hover:underline mt-2 inline-block"
                  >
                    View full portfolio →
                  </Link>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

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
        <div className="flex flex-wrap gap-3 mb-8">
          {isInternalPost && post.proof_id && post.proof_upload?.file_url ? (
            <a href={post.proof_upload.file_url} target="_blank" rel="noopener noreferrer">
              <Button className="gap-2">
                <Shield className="w-4 h-4" />
                View Project Files
              </Button>
            </a>
          ) : post.external_link ? (
            <a href={post.external_link} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" className="gap-2">
                <ExternalLink className="w-4 h-4" />
                Open Project
              </Button>
            </a>
          ) : null}
          
          {/* Share Button */}
          <Button variant="outline" onClick={handleShare} className="gap-2">
            <Share2 className="w-4 h-4" />
            Share
          </Button>
        </div>

        {/* Interactive Stats */}
        <div className="flex items-center gap-4 py-4 border-t border-b border-border/40 mb-8">
          {/* Like Button - Interactive for students, display-only for recruiters */}
          {isStudent ? (
            <button
              onClick={handleLike}
              disabled={isLiking}
              className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all ${
                isLiked 
                  ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" 
                  : "bg-muted hover:bg-muted/80 text-muted-foreground"
              }`}
            >
              <Heart className={`w-5 h-5 ${isLiked ? "fill-current" : ""}`} />
              <span className="font-medium">{localLikesCount}</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-muted text-muted-foreground">
              <Heart className="w-5 h-5" />
              <span className="font-medium">{localLikesCount}</span>
            </div>
          )}
          
          {/* Comments - Interactive for students, display-only for recruiters */}
          {isStudent ? (
            <button
              onClick={() => commentsRef.current?.scrollIntoView({ behavior: 'smooth' })}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground transition-all"
            >
              <MessageCircle className="w-5 h-5" />
              <span className="font-medium">{comments.length}</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-muted text-muted-foreground">
              <MessageCircle className="w-5 h-5" />
              <span className="font-medium">{comments.length}</span>
            </div>
          )}
          
          {/* Share Button - Always interactive */}
          <button
            onClick={handleShare}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground transition-all"
          >
            <Share2 className="w-5 h-5" />
          </button>
        </div>

        {/* Comments Section */}
        <section ref={commentsRef} className="mb-12">
          <h2 className="text-xl font-semibold text-foreground mb-6">
            Comments ({comments.length})
          </h2>

          {/* Comment Input - Only for students */}
          {isStudent ? (
            <div className="flex gap-3 mb-6">
              <Avatar className="w-10 h-10 flex-shrink-0">
                <AvatarFallback className="bg-primary/10 text-primary">
                  {currentUser?.email?.charAt(0).toUpperCase() || "U"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 flex gap-2">
                <Textarea
                  placeholder="Write a comment..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  className="min-h-[44px] max-h-[120px] resize-none rounded-xl"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleComment();
                    }
                  }}
                />
                <Button
                  onClick={handleComment}
                  disabled={!commentText.trim() || isSendingComment}
                  size="icon"
                  className="h-11 w-11 rounded-xl flex-shrink-0"
                >
                  {isSendingComment ? (
                    <div className="h-5 w-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Send className="h-5 w-5" />
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <Card className="mb-6 bg-muted/50">
              <CardContent className="p-4 text-center">
                <p className="text-muted-foreground mb-3">
                  {currentUser ? "Students can join the conversation" : "Login to join the conversation"}
                </p>
                {!currentUser && (
                  <Link to="/auth">
                    <Button variant="outline" size="sm">
                      <LogIn className="w-4 h-4 mr-2" />
                      Login to comment
                    </Button>
                  </Link>
                )}
              </CardContent>
            </Card>
          )}

          {/* Comments List */}
          {isLoadingComments ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3">
                  <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : comments.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-3">💬</div>
              <p className="text-muted-foreground">No comments yet. Be the first!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {comments.map((comment) => (
                <div key={comment.id} className="flex gap-3 py-3 border-b border-border/30 last:border-0">
                  <Avatar className="h-10 w-10 flex-shrink-0">
                    <AvatarImage src={comment.student_profiles?.profile_photo_url || undefined} />
                    <AvatarFallback className="bg-primary/10 text-primary">
                      {comment.student_profiles?.full_name?.charAt(0) || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm text-foreground">
                        {comment.student_profiles?.full_name || "Anonymous"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                      {comment.comment}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Related Posts */}
        {relatedPosts.length > 0 && (
          <section className="border-t border-border/40 pt-8">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              More from {studentName}
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {relatedPosts.map((relatedPost) => (
                <Link key={relatedPost.id} to={`/post/${relatedPost.id}`}>
                  <Card className="hover:shadow-md transition-shadow cursor-pointer h-full hover:border-primary/30">
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

      {/* Contact Student Modal */}
      {post?.student && (
        <ContactStudentModal
          open={contactModalOpen}
          onOpenChange={setContactModalOpen}
          student={{
            id: post.student.id,
            full_name: post.student.full_name,
            profile_photo_url: post.student.profile_photo_url,
            branch: post.student.branch,
            total_xp: post.student.total_xp,
            trust_score: post.student.trust_score,
            email: post.student.email,
            slug: post.student.slug,
            linkedin_url: post.student.linkedin_url,
            github_url: post.student.github_url,
            resume_url: post.student.resume_url,
          }}
          postTitle={post.title}
          onEmailClick={trackEmailClick}
          onLinkedinClick={trackLinkedinClick}
          onGithubClick={trackGithubClick}
          onResumeClick={trackResumeClick}
        />
      )}
    </div>
  );
};

export default PostPage;
