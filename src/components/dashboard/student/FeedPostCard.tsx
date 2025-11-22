import { Heart, MessageCircle, MoreVertical, ShieldCheck } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface FeedPostCardProps {
  userName: string;
  userAvatarUrl?: string;
  isVerified?: boolean;
  timestamp: string;
  title: string;
  description: string;
  descriptionItems?: string[];
  skills: string[];
  proofUrl: string;
  likesCount: number;
  commentsCount: number;
  branch: string;
  timeAgo: string;
  emojiCode: string;
  tinyEmojiCode?: string;
}

export const FeedPostCard = ({
  userName,
  userAvatarUrl,
  isVerified = false,
  timestamp,
  title,
  description,
  descriptionItems = [],
  skills,
  proofUrl,
  likesCount,
  commentsCount,
  branch,
  timeAgo,
  emojiCode,
  tinyEmojiCode,
}: FeedPostCardProps) => {
  // Convert emoji code to actual emoji
  const getEmoji = (code: string) => {
    return String.fromCodePoint(parseInt(code, 16));
  };

  return (
    <article className="relative bg-card border border-border rounded-2xl p-6 pb-20 shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-12 w-12">
            <AvatarImage src={userAvatarUrl} alt={userName} />
            <AvatarFallback>{userName.charAt(0)}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">{userName}</span>
              {isVerified && (
                <ShieldCheck className="h-4 w-4 text-primary" fill="currentColor" />
              )}
              <span className="text-muted-foreground text-sm">• You</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Co-founder | Helping Engineering Students</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{timestamp}</span>
              <span>•</span>
              <span>🌐</span>
            </div>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreVertical className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Edit</DropdownMenuItem>
            <DropdownMenuItem>Delete</DropdownMenuItem>
            <DropdownMenuItem>Share</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Main Content Card */}
      <div className="relative bg-background border border-border rounded-xl p-6 mb-4">
        {/* Large Emoji Icon */}
        <div className="absolute -top-4 -left-4 bg-primary/10 rounded-xl p-3 shadow-md">
          <span className="text-4xl">{getEmoji(emojiCode)}</span>
        </div>

        {/* Title */}
        <div className="mt-8">
          <h2 className="text-3xl font-bold text-foreground mb-6">{title}</h2>

          {/* Description Section */}
          <div className="mb-6">
            <h3 className="text-xl font-semibold mb-3 text-foreground">
              What is my project?
            </h3>
            <ul className="space-y-2">
              {descriptionItems.map((item, index) => (
                <li key={index} className="flex items-start gap-2 text-muted-foreground">
                  <span className="mt-1">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Tools Used Section */}
          <div className="mb-6">
            <h3 className="text-xl font-semibold mb-3 text-foreground">Tools used</h3>
            <div className="flex flex-wrap gap-2">
              {skills.map((skill, index) => (
                <Badge
                  key={index}
                  variant="secondary"
                  className="rounded-full px-4 py-1.5 text-sm"
                >
                  ⭐ {skill}
                </Badge>
              ))}
            </div>
          </div>

          {/* View Project Link */}
          <a
            href={proofUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-orange-500 hover:text-orange-600 font-medium inline-flex items-center gap-1 text-lg"
          >
            View My Project
          </a>
        </div>

        {/* Tiny Emoji Bottom Right - Notion Style Floating */}
        {tinyEmojiCode && (
          <div 
            className="absolute bottom-4 right-4"
            style={{
              animation: 'floatEmoji 3s ease-in-out infinite'
            }}
          >
            <style>{`
              @keyframes floatEmoji {
                0% { transform: translateY(0px); }
                50% { transform: translateY(-6px); }
                100% { transform: translateY(0px); }
              }
            `}</style>
            <div className="flex items-center justify-center w-20 h-20 rounded-full shadow-lg" style={{ 
              backgroundColor: '#FFF7EE',
              boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.08)'
            }}>
              <span className="text-5xl leading-none">{getEmoji(tinyEmojiCode)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-sm text-muted-foreground px-2">
        <div className="flex items-center gap-4">
          <button className="flex items-center gap-2 hover:text-primary transition-colors">
            <Heart className="h-5 w-5" />
            <span>{likesCount}</span>
          </button>
          <button className="flex items-center gap-2 hover:text-primary transition-colors">
            <MessageCircle className="h-5 w-5" />
            <span>{commentsCount}</span>
          </button>
          <Badge variant="outline" className="rounded-full">
            {branch}
          </Badge>
        </div>
        <span className="text-muted-foreground">{timeAgo}</span>
      </div>
    </article>
  );
};
