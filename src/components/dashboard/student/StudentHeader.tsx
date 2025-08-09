import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import ProfilePhotoModal from "../ProfilePhotoModal";
import { useStudentProfile } from "@/hooks/useStudentProfile";

interface StudentHeaderProps {
  studentName: string;
  profilePhoto?: string | null;
  onMenuClick: () => void;
  showMenuButton: boolean;
  onPhotoUpdate?: () => void;
}

const StudentHeader = ({ 
  studentName, 
  profilePhoto, 
  onMenuClick, 
  showMenuButton,
  onPhotoUpdate 
}: StudentHeaderProps) => {
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const { profile } = useStudentProfile();
  
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handlePhotoUpdate = (newUrl: string | null) => {
    onPhotoUpdate?.();
  };

  return (
    <header className="bg-white/90 backdrop-blur-sm border-b border-orange-200/30 px-6 py-4">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        {/* Logo and Menu */}
        <div className="flex items-center space-x-4">
          {showMenuButton && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onMenuClick}
              className="p-2"
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
          
          <div className="text-gray-900 font-bold text-lg flex items-center space-x-3">
            <img 
              src="/lovable-uploads/b9197a47-7e43-4b27-8ab7-ce8138fcd94c.png" 
              alt="ProofLabAI Logo" 
              className="h-12 w-12"
            />
            <span>ProofLabAI</span>
          </div>
        </div>
        
        {/* User Profile */}
        <div className="flex items-center space-x-3">
          <span className="text-sm text-gray-600 hidden sm:block">
            Welcome, {studentName}
          </span>
          <Avatar className="h-10 w-10 cursor-pointer" onClick={() => setIsPhotoModalOpen(true)}>
            <AvatarImage src={profilePhoto || undefined} alt={studentName} />
            <AvatarFallback className="bg-orange-100 text-orange-700">
              {getInitials(studentName)}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>

      {/* Profile Photo Modal */}
      {profile && (
        <ProfilePhotoModal
          isOpen={isPhotoModalOpen}
          onClose={() => setIsPhotoModalOpen(false)}
          currentPhotoUrl={profilePhoto}
          userName={studentName}
          userId={profile.id}
          onPhotoUpdate={handlePhotoUpdate}
        />
      )}
    </header>
  );
};

export default StudentHeader;