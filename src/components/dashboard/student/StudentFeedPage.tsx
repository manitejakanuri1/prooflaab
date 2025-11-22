import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { FeedPostCard } from "./FeedPostCard";

type ProofPost = Database['public']['Tables']['proof_posts']['Row'];

// Mock data for visual preview
const mockPosts = [
  {
    id: "mock-1",
    userName: "Mohan Padavala",
    userAvatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Mohan",
    isVerified: true,
    timestamp: "22h",
    title: "Bug Tracking Dashboard",
    description: "A comprehensive bug tracking system",
    descriptionItems: [
      "Log new bugs directly below or paste links to messages, issues, or emails",
      "Keep Status and Priority up to date",
      "Link related specs and owners"
    ],
    skills: ["All Bugs", "By Status", "Target Fix", "My Bugs"],
    proofUrl: "#",
    likesCount: 56,
    commentsCount: 12,
    branch: "CSE",
    timeAgo: "2 days ago",
    emojiCode: "1f41b", // bug emoji
    tinyEmojiCode: "1f986", // duck emoji
  },
  {
    id: "mock-2",
    userName: "Sarah Johnson",
    userAvatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah",
    isVerified: true,
    timestamp: "1d",
    title: "E-Commerce Mobile App",
    description: "Full-stack shopping experience",
    descriptionItems: [
      "Built with React Native and Node.js backend",
      "Integrated payment gateway and cart system",
      "Real-time order tracking and notifications"
    ],
    skills: ["React Native", "Node.js", "MongoDB", "Stripe"],
    proofUrl: "#",
    likesCount: 89,
    commentsCount: 24,
    branch: "IT",
    timeAgo: "1 day ago",
    emojiCode: "1f6d2", // shopping cart
    tinyEmojiCode: "1f680", // rocket
  }
];

const StudentFeedPage = () => {
  const [feedPosts, setFeedPosts] = useState<ProofPost[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    // Auth check
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate('/auth');
        return;
      }
    };
    checkAuth();

    // Fetch initial feed posts
    const fetchFeed = async () => {
      const { data, error } = await supabase.rpc('get_feed_posts');
      if (error) {
        console.error('Error fetching feed:', error);
      } else {
        console.log('Initial feed posts:', data);
        setFeedPosts(data || []);
      }
    };
    
    fetchFeed();

    // Set up realtime subscription
    const channel = supabase.channel('feed-realtime');

    // Subscribe to new posts
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'proof_posts' },
      (payload) => {
        console.log('New post inserted:', payload.new);
        setFeedPosts((prev) => [payload.new as ProofPost, ...prev]);
      }
    );

    // Subscribe to likes
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'post_likes' },
      (payload) => {
        console.log('Like added:', payload);
        const postId = (payload.new as any).post_id;
        setFeedPosts((prev) =>
          prev.map((post) =>
            post.id === postId
              ? { ...post, likes_count: (post.likes_count || 0) + 1 }
              : post
          )
        );
      }
    );

    channel.on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'post_likes' },
      (payload) => {
        console.log('Like removed:', payload);
        const postId = (payload.old as any).post_id;
        setFeedPosts((prev) =>
          prev.map((post) =>
            post.id === postId
              ? { ...post, likes_count: Math.max((post.likes_count || 0) - 1, 0) }
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
        console.log('Comment added:', payload);
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
        console.log('Comment removed:', payload);
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

    // Subscribe to the channel
    channel.subscribe((status) => {
      console.log('Realtime subscription status:', status);
    });

    // Cleanup on unmount
    return () => {
      console.log('Unsubscribing from feed realtime');
      channel.unsubscribe();
    };
  }, [navigate]);

  // Log feedPosts whenever it updates
  useEffect(() => {
    console.log('Updated feedPosts:', feedPosts);
  }, [feedPosts]);

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
          {/* Mock Posts for Visual Preview */}
          {mockPosts.map((post) => (
            <FeedPostCard
              key={post.id}
              userName={post.userName}
              userAvatarUrl={post.userAvatarUrl}
              isVerified={post.isVerified}
              timestamp={post.timestamp}
              title={post.title}
              description={post.description}
              descriptionItems={post.descriptionItems}
              skills={post.skills}
              proofUrl={post.proofUrl}
              likesCount={post.likesCount}
              commentsCount={post.commentsCount}
              branch={post.branch}
              timeAgo={post.timeAgo}
              emojiCode={post.emojiCode}
              tinyEmojiCode={post.tinyEmojiCode}
            />
          ))}

          {/* Real Posts (when data is available) */}
          {feedPosts.length > 0 && (
            <div className="mt-8 pt-8 border-t border-border">
              <h2 className="text-xl font-semibold mb-4 text-muted-foreground">
                Live Feed (Real Data)
              </h2>
              <div className="space-y-6">
                {feedPosts.map((post) => (
                  <div key={post.id} className="bg-muted/30 p-4 rounded-lg">
                    <pre className="text-xs overflow-auto">
                      {JSON.stringify(post, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StudentFeedPage;
