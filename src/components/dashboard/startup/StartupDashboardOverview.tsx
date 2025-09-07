import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building, Globe, Users, FileText, CheckCircle, TrendingUp } from "lucide-react";
import { useStartupProfile } from "@/hooks/useStartupProfile";
import { useStartupStats } from "@/hooks/useStartupStats";
import { useStartupActivity } from "@/hooks/useStartupActivity";
import { formatDistanceToNow } from "date-fns";

export function StartupDashboardOverview() {
  const { data: profile, isLoading: profileLoading } = useStartupProfile();
  const { data: stats, isLoading: statsLoading } = useStartupStats();
  const { data: activities, isLoading: activitiesLoading } = useStartupActivity();

  const getActivityColor = (status: string) => {
    switch (status) {
      case 'success': return 'bg-green-500';
      case 'warning': return 'bg-orange-500';
      case 'info': return 'bg-blue-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="space-y-6">
      {/* Startup Profile Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building className="h-5 w-5" />
            Company Profile
          </CardTitle>
        </CardHeader>
        <CardContent>
          {profileLoading ? (
            <div className="animate-pulse space-y-4">
              <div className="flex items-start gap-6">
                <div className="w-20 h-20 bg-muted rounded-lg"></div>
                <div className="flex-1 space-y-3">
                  <div className="h-6 bg-muted rounded w-48"></div>
                  <div className="h-4 bg-muted rounded w-full"></div>
                  <div className="h-4 bg-muted rounded w-32"></div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-6">
              <div className="w-20 h-20 bg-primary/10 rounded-lg flex items-center justify-center">
                <Building className="h-10 w-10 text-primary" />
              </div>
              
              <div className="flex-1 space-y-3">
                <div>
                  <h3 className="text-xl font-semibold">
                    {profile?.startup_name || 'Your Startup'}
                  </h3>
                  <p className="text-muted-foreground">
                    {profile?.domain_industry 
                      ? `Operating in ${profile.domain_industry} domain` 
                      : 'Complete your profile to showcase your startup'}
                  </p>
                  {profile?.talent_needs && profile.talent_needs.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      <span className="text-sm text-muted-foreground">Looking for:</span>
                      {profile.talent_needs.slice(0, 3).map((skill, index) => (
                        <Badge key={index} variant="outline" className="text-xs">
                          {skill}
                        </Badge>
                      ))}
                      {profile.talent_needs.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{profile.talent_needs.length - 3} more
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
                
                <div className="flex items-center gap-4">
                  <Badge variant="secondary">Active Company</Badge>
                </div>
                
                <Button variant="outline" size="sm">
                  Edit Profile
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <FileText className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {statsLoading ? '...' : stats?.totalTasks || 0}
                </div>
                <div className="text-sm text-muted-foreground">Total Tasks Posted</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                <Users className="h-6 w-6 text-orange-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {statsLoading ? '...' : stats?.totalSubmissions || 0}
                </div>
                <div className="text-sm text-muted-foreground">Submissions Received</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {statsLoading ? '...' : stats?.verifiedProofs || 0}
                </div>
                <div className="text-sm text-muted-foreground">Proofs Verified</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activitiesLoading ? (
            <div className="animate-pulse space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-12 bg-muted rounded-lg"></div>
              ))}
            </div>
          ) : activities && activities.length > 0 ? (
            <div className="space-y-4">
              {activities.map((activity) => (
                <div key={activity.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${getActivityColor(activity.status)}`}></div>
                    <span className="text-sm">{activity.description}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No recent activity. Start by posting your first task!</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}