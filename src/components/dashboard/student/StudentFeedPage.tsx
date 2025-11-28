import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { FeedPostCard } from "./FeedPostCard";
import { CommentsBottomSheet } from "./CommentsBottomSheet";
import { SharePostModal } from "./SharePostModal";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import PostTypeSelectorModal from "./PostTypeSelectorModal";
import VerifiedProofSelectorModal from "./VerifiedProofSelectorModal";
import ExternalProjectPostModal from "./ExternalProjectPostModal";
import VerifiedPostComposerModal from "./VerifiedPostComposerModal";
import SuggestedStudents from "@/components/feed/SuggestedStudents";
import OnboardingFollowSuggestions from "@/components/feed/OnboardingFollowSuggestions";

type ProofPost = Database['public']['Tables']['proof_posts']['Row'];

interface FeedPostWithProfile extends ProofPost {
  student_profiles?: {
    full_name: string;
    profile_photo_url: string | null;
    branch: string | null;
    college_id: string | null;
  };
  user_has_liked?: boolean;
  priority?: number; // 1 = followed, 2 = same college, 3 = other
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
  const [currentStudentId, setCurrentStudentId] = useState<string | null>(null);
  const [currentCollegeId, setCurrentCollegeId] = useState<string | null>(null);
  const [userFollowingIds, setUserFollowingIds] = useState<Set<string>>(new Set());
  const [openCommentsPostId, setOpenCommentsPostId] = useState<string | null>(null);
  const [isPostTypeModalOpen, setPostTypeModalOpen] = useState(false);
  const [isVerifiedProofModalOpen, setVerifiedProofModalOpen] = useState(false);
  const [isExternalProjectModalOpen, setExternalProjectModalOpen] = useState(false);
  const [isVerifiedPostComposerOpen, setVerifiedPostComposerOpen] = useState(false);
  const [selectedProofId, setSelectedProofId] = useState<string>("");
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [sharePost, setSharePost] = useState<FeedPostWithProfile | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const navigate = useNavigate();

  // Helper function to add priority and sort posts
  const sortPostsByPriority = (posts: FeedPostWithProfile[]): FeedPostWithProfile[] => {
    return posts.map(post => {
      let priority = 3; // Default: other posts
      
      // Priority 1: Posts from followed users
      if (userFollowingIds.has(post.student_id)) {
        priority = 1;
      }
      // Priority 2: Posts from same college
      else if (currentCollegeId && post.student_profiles?.college_id === currentCollegeId) {
        priority = 2;
      }
      
      return { ...post, priority };
    }).sort((a, b) => {
      // Sort by priority first (ASC), then by created_at (DESC)
      if (a.priority !== b.priority) {
        return (a.priority || 3) - (b.priority || 3);
      }
      // If same priority, sort by created_at DESC
      const dateA = new Date(a.created_at || 0).getTime();
      const dateB = new Date(b.created_at || 0).getTime();
      return dateB - dateA;
    });
  };

