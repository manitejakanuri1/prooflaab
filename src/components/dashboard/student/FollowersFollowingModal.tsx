import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { FollowButton } from "./FollowButton";
import { Users } from "lucide-react";

interface FollowUser {
  id: string;
  full_name: string;
  profile_photo_url: string | null;
  email: string;
}

interface FollowersFollowingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  currentUserId?: string;
  defaultTab?: "followers" | "following";
}

export const FollowersFollowingModal = ({
  open,
  onOpenChange,
  userId,
  currentUserId,
  defaultTab = "followers",
}: FollowersFollowingModalProps) => {
  const [followers, setFollowers] = useState<FollowUser[]>([]);
  const [following, setFollowing] = useState<FollowUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;

    const fetchFollowData = async () => {
      setLoading(true);
      try {
        // Fetch followers
        const { data: followersData, error: followersError } = await supabase
          .from('follows')
          .select('follower_id')
          .eq('following_id', userId);

        if (followersError) throw followersError;

        const followerIds = followersData.map(f => f.follower_id);

        if (followerIds.length > 0) {
          const { data: followerProfiles, error: followerProfilesError } = await supabase
            .from('student_profiles')
            .select('id, full_name, profile_photo_url, email')
            .in('id', followerIds);

          if (followerProfilesError) throw followerProfilesError;
          setFollowers(followerProfiles || []);
        } else {
          setFollowers([]);
        }

        // Fetch following
        const { data: followingData, error: followingError } = await supabase
          .from('follows')
          .select('following_id')
          .eq('follower_id', userId);

        if (followingError) throw followingError;

        const followingIds = followingData.map(f => f.following_id);

        if (followingIds.length > 0) {
          const { data: followingProfiles, error: followingProfilesError } = await supabase
            .from('student_profiles')
            .select('id, full_name, profile_photo_url, email')
            .in('id', followingIds);

          if (followingProfilesError) throw followingProfilesError;
          setFollowing(followingProfiles || []);
        } else {
          setFollowing([]);
        }
      } catch (error) {
        console.error('Error fetching follow data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchFollowData();
  }, [open, userId]);

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const renderUserList = (users: FollowUser[]) => {
    if (loading) {
      return (
        <div className="space-y-4 p-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 animate-pulse">
              <div className="h-12 w-12 rounded-full bg-muted"></div>
              <div className="flex-1 space-y-2">
                <div className="h-4 w-32 bg-muted rounded"></div>
                <div className="h-3 w-48 bg-muted rounded"></div>
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (users.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Users className="h-12 w-12 text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground">No users yet</p>
        </div>
      );
    }

    return (
      <div className="space-y-2 p-2">
        {users.map((user) => (
          <div
            key={user.id}
            className="flex items-center justify-between p-3 rounded-lg hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <Avatar className="h-12 w-12 flex-shrink-0">
                <AvatarImage src={user.profile_photo_url || ""} alt={user.full_name} />
                <AvatarFallback className="bg-primary/10 text-primary">
                  {getInitials(user.full_name)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate">{user.full_name}</p>
                <p className="text-sm text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>
            <div className="flex-shrink-0">
              <FollowButton
                targetUserId={user.id}
                currentUserId={currentUserId}
                size="sm"
                variant="profile"
              />
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] p-0">
        <DialogHeader className="p-6 pb-3">
          <DialogTitle className="text-xl font-bold">Connections</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue={defaultTab} className="w-full">
          <TabsList className="w-full grid grid-cols-2 mx-6" style={{ width: 'calc(100% - 3rem)' }}>
            <TabsTrigger value="followers">
              Followers {followers.length > 0 && `(${followers.length})`}
            </TabsTrigger>
            <TabsTrigger value="following">
              Following {following.length > 0 && `(${following.length})`}
            </TabsTrigger>
          </TabsList>
          <ScrollArea className="h-[400px] mt-2">
            <TabsContent value="followers" className="m-0">
              {renderUserList(followers)}
            </TabsContent>
            <TabsContent value="following" className="m-0">
              {renderUserList(following)}
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
