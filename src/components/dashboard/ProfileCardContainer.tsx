
import { useStudentProfile } from "@/hooks/useStudentProfile";
import ProfileCard from "./ProfileCard";

interface Student {
  name: string;
  email: string;
  profilePhoto: string | null;
  totalXp: number;
  trustScore: number;
  rank: number;
}

export default function ProfileCardContainer() {
  const { profile, rank, loading, error } = useStudentProfile();

  if (loading) {
    return (
      <div className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl h-96 flex items-center justify-center">
        <div className="text-gray-500">Loading profile...</div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl h-96 flex items-center justify-center">
        <div className="text-red-500">Error loading profile: {error}</div>
      </div>
    );
  }

  const studentData: Student = {
    name: profile.full_name,
    email: profile.email,
    profilePhoto: profile.profile_photo_url,
    totalXp: profile.total_xp || 0,
    trustScore: profile.trust_score || 0,
    rank: rank
  };

  return <ProfileCard student={studentData} />;
}
