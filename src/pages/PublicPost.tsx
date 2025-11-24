import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { FeedPostCard } from "@/components/dashboard/student/FeedPostCard";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const parseDescription = (description: string | null): string[] => {
  if (!description) return [];
  return description
    .split(/\n|•/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const formatTimeAgo = (timestamp: string): string => {
  const now = new Date();
  const postTime = new Date(timestamp);
  const diffMs = now.getTime() - postTime.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d`;
  if (diffHours > 0) return `${diffHours}h`;
  if (diffMins > 0) return `${diffMins}m`;
  return "just now";
};

const PublicPost = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [post, setPost] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      if (!id) {
        navigate("/");
        return;
      }

      // Get current user if logged in
      const { data: { session } } = await supabase.auth.getSession();
      setCurrentUserId(session?.user?.id || null);

      // Fetch the post
      const { data, error } = await supabase
        .from("proof_posts")
        .select(`
          *,
          student_profiles!inner(
            full_name,
            profile_photo_url,
            branch
          )
        `)
        .eq("id", id)
        .eq("status", "active")
        .maybeSingle();

      if (error || !data) {
        console.error("Error fetching post:", error);
        toast.error("Post not found");
        navigate("/");
        return;
      }

      // Check if user has liked (only if logged in)
      if (session?.user?.id) {
        const { data: likeData } = await supabase
          .from("post_likes")
          .select("id")
          .eq("post_id", id)
          .eq("user_id", session.user.id)
          .maybeSingle();

        setPost({ ...data, user_has_liked: !!likeData });
      } else {
        setPost(data);
      }

      setLoading(false);
    };

    init();
  }, [id, navigate]);

  const handleLike = async () => {
    if (!currentUserId) {
      toast.error("Please log in to like posts");
      return;
    }

    const currentlyLiked = post.user_has_liked;

    // Optimistic update
    setPost({
      ...post,
      likes_count: currentlyLiked
        ? Math.max((post.likes_count || 0) - 1, 0)
        : (post.likes_count || 0) + 1,
      user_has_liked: !currentlyLiked,
    });

    try {
      if (currentlyLiked) {
        await supabase.rpc("unlike_post", { p_post_id: id });
      } else {
        await supabase.rpc("like_post", { p_post_id: id });
      }
    } catch (error) {
      // Revert on error
      setPost({
        ...post,
        likes_count: currentlyLiked
          ? (post.likes_count || 0) + 1
          : Math.max((post.likes_count || 0) - 1, 0),
        user_has_liked: currentlyLiked,
      });
      console.error("Error toggling like:", error);
      toast.error("Failed to update like");
    }
  };

  const handleShare = () => {
    const url = `${window.location.origin}/post/${id}`;
    navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard!");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading post...</div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Post not found</div>
      </div>
    );
  }

  const profile = post.student_profiles;
  const descriptionItems = parseDescription(post.description);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <Button
            variant="ghost"
            onClick={() => navigate(-1)}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </div>
      </div>

      {/* Post Content */}
      <div className="max-w-3xl mx-auto px-4 py-8">
        <FeedPostCard
          userName={profile?.full_name || "Anonymous"}
          userAvatarUrl={
            profile?.profile_photo_url ||
            `https://api.dicebear.com/7.x/avataaars/svg?seed=${post.student_id}`
          }
          isVerified={post.verified_badge || false}
          timestamp={
            post.created_at ? new Date(post.created_at).toLocaleDateString() : ""
          }
          title={post.title}
          description={post.description || ""}
          descriptionItems={descriptionItems}
          skills={post.skills || []}
          proofUrl={`/student/proof/${post.proof_id}`}
          likesCount={post.likes_count || 0}
          commentsCount={post.comments_count || 0}
          branch={profile?.branch || "General"}
          timeAgo={post.created_at ? formatTimeAgo(post.created_at) : ""}
          emojiCode={post.emoji_code}
          tinyEmojiCode={post.emoji_code}
          isLiked={post.user_has_liked || false}
          onLike={handleLike}
          externalLink={post.external_link}
          proofId={post.proof_id}
          postId={post.id}
          onShare={handleShare}
          isOwnPost={false}
        />
      </div>
    </div>
  );
};

export default PublicPost;
