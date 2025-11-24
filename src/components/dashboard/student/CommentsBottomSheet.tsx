import { X, Send } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface CommentsBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  postId: string | null;
}

interface Comment {
  id: string;
  comment: string;
  created_at: string;
  user_id: string;
  post_id: string;
  student_profiles?: {
    full_name: string;
    profile_photo_url: string | null;
  };
}

export const CommentsBottomSheet = ({
  isOpen,
  onClose,
  postId,
}: CommentsBottomSheetProps) => {
  const [commentText, setCommentText] = useState("");
  const [comments, setComments] = useState<Comment[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);

  // Fetch current user
  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);
    };
    fetchUser();
  }, []);

  // Fetch comments and setup realtime
  useEffect(() => {
    if (!postId || !isOpen) return;

    const fetchComments = async () => {
      setIsLoading(true);
      
      // Fetch comments
      const { data: commentsData, error: commentsError } = await supabase
        .from("post_comments")
        .select("*")
        .eq("post_id", postId)
        .order("created_at", { ascending: true });

      if (commentsError) {
        console.error("Error fetching comments:", commentsError);
        toast.error("Failed to load comments");
        setIsLoading(false);
        return;
      }

      // Fetch student profiles for all comment user_ids
      const userIds = commentsData?.map((c) => c.user_id) || [];
      if (userIds.length === 0) {
        setComments([]);
        setIsLoading(false);
        return;
      }

      const { data: profilesData, error: profilesError } = await supabase
        .from("student_profiles")
        .select("user_id, full_name, profile_photo_url")
        .in("user_id", userIds);

      if (profilesError) {
        console.error("Error fetching profiles:", profilesError);
      }

      // Join comments with profiles
      const profilesMap = new Map(
        profilesData?.map((p) => [p.user_id, p]) || []
      );

      const commentsWithProfiles = commentsData?.map((comment) => ({
        ...comment,
        student_profiles: profilesMap.get(comment.user_id),
      })) || [];

      setComments(commentsWithProfiles);
      setIsLoading(false);
    };

    fetchComments();

    // Setup realtime subscription
    const channel = supabase
      .channel(`comments-${postId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "post_comments",
          filter: `post_id=eq.${postId}`,
        },
        async (payload) => {
          // Fetch the student profile for the new comment
          const { data: profile } = await supabase
            .from("student_profiles")
            .select("user_id, full_name, profile_photo_url")
            .eq("user_id", (payload.new as any).user_id)
            .single();

          const newComment = {
            ...(payload.new as Comment),
            student_profiles: profile || undefined,
          };

          setComments((prev) => [...prev, newComment]);
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [postId, isOpen]);

  const handleSend = async () => {
    if (!commentText.trim() || !postId || !currentUser) return;

    setIsSending(true);
    try {
      // Insert comment
      const { data: newComment, error: insertError } = await supabase
        .from("post_comments")
        .insert({
          post_id: postId,
          user_id: currentUser.id,
          comment: commentText.trim(),
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Fetch student profile for the new comment
      const { data: profile } = await supabase
        .from("student_profiles")
        .select("user_id, full_name, profile_photo_url")
        .eq("user_id", currentUser.id)
        .single();

      // Optimistically add comment to local state
      if (newComment) {
        const commentWithProfile = {
          ...newComment,
          student_profiles: profile || undefined,
        };
        setComments((prev) => [...prev, commentWithProfile]);
      }

      setCommentText("");
      toast.success("Comment posted!");
    } catch (error) {
      console.error("Error posting comment:", error);
      toast.error("Failed to post comment");
    } finally {
      setIsSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 animate-fade-in"
        onClick={onClose}
      />

      {/* Bottom Sheet */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 bg-background rounded-t-3xl shadow-2xl animate-slide-in-bottom"
        style={{
          height: "75vh",
          animation: "slideUp 0.3s ease-out",
        }}
      >
        <style>{`
          @keyframes slideUp {
            from {
              transform: translateY(100%);
            }
            to {
              transform: translateY(0);
            }
          }
        `}</style>

        {/* Drag Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-12 h-1.5 bg-muted-foreground/30 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-xl font-semibold text-foreground">Comments</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Comments List - Scrollable */}
        <div
          className="overflow-y-auto px-6 py-4"
          style={{ height: "calc(75vh - 180px)" }}
        >
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-muted-foreground">Loading comments...</div>
            </div>
          ) : comments.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-6xl mb-4">💬</div>
              <p className="text-muted-foreground text-lg">No comments yet</p>
              <p className="text-muted-foreground text-sm mt-2">
                Be the first to comment!
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {comments.map((comment) => (
                <div key={comment.id} className="flex gap-3">
                  <Avatar className="h-10 w-10 flex-shrink-0">
                    <AvatarImage 
                      src={comment.student_profiles?.profile_photo_url || undefined}
                    />
                    <AvatarFallback>
                      {comment.student_profiles?.full_name?.charAt(0) || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm text-foreground">
                        {comment.student_profiles?.full_name || "Anonymous"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(comment.created_at), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-foreground leading-relaxed">
                      {comment.comment}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Fixed Bottom Input Area */}
        <div className="absolute bottom-0 left-0 right-0 border-t border-border bg-background p-4">
          <div className="flex gap-3 items-end">
            <Avatar className="h-10 w-10 flex-shrink-0">
              <AvatarFallback>U</AvatarFallback>
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
                    handleSend();
                  }
                }}
              />
              <Button
                onClick={handleSend}
                disabled={!commentText.trim() || isSending}
                size="icon"
                className="h-11 w-11 rounded-xl flex-shrink-0"
              >
                {isSending ? (
                  <div className="h-5 w-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Send className="h-5 w-5" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
