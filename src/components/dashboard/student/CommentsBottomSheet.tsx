import { X, Send } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";

interface CommentsBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  postId: string | null;
}

export const CommentsBottomSheet = ({
  isOpen,
  onClose,
  postId,
}: CommentsBottomSheetProps) => {
  const [commentText, setCommentText] = useState("");

  // Dummy comments for UI preview
  const dummyComments = [
    {
      id: "1",
      userName: "Rahul Kumar",
      userAvatar: "",
      comment: "This is amazing! Great work on this project 🚀",
      timeAgo: "2h ago",
    },
    {
      id: "2",
      userName: "Priya Sharma",
      userAvatar: "",
      comment: "Could you share more details about the tech stack used?",
      timeAgo: "5h ago",
    },
  ];

  const handleSend = () => {
    if (!commentText.trim()) return;
    console.log("send comment:", commentText, "for post:", postId);
    setCommentText("");
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
          {dummyComments.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="text-6xl mb-4">💬</div>
              <p className="text-muted-foreground text-lg">No comments yet</p>
              <p className="text-muted-foreground text-sm mt-2">
                Be the first to comment!
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {dummyComments.map((comment) => (
                <div key={comment.id} className="flex gap-3">
                  <Avatar className="h-10 w-10 flex-shrink-0">
                    <AvatarImage src={comment.userAvatar} />
                    <AvatarFallback>
                      {comment.userName.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm text-foreground">
                        {comment.userName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {comment.timeAgo}
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
                disabled={!commentText.trim()}
                size="icon"
                className="h-11 w-11 rounded-xl flex-shrink-0"
              >
                <Send className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
