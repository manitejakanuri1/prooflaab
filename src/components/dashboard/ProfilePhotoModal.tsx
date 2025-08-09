import { useState, useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { X, Camera, Edit3, Image, Trash2 } from "lucide-react";

interface ProfilePhotoModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPhotoUrl?: string | null;
  userName: string;
  userId: string;
  onPhotoUpdate: (newUrl: string | null) => void;
}

const ProfilePhotoModal = ({ 
  isOpen, 
  onClose, 
  currentPhotoUrl, 
  userName, 
  userId,
  onPhotoUpdate 
}: ProfilePhotoModalProps) => {
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file type",
        description: "Please select an image file.",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (2MB max)
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please select an image smaller than 2MB.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      // Get current user to find student profile
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Upload to Supabase storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/${Math.random()}.${fileExt}`;

      // Upload file to Supabase storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('profile-photos')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      // Get the public URL
      const { data: { publicUrl } } = supabase.storage
        .from('profile-photos')
        .getPublicUrl(fileName);
      
      // Update the profile in the database using user_id to find the profile
      const { error } = await supabase
        .from('student_profiles')
        .update({ profile_photo_url: publicUrl })
        .eq('user_id', user.id);

      if (error) throw error;

      onPhotoUpdate(publicUrl);
      
      toast({
        title: "Photo updated successfully",
        description: "Your profile photo has been changed.",
      });
    } catch (error) {
      console.error('Error uploading photo:', error);
      toast({
        title: "Error uploading photo",
        description: "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDeletePhoto = async () => {
    setDeleting(true);
    try {
      // Get current user to find student profile
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('student_profiles')
        .update({ profile_photo_url: null })
        .eq('user_id', user.id);

      if (error) throw error;

      onPhotoUpdate(null);
      
      toast({
        title: "Photo removed successfully",
        description: "Your profile photo has been removed.",
      });
    } catch (error) {
      console.error('Error deleting photo:', error);
      toast({
        title: "Error removing photo",
        description: "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-md p-0 bg-background border-0 overflow-hidden">
          <div className="relative bg-background">
            {/* Header with close button */}
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-semibold">Profile photo</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="rounded-full h-8 w-8"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Main photo display */}
            <div className="flex justify-center items-center py-8 px-4 bg-muted/20">
              <Avatar className="h-48 w-48 border-4 border-background shadow-lg">
                <AvatarImage 
                  src={currentPhotoUrl || undefined} 
                  alt={userName}
                  className="object-cover"
                />
                <AvatarFallback className="bg-primary/10 text-primary text-4xl font-medium">
                  {getInitials(userName)}
                </AvatarFallback>
              </Avatar>
            </div>

            {/* Action buttons */}
            <div className="flex justify-around items-center p-4 border-t bg-background">
              <Button
                variant="ghost"
                className="flex flex-col items-center gap-2 h-auto py-3 px-4 text-muted-foreground hover:text-foreground"
                onClick={triggerFileInput}
                disabled={uploading}
              >
                <Edit3 className="h-5 w-5" />
                <span className="text-xs">Edit</span>
              </Button>

              <Button
                variant="ghost"
                className="flex flex-col items-center gap-2 h-auto py-3 px-4 text-muted-foreground hover:text-foreground"
                onClick={triggerFileInput}
                disabled={uploading}
              >
                <Camera className="h-5 w-5" />
                <span className="text-xs">
                  {uploading ? "Uploading..." : "Add photo"}
                </span>
              </Button>

              <Button
                variant="ghost"
                className="flex flex-col items-center gap-2 h-auto py-3 px-4 text-muted-foreground hover:text-foreground"
                disabled
              >
                <Image className="h-5 w-5" />
                <span className="text-xs">Frames</span>
              </Button>

              <Button
                variant="ghost"
                className="flex flex-col items-center gap-2 h-auto py-3 px-4 text-muted-foreground hover:text-foreground hover:text-destructive"
                onClick={handleDeletePhoto}
                disabled={deleting || !currentPhotoUrl}
              >
                <Trash2 className="h-5 w-5" />
                <span className="text-xs">
                  {deleting ? "Removing..." : "Delete"}
                </span>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileUpload}
        className="hidden"
      />
    </>
  );
};

export default ProfilePhotoModal;