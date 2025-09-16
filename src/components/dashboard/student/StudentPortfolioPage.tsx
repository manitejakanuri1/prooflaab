import React, { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { useProofUploads } from "@/hooks/useProofUploads";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useToast } from "@/hooks/use-toast";
import { 
  ExternalLink, 
  Copy, 
  Eye, 
  EyeOff, 
  Edit3, 
  Save, 
  X,
  Plus,
  Trophy,
  Calendar,
  Award
} from "lucide-react";
import { format } from "date-fns";

const StudentPortfolioPage = () => {
  const { profile: studentProfile, loading: profileLoading } = useStudentProfile();
  const { data: proofUploads, isLoading: proofsLoading } = useProofUploads(new Date());
  const { portfolio, loading: portfolioLoading, updatePortfolioVisibility, updatePortfolio } = usePortfolio();
  const { toast } = useToast();
  const [editingBio, setEditingBio] = useState(false);
  const [editingSkills, setEditingSkills] = useState(false);
  const [bioText, setBioText] = useState("");
  const [skillsText, setSkillsText] = useState("");
  const [newSkill, setNewSkill] = useState("");

  const isLoading = profileLoading || proofsLoading || portfolioLoading;

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/3 mb-6"></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="h-64 bg-gray-200 rounded"></div>
            <div className="h-64 bg-gray-200 rounded"></div>
            <div className="h-64 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!studentProfile) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="text-center py-12">
          <p className="text-gray-500">Student profile not found.</p>
        </div>
      </div>
    );
  }

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleShare = async () => {
    if (portfolio?.slug) {
      const portfolioUrl = `${window.location.origin}/portfolio/${portfolio.slug}`;
      await navigator.clipboard.writeText(portfolioUrl);
      toast({
        title: "Portfolio URL copied!",
        description: "Share this link to show your portfolio to others.",
      });
    } else {
      toast({
        title: "Error",
        description: "Portfolio URL not available",
        variant: "destructive",
      });
    }
  };

  const toggleVisibility = async () => {
    if (!portfolio || !portfolio.id) {
      toast({
        title: "Error",
        description: "Portfolio not found. Please refresh the page.",
        variant: "destructive",
      });
      return;
    }

    try {
      await updatePortfolioVisibility(!portfolio.is_public);
      toast({
        title: "Portfolio Updated",
        description: `Portfolio is now ${!portfolio.is_public ? 'public' : 'private'}`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update portfolio visibility",
        variant: "destructive",
      });
    }
  };

  const handleEditBio = () => {
    setEditingBio(true);
    setBioText(portfolio?.bio || "");
  };

  const handleSaveBio = async () => {
    try {
      await updatePortfolio({ bio: bioText });
      setEditingBio(false);
      toast({
        title: "Bio Updated",
        description: "Your bio has been successfully updated.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update bio",
        variant: "destructive",
      });
    }
  };

  const handleEditSkills = () => {
    setEditingSkills(true);
    setSkillsText(portfolio?.skills?.join(", ") || "");
  };

  const handleSaveSkills = async () => {
    try {
      const skillsArray = skillsText.split(",").map(skill => skill.trim()).filter(skill => skill.length > 0);
      await updatePortfolio({ skills: skillsArray });
      setEditingSkills(false);
      setSkillsText("");
      toast({
        title: "Skills Updated",
        description: "Your skills have been successfully updated.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update skills",
        variant: "destructive",
      });
    }
  };

  const addSkill = () => {
    if (newSkill.trim()) {
      const currentSkills = portfolio?.skills || [];
      const updatedSkills = [...currentSkills, newSkill.trim()];
      setSkillsText(updatedSkills.join(", "));
      setNewSkill("");
    }
  };

  const verifiedProofs = proofUploads?.filter(proof => proof.status === 'Verified') || [];

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Portfolio</h1>
          <p className="text-muted-foreground">Showcase your achievements and skills</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleShare}
            disabled={!portfolio?.slug}
          >
            <Copy className="h-4 w-4 mr-2" />
            Share Portfolio
          </Button>
          <Button
            variant="outline"
            onClick={toggleVisibility}
            disabled={!portfolio}
          >
            {portfolio?.is_public ? (
              <>
                <Eye className="h-4 w-4 mr-2" />
                Public
              </>
            ) : (
              <>
                <EyeOff className="h-4 w-4 mr-2" />
                Private
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Profile Overview */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-6">
            <Avatar className="h-20 w-20">
              <AvatarImage src={studentProfile.profile_photo_url || undefined} />
              <AvatarFallback className="text-lg font-semibold">
                {getInitials(studentProfile.full_name)}
              </AvatarFallback>
            </Avatar>
            
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-2xl font-bold">{studentProfile.full_name}</h2>
                <div className="flex gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">{studentProfile.total_xp}</div>
                    <div className="text-sm text-gray-500">XP Points</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">{studentProfile.trust_score}</div>
                    <div className="text-sm text-gray-500">Trust Score</div>
                  </div>
                </div>
              </div>
              
              <div className="space-y-1 text-gray-600">
                <p>📧 {studentProfile.email}</p>
              </div>

              {portfolio?.slug && (
                <div className="mt-3">
                  <p className="text-sm text-gray-500">
                    Portfolio URL: <span className="font-mono text-blue-600">/portfolio/{portfolio.slug}</span>
                  </p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Verified Achievements */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-yellow-600" />
                Verified Achievements
              </span>
              <Badge variant="secondary" className="bg-blue-50 text-blue-700">
                {verifiedProofs.length} Verified
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {verifiedProofs.length > 0 ? (
              <div className="space-y-4">
                {verifiedProofs.map((proof) => (
                  <div key={proof.id} className="flex items-start justify-between p-4 bg-green-50 rounded-lg border border-green-200">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Award className="h-4 w-4 text-green-600" />
                        <h4 className="font-medium text-green-900">
                          Task Completed Successfully
                        </h4>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">
                        {proof.submission_notes || "Completed assigned task with excellence"}
                      </p>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          <span>Submitted: {proof.submitted_at ? format(new Date(proof.submitted_at), "MMM dd, yyyy") : 'N/A'}</span>
                        </div>
                        {proof.reviewed_at && (
                          <div className="flex items-center gap-1">
                            <Award className="h-3 w-3" />
                            <span>Verified: {proof.reviewed_at ? format(new Date(proof.reviewed_at), "MMM dd, yyyy") : 'N/A'}</span>
                          </div>
                        )}
                      </div>
                      {proof.file_url && (
                        <Button 
                          variant="link" 
                          size="sm" 
                          className="p-0 h-auto text-green-600 mt-2"
                          onClick={() => window.open(proof.file_url, '_blank')}
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          View Submission
                        </Button>
                      )}
                    </div>
                    <div className="text-right">
                      <Badge className="bg-green-100 text-green-800 border-green-300">
                        ✓ Verified
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Trophy className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">No verified achievements yet.</p>
                <p className="text-sm text-gray-400">Complete tasks and submit proofs to build your portfolio!</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* About Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>About</span>
              <div className="flex gap-2">
                {!editingBio && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleEditBio}
                    className="h-8 px-2 text-xs"
                  >
                    <Edit3 className="h-3 w-3 mr-1" />
                    Edit Bio
                  </Button>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div>
                <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                  <span>Bio</span>
                  {editingBio && (
                    <div className="flex gap-1 ml-auto">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingBio(false);
                          setBioText(portfolio?.bio || "");
                        }}
                        className="h-6 px-2 text-xs"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleSaveBio}
                        className="h-6 px-2 text-xs text-green-600"
                      >
                        <Save className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </h4>
                {editingBio ? (
                  <Textarea
                    value={bioText}
                    onChange={(e) => setBioText(e.target.value)}
                    placeholder="Tell others about yourself, your interests, and your goals..."
                    className="min-h-[100px] resize-none"
                    maxLength={500}
                  />
                ) : (
                  <p className="text-gray-600 leading-relaxed">
                    {portfolio?.bio || "No bio added yet. Click 'Edit Bio' to add information about yourself!"}
                  </p>
                )}
              </div>
              
              <div>
                <h4 className="font-medium text-gray-900 mb-3 flex items-center justify-between">
                  <span>Skills</span>
                  {!editingSkills && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleEditSkills}
                      className="h-8 px-2 text-xs"
                    >
                      <Edit3 className="h-3 w-3 mr-1" />
                      Edit Skills
                    </Button>
                  )}
                </h4>
                
                {editingSkills ? (
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <Input
                        value={newSkill}
                        onChange={(e) => setNewSkill(e.target.value)}
                        placeholder="Add a skill (e.g., React, Python, UI/UX)"
                        onKeyPress={(e) => e.key === 'Enter' && addSkill()}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={addSkill}
                        disabled={!newSkill.trim()}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <Textarea
                      value={skillsText}
                      onChange={(e) => setSkillsText(e.target.value)}
                      placeholder="Enter skills separated by commas (e.g., React, Python, UI/UX Design)"
                      className="min-h-[80px] resize-none"
                    />
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingSkills(false);
                          setSkillsText("");
                          setNewSkill("");
                        }}
                      >
                        <X className="h-3 w-3 mr-1" />
                        Cancel
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={handleSaveSkills}
                      >
                        <Save className="h-3 w-3 mr-1" />
                        Save Skills
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {portfolio?.skills && portfolio.skills.length > 0 ? (
                      portfolio.skills.map((skill, index) => (
                        <Badge key={index} variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                          {skill}
                        </Badge>
                      ))
                    ) : (
                      <p className="text-gray-500 text-sm">No skills added yet. Click 'Edit Skills' to showcase your abilities!</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default StudentPortfolioPage;