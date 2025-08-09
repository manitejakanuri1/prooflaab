import { useStudentProfile } from "@/hooks/useStudentProfile";
import { useActivityTracking } from "@/hooks/useActivityTracking";
import DashboardGrid from "../DashboardGrid";

const StudentDashboardOverview = () => {
  const { profile, rank, loading } = useStudentProfile();
  
  // Track user activity for work time calculation
  useActivityTracking();

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-12 gap-6 animate-pulse">
          <div className="col-span-12 lg:col-span-3">
            <div className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl h-96"></div>
          </div>
          <div className="col-span-12 lg:col-span-6 space-y-6">
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl h-32"></div>
              ))}
            </div>
          </div>
          <div className="col-span-12 lg:col-span-3">
            <div className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl h-96"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="space-y-6">
        <div className="text-center py-8">
          <p className="text-gray-500">Unable to load dashboard data.</p>
        </div>
      </div>
    );
  }

  const studentData = {
    name: profile.full_name,
    email: profile.email,
    profilePhoto: profile.profile_photo_url,
    totalXp: profile.total_xp || 0,
    trustScore: profile.trust_score || 0,
    rank: rank,
    totalStudents: 100 // This could be fetched from a separate hook if needed
  };

  return <DashboardGrid studentData={studentData} />;
};

export default StudentDashboardOverview;