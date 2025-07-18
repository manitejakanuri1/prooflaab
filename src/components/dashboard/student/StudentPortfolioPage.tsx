import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { useProofUploads } from "@/hooks/useProofUploads";
import { Award, Eye, EyeOff, ExternalLink, Share } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const StudentPortfolioPage = () => {
  const { profile, loading: profileLoading } = useStudentProfile();
  const currentDate = new Date();
  const { data: uploads, isLoading: uploadsLoading } = useProofUploads(currentDate);
  const [isPublic, setIsPublic] = useState(true);
  const { toast } = useToast();

  if (profileLoading || uploadsLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Portfolio</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const verifiedUploads = uploads?.filter(upload => upload.status === 'Verified') || [];

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleShare = () => {
    const portfolioUrl = `${window.location.origin}/portfolio/${profile?.slug}`;
    navigator.clipboard.writeText(portfolioUrl);
    toast({
      title: "Portfolio link copied!",
      description: "Share this link to showcase your achievements.",
    });
  };

  const toggleVisibility = () => {
    setIsPublic(!isPublic);
    toast({
      title: isPublic ? "Portfolio made private" : "Portfolio made public",
      description: isPublic 
        ? "Your portfolio is now hidden from public view." 
        : "Your portfolio is now visible to everyone.",
    });
  };

  return (
    <div className="space-y-6">
      {/* Profile Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl font-semibold">My Portfolio</CardTitle>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                {isPublic ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                <span className="text-sm">{isPublic ? 'Public' : 'Private'}</span>
                <Switch checked={isPublic} onCheckedChange={toggleVisibility} />
              </div>
              <Button onClick={handleShare} className="bg-orange-600 hover:bg-orange-700">
                <Share className="h-4 w-4 mr-2" />
                Share Portfolio
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-start space-x-6">
            <Avatar className="h-24 w-24">
              <AvatarImage src={profile?.profile_photo_url || undefined} alt={profile?.full_name} />
              <AvatarFallback className="bg-orange-100 text-orange-700 text-lg">
                {getInitials(profile?.full_name || 'Student')}
              </AvatarFallback>
            </Avatar>
            
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-gray-900">{profile?.full_name}</h2>
              <p className="text-gray-600 mb-4">{profile?.email}</p>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="text-center p-4 bg-orange-50 rounded-lg">
                  <div className="text-2xl font-bold text-orange-600">{profile?.total_xp || 0}</div>
                  <div className="text-sm text-gray-600">Total XP</div>
                </div>
                <div className="text-center p-4 bg-purple-50 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">{profile?.trust_score || 0}</div>
                  <div className="text-sm text-gray-600">Trust Score</div>
                </div>
                <div className="text-center p-4 bg-green-50 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">{verifiedUploads.length}</div>
                  <div className="text-sm text-gray-600">Completed Tasks</div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Verified Tasks */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Award className="h-5 w-5 text-orange-600" />
            <span>Verified Achievements</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {verifiedUploads.length === 0 ? (
            <div className="text-center py-8">
              <Award className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No verified tasks yet</h3>
              <p className="text-gray-500">Complete and submit tasks to build your portfolio.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {verifiedUploads.map((upload) => (
                <div
                  key={upload.id}
                  className="p-4 border border-gray-200 rounded-lg hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-medium text-gray-900 flex-1">
                      {upload.tasks?.title || 'Unknown Task'}
                    </h4>
                    <Badge className="bg-green-100 text-green-800 ml-2">
                      ✅ Verified
                    </Badge>
                  </div>
                  
                  <div className="text-sm text-gray-600 mb-3">
                    Completed on {format(new Date(upload.submitted_at), "MMM dd, yyyy")}
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1">
                      <Award className="h-4 w-4 text-orange-500" />
                      <span className="text-sm font-medium">
                        {upload.tasks?.xp_reward || upload.tasks?.xp || 0} XP
                      </span>
                    </div>
                    
                    {upload.file_url && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.open(upload.file_url!, '_blank')}
                      >
                        <ExternalLink className="h-4 w-4 mr-1" />
                        View
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bio Section */}
      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h4 className="font-medium text-gray-900 mb-2">Bio</h4>
              <p className="text-gray-600">
                No bio added yet. Share something about yourself!
              </p>
            </div>
            
            <div>
              <h4 className="font-medium text-gray-900 mb-2">Skills</h4>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="bg-orange-50 text-orange-700">
                  React
                </Badge>
                <Badge variant="outline" className="bg-orange-50 text-orange-700">
                  JavaScript
                </Badge>
                <Badge variant="outline" className="bg-orange-50 text-orange-700">
                  Python
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default StudentPortfolioPage;