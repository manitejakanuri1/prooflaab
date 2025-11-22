import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { FeedPostCard } from "./FeedPostCard";
import { toast } from "sonner";

type ProofPost = Database['public']['Tables']['proof_posts']['Row'];

interface FeedPostWithProfile extends ProofPost {
  student_profiles?: {
    full_name: string;
    profile_photo_url: string | null;
    branch: string | null;
  };
  user_has_liked?: boolean;
}

// Helper to format timestamp to "22h ago" format
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

// Helper to parse description into array items
const parseDescription = (description: string | null): string[] => {
  if (!description) return [];
  // Split by newlines or bullet points
  return description
    .split(/\n|•/)
    .map(item => item.trim())
    .filter(item => item.length > 0);
};

const StudentFeedPage = () => {
  const [feedPosts, setFeedPosts] = useState<FeedPostWithProfile[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    // Auth check and fetch feed
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate('/auth');
        return;
      }
      
      setCurrentUserId(session.user.id);

      // Fetch feed posts with student profiles
      const { data: posts, error } = await supabase
        .from('proof_posts')
        .select(`
          *,
          student_profiles!inner(
            full_name,
            profile_photo_url,
            branch
          )
        `)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching feed:', error);
        toast.error('Failed to load feed');
      } else {
        // Check which posts current user has liked
        const postIds = posts?.map(p => p.id) || [];
        const { data: likes } = await supabase
          .from('post_likes')
          .select('post_id')
          .eq('user_id', session.user.id)
          .in('post_id', postIds);

        const likedPostIds = new Set(likes?.map(l => l.post_id) || []);
        const postsWithLikes = posts?.map(post => ({
          ...post,
          user_has_liked: likedPostIds.has(post.id)
        })) || [];

        setFeedPosts(postsWithLikes);
      }
    };
    
    init();

    // Set up realtime subscription
    const channel = supabase.channel('feed-realtime');

    // Subscribe to new posts
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'proof_posts' },
      async (payload) => {
        const newPost = payload.new as ProofPost;
        // Fetch student profile for new post
        const { data: profile } = await supabase
          .from('student_profiles')
          .select('full_name, profile_photo_url, branch')
          .eq('id', newPost.student_id)
          .single();
        
        setFeedPosts((prev) => [{
          ...newPost,
          student_profiles: profile || undefined,
          user_has_liked: false
        }, ...prev]);
      }
    );

    // Subscribe to likes
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'post_likes' },
      (payload) => {
        const postId = (payload.new as any).post_id;
        const userId = (payload.new as any).user_id;
        setFeedPosts((prev) =>
          prev.map((post) =>
            post.id === postId
              ? { 
                  ...post, 
                  likes_count: (post.likes_count || 0) + 1,
                  user_has_liked: userId === currentUserId ? true : post.user_has_liked
                }
              : post
          )
        );
      }
    );

    channel.on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'post_likes' },
      (payload) => {
        const postId = (payload.old as any).post_id;
        const userId = (payload.old as any).user_id;
        setFeedPosts((prev) =>
          prev.map((post) =>
            post.id === postId
              ? { 
                  ...post, 
                  likes_count: Math.max((post.likes_count || 0) - 1, 0),
                  user_has_liked: userId === currentUserId ? false : post.user_has_liked
                }
              : post
          )
        );
      }
    );

    // Subscribe to comments
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'post_comments' },
      (payload) => {
        const postId = (payload.new as any).post_id;
        setFeedPosts((prev) =>
          prev.map((post) =>
            post.id === postId
              ? { ...post, comments_count: (post.comments_count || 0) + 1 }
              : post
          )
        );
      }
    );

    channel.on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'post_comments' },
      (payload) => {
        const postId = (payload.old as any).post_id;
        setFeedPosts((prev) =>
          prev.map((post) =>
            post.id === postId
              ? { ...post, comments_count: Math.max((post.comments_count || 0) - 1, 0) }
              : post
          )
        );
      }
    );

    channel.subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [navigate, currentUserId]);

  // Handle like/unlike
  const handleLike = async (postId: string, currentlyLiked: boolean) => {
    if (!currentUserId) return;

    try {
      if (currentlyLiked) {
        await supabase.rpc('unlike_post', { p_post_id: postId });
      } else {
        await supabase.rpc('like_post', { p_post_id: postId });
      }
    } catch (error) {
      console.error('Error toggling like:', error);
      toast.error('Failed to update like');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-foreground">ProofFeed</h1>
          <p className="text-muted-foreground mt-1">Discover verified work from your peers</p>
        </div>
      </div>

      {/* Feed Content */}
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="space-y-6">
          {feedPosts.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No posts yet. Be the first to share your work!</p>
            </div>
          ) : (
            feedPosts.map((post) => {
              const profile = post.student_profiles;
              const descriptionItems = parseDescription(post.description);
              
              return (
                <FeedPostCard
                  key={post.id}
                  userName={profile?.full_name || "Anonymous"}
                  userAvatarUrl={profile?.profile_photo_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${post.student_id}`}
                  isVerified={post.verified_badge || false}
                  timestamp={post.created_at ? new Date(post.created_at).toLocaleDateString() : ""}
                  title={post.title}
                  description={post.description || ""}
                  descriptionItems={descriptionItems}
                  skills={post.skills || []}
                  proofUrl={`/student/proofs/${post.proof_id}`}
                  likesCount={post.likes_count || 0}
                  commentsCount={post.comments_count || 0}
                  branch={profile?.branch || "General"}
                  timeAgo={post.created_at ? formatTimeAgo(post.created_at) : ""}
                  emojiCode={post.emoji_code}
                  tinyEmojiCode={post.emoji_code}
                  isLiked={post.user_has_liked || false}
                  onLike={() => handleLike(post.id, post.user_has_liked || false)}
                  onProofClick={() => navigate(`/student/proofs/${post.proof_id}`)}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default StudentFeedPage;
