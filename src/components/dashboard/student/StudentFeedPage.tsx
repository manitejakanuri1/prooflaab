import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const StudentFeedPage = () => {
  useEffect(() => {
    const fetchFeed = async () => {
      const { data, error } = await supabase.rpc('get_feed_posts');
      if (error) {
        console.error('Error fetching feed:', error);
      } else {
        console.log('Feed posts:', data);
      }
    };
    
    fetchFeed();
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">ProofFeed — posts will appear here (placeholder)</h1>
    </div>
  );
};

export default StudentFeedPage;
