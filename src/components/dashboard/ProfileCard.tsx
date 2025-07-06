
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, Award, Trophy } from "lucide-react";

interface Student {
  name: string;
  email: string;
  profilePhoto: string | null;
  totalXp: number;
  trustScore: number;
  rank: number;
}

interface ProfileCardProps {
  student: Student;
}

export default function ProfileCard({ student }: ProfileCardProps) {
  return (
    <Card className="bg-white/60 backdrop-blur-sm border-0 shadow-lg rounded-3xl overflow-hidden">
      <CardContent className="p-0">
        {/* Profile Image Section */}
        <div className="relative h-48 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
          <Avatar className="h-24 w-24 border-4 border-white shadow-lg">
            <AvatarImage src={student.profilePhoto || ""} alt={student.name} />
            <AvatarFallback className="bg-gray-900 text-white text-2xl font-bold">
              {student.name.split(' ').map(n => n[0]).join('')}
            </AvatarFallback>
          </Avatar>
          
          {/* Trust Score Badge */}
          <div className="absolute bottom-4 right-4">
            <Badge className="bg-yellow-400 text-gray-900 font-semibold px-3 py-1 rounded-full">
              {student.trustScore}/100
            </Badge>
          </div>
        </div>

        {/* Profile Info */}
        <div className="p-6 space-y-4">
          <div className="text-center">
            <h3 className="font-bold text-xl text-gray-900 mb-1">
              {student.name}
            </h3>
            <p className="text-sm text-gray-600">UX/UI Designer</p>
          </div>

          <div className="bg-gray-900 text-white px-4 py-2 rounded-2xl text-center font-semibold">
            ${student.totalXp.toLocaleString()}
          </div>

          {/* Details List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <div className="flex items-center space-x-3">
                <Mail className="h-4 w-4 text-gray-500" />
                <span className="text-sm text-gray-700">Email ID</span>
              </div>
              <span className="text-xs text-gray-500">✓</span>
            </div>
            
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <div className="flex items-center space-x-3">
                <Award className="h-4 w-4 text-gray-500" />
                <span className="text-sm text-gray-700">XP Points (Total)</span>
              </div>
              <span className="text-xs font-semibold text-gray-700">{student.totalXp}</span>
            </div>
            
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center space-x-3">
                <Trophy className="h-4 w-4 text-gray-500" />
                <span className="text-sm text-gray-700">Rank</span>
              </div>
              <span className="text-xs font-semibold text-gray-700">#{student.rank}</span>
            </div>
          </div>

          {/* Expandable Sections */}
          <div className="space-y-2 pt-4">
            <details className="group">
              <summary className="flex items-center justify-between cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                <span>Compensation Summary</span>
                <span className="transform group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="mt-2 text-xs text-gray-600">
                Performance-based XP rewards
              </div>
            </details>
            
            <details className="group">
              <summary className="flex items-center justify-between cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                <span>Student Benefits</span>
                <span className="transform group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="mt-2 text-xs text-gray-600">
                Access to mentorship and portfolio building
              </div>
            </details>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