  useEffect(() => {
    // Auth check and fetch feed
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate('/auth');
        return;
      }
      
      setCurrentUserId(session.user.id);

      // Fetch current student profile ID and college_id
      const { data: studentProfile } = await supabase
        .from('student_profiles')
        .select('id, college_id')
        .eq('user_id', session.user.id)
        .single();
      
      if (studentProfile) {
        setCurrentStudentId(studentProfile.id);
        setCurrentCollegeId(studentProfile.college_id);
      }

      // Fetch list of users current student follows
      const { data: followingData } = await supabase
        .from('user_follows')
        .select('following_id')
        .eq('follower_id', session.user.id);
      
      const followingIds = new Set(followingData?.map(f => f.following_id) || []);
      setUserFollowingIds(followingIds);

      // Check if onboarding should be shown
      const onboardingCompleted = localStorage.getItem('follow_onboarding_completed');
      if (!onboardingCompleted && followingIds.size === 0) {
        setShowOnboarding(true);
      }

      // Fetch feed posts with student profiles including college_id
      const { data: posts, error } = await supabase
        .from('proof_posts')
        .select(`
          *,
          student_profiles!inner(
            full_name,
            profile_photo_url,
            branch,
            college_id
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

        // Apply priority sorting
        const sortedPosts = sortPostsByPriority(postsWithLikes);
        setFeedPosts(sortedPosts);
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
          .select('full_name, profile_photo_url, branch, college_id')
          .eq('id', newPost.student_id)
          .single();
        
        const postWithProfile = {
          ...newPost,
          student_profiles: profile || undefined,
          user_has_liked: false
        };
        
        setFeedPosts((prev) => sortPostsByPriority([postWithProfile, ...prev]));
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

    // Subscribe to follow changes to update feed priorities
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'user_follows' },
      (payload) => {
        const followingId = (payload.new as any).following_id;
        const followerId = (payload.new as any).follower_id;
        
        // If current user followed someone, update following list and re-sort
        if (followerId === currentUserId) {
          setUserFollowingIds(prev => {
            const newSet = new Set(prev);
            newSet.add(followingId);
            return newSet;
          });
          // Re-sort feed with new priorities
          setFeedPosts(prev => sortPostsByPriority(prev));
        }
      }
    );

    channel.on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'user_follows' },
      (payload) => {
        const followingId = (payload.old as any).following_id;
        const followerId = (payload.old as any).follower_id;
        
        // If current user unfollowed someone, update following list and re-sort
        if (followerId === currentUserId) {
          setUserFollowingIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(followingId);
            return newSet;
          });
          // Re-sort feed with new priorities
          setFeedPosts(prev => sortPostsByPriority(prev));
        }
      }
    );

    channel.subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [navigate, currentUserId]);

  // Handle share
  const handleShare = async (post: FeedPostWithProfile) => {
    // For internal proofs, fetch the actual is_public status from proof_uploads
    if (post.proof_id) {
      const { data: proof } = await supabase
        .from('proof_uploads')
        .select('is_public')
        .eq('id', post.proof_id)
        .single();
      
      // Update the post with actual is_public status
      setSharePost({
        ...post,
        // Store is_public in a custom property for the modal
        _is_public: proof?.is_public ?? false
      } as any);
    } else {
      setSharePost(post);
    }
    setShareModalOpen(true);
  };

  // Handle edit
  const handleEdit = (post: FeedPostWithProfile) => {
    // TODO: Implement edit functionality
    toast.info("Edit functionality coming soon");
  };

  // Handle delete
  const handleDelete = async (postId: string) => {
    if (!confirm("Are you sure you want to delete this post?")) return;
    
    try {
      const { error } = await supabase
        .from('proof_posts')
        .delete()
        .eq('id', postId);

      if (error) throw error;

      setFeedPosts((prev) => prev.filter((p) => p.id !== postId));
      toast.success("Post deleted successfully");
    } catch (error) {
      console.error('Error deleting post:', error);
      toast.error("Failed to delete post");
    }
  };

  // Handle like/unlike with optimistic updates
  const handleLike = async (postId: string, currentlyLiked: boolean) => {
    if (!currentUserId) return;

    // Optimistic update
    setFeedPosts((prev) =>
      prev.map((post) =>
        post.id === postId
          ? {
              ...post,
              likes_count: currentlyLiked
                ? Math.max((post.likes_count || 0) - 1, 0)
                : (post.likes_count || 0) + 1,
              user_has_liked: !currentlyLiked,
            }
          : post
      )
    );

    try {
      if (currentlyLiked) {
        await supabase.rpc('unlike_post', { p_post_id: postId });
      } else {
        await supabase.rpc('like_post', { p_post_id: postId });
      }
    } catch (error) {
      // Revert optimistic update on error
      setFeedPosts((prev) =>
        prev.map((post) =>
          post.id === postId
            ? {
                ...post,
                likes_count: currentlyLiked
                  ? (post.likes_count || 0) + 1
                  : Math.max((post.likes_count || 0) - 1, 0),
                user_has_liked: currentlyLiked,
              }
            : post
        )
      );
      console.error('Error toggling like:', error);
      toast.error('Failed to update like');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-foreground">ProofFeed</h1>
          <p className="text-muted-foreground mt-1">Discover verified work from your peers</p>
        </div>
      </div>

      {/* Main Layout with Sidebar */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex gap-6">
          {/* Feed Content - Main Column */}
          <div className="flex-1 max-w-3xl">
            <div className="space-y-6">
              {feedPosts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="bg-card rounded-2xl border border-border p-12 shadow-lg max-w-md text-center">
                    <div className="text-6xl mb-4 animate-[wobbleFloat_4s_ease-in-out_infinite]">
                      🎨
                    </div>
                    <h3 className="text-2xl font-bold text-foreground mb-2">
                      No posts yet
                    </h3>
                    <p className="text-muted-foreground mb-6">
                      Be the first to share your work and inspire others!
                    </p>
                    <button
                      onClick={() => setPostTypeModalOpen(true)}
                      className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium"
                    >
                      Share your first proof
                    </button>
                  </div>
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
                      proofUrl={`/student/proof/${post.proof_id}`}
                      postId={post.id}
                      likesCount={post.likes_count || 0}
                      commentsCount={post.comments_count || 0}
                      branch={profile?.branch || "General"}
                      timeAgo={post.created_at ? formatTimeAgo(post.created_at) : ""}
                      emojiCode={post.emoji_code}
                      tinyEmojiCode={post.emoji_code}
                      isLiked={post.user_has_liked || false}
                      onLike={() => handleLike(post.id, post.user_has_liked || false)}
                      onCommentClick={() => setOpenCommentsPostId(post.id)}
                      onProofClick={() => navigate(`/student/proof/${post.proof_id}`)}
                      externalLink={post.external_link}
                      proofId={post.proof_id}
                      studentId={post.student_id}
                      currentStudentId={currentStudentId || undefined}
                      isPublic={post.visibility === 'public'}
                      onEdit={() => handleEdit(post)}
                      onDelete={() => handleDelete(post.id)}
                    />
                  );
                })
              )}
            </div>
          </div>

          {/* Right Sidebar - Suggested Students (Desktop Only) */}
          <aside className="hidden lg:block w-80 flex-shrink-0">
            <div className="sticky top-[100px] max-h-[calc(100vh-120px)] overflow-y-auto">
              <div className="bg-card/30 backdrop-blur-sm rounded-xl border border-border/50 p-6 shadow-sm">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-foreground">Suggested Students</h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    Connect with peers building great projects
                  </p>
                </div>
                <SuggestedStudents />
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Floating Action Button */}
      <button
        onClick={() => setPostTypeModalOpen(true)}
        className="fixed bottom-8 right-8 w-14 h-14 bg-primary rounded-full shadow-lg hover:scale-105 transition-transform duration-200 flex items-center justify-center z-50"
        style={{
          boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.12)',
        }}
        aria-label="Create post"
      >
        <Plus className="w-6 h-6 text-white" strokeWidth={2.5} />
      </button>

      {/* Post Type Selector Modal */}
      <PostTypeSelectorModal
        open={isPostTypeModalOpen}
        onOpenChange={setPostTypeModalOpen}
        onSelectVerified={() => {
          setVerifiedProofModalOpen(true);
        }}
        onSelectExternal={() => {
          setExternalProjectModalOpen(true);
        }}
      />

      {/* Verified Proof Selector Modal */}
      <VerifiedProofSelectorModal
        isOpen={isVerifiedProofModalOpen}
        onClose={() => setVerifiedProofModalOpen(false)}
        onSelectProof={(proofId) => {
          setSelectedProofId(proofId);
          setVerifiedPostComposerOpen(true);
        }}
      />

      {/* Verified Post Composer Modal */}
      <VerifiedPostComposerModal
        isOpen={isVerifiedPostComposerOpen}
        onClose={() => {
          setVerifiedPostComposerOpen(false);
          setSelectedProofId("");
        }}
        proofId={selectedProofId}
        onPostSuccess={() => {
          toast.success("Post will appear in the feed shortly");
        }}
      />

      {/* External Project Post Modal */}
      <ExternalProjectPostModal
        isOpen={isExternalProjectModalOpen}
        onClose={() => setExternalProjectModalOpen(false)}
        onPostSuccess={() => {
          toast.success("Post will appear in the feed shortly");
        }}
      />

      {/* Comments Bottom Sheet */}
      <CommentsBottomSheet
        isOpen={!!openCommentsPostId}
        onClose={() => setOpenCommentsPostId(null)}
        postId={openCommentsPostId}
      />

      {/* Share Post Modal */}
      {sharePost && (
        <SharePostModal
          isOpen={shareModalOpen}
          onClose={() => {
            setShareModalOpen(false);
            setSharePost(null);
          }}
          postId={sharePost.id}
          title={sharePost.title}
          emojiCode={sharePost.emoji_code}
          isInternal={sharePost.proof_id !== null}
          isPublic={(sharePost as any)._is_public ?? (sharePost.visibility === 'public')}
          isOwner={sharePost.student_id === currentStudentId}
          proofId={sharePost.proof_id}
          externalLink={sharePost.external_link}
        />
      )}

      {/* Onboarding Follow Suggestions Modal */}
      <OnboardingFollowSuggestions
        open={showOnboarding}
        onComplete={() => {
          setShowOnboarding(false);
          // Refresh following list after onboarding
          supabase
            .from('user_follows')
            .select('following_id')
            .eq('follower_id', currentUserId)
            .then(({ data }) => {
              const followingIds = new Set(data?.map(f => f.following_id) || []);
              setUserFollowingIds(followingIds);
              // Re-sort feed with new following list
              setFeedPosts(prev => sortPostsByPriority(prev));
            });
        }}
      />
    </div>
  );
};

// Step 7C complete — SuggestedStudents integrated into Feed sidebar
// Step 7E complete — Follow Onboarding Modal implemented

export default StudentFeedPage;
