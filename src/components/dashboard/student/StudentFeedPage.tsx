import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type ProofPost = Database['public']['Tables']['proof_posts']['Row'];

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
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">ProofFeed — posts will appear here (placeholder)</h1>
      <p className="text-muted-foreground">Check console for feed data and realtime updates</p>
    </div>
  );
};

export default StudentFeedPage;
