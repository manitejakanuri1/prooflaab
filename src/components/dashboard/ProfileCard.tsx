
import { useState, useEffect } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, Award, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

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
    <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl overflow-hidden">
      <CardContent className="p-0">
        {/* Profile Image Section */}
        <div className="relative h-48 bg-gradient-to-br from-orange-100 to-yellow-100 flex items-center justify-center">
          <Avatar className="h-24 w-24 border-4 border-white shadow-lg">
            <AvatarImage src={student.profilePhoto || ""} alt={student.name} />
            <AvatarFallback className="bg-gray-900 text-white text-2xl font-bold">
              {student.name.split(' ').map(n => n[0]).join('')}
            </AvatarFallback>
          </Avatar>
        </div>

        {/* Profile Info */}
        <div className="p-6 space-y-4">
          <div className="text-center">
            <h3 className="font-bold text-xl text-gray-900 mb-1">
              {student.name}
            </h3>
            <p className="text-sm text-gray-600">UX/UI Designer</p>
            
            {/* Trust Score Badge */}
            <div className="mt-3">
              <Badge className="bg-yellow-100 text-yellow-800 font-semibold px-4 py-2 rounded-full border border-yellow-200">
                Trust Score: {student.trustScore}/100
              </Badge>
            </div>
          </div>

          <div className="bg-gray-900 text-white px-4 py-3 rounded-2xl text-center font-semibold text-lg">
            ${student.totalXp.toLocaleString()}
          </div>

          {/* Details List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between py-3 border-b border-gray-100">
              <div className="flex items-center space-x-3">
                <Mail className="h-5 w-5 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Email ID</span>
              </div>
              <span className="text-xs text-green-600 font-semibold">✓</span>
            </div>
            
            <div className="flex items-center justify-between py-3 border-b border-gray-100">
              <div className="flex items-center space-x-3">
                <Award className="h-5 w-5 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Total XP Points</span>
              </div>
              <span className="text-sm font-semibold text-gray-700">{student.totalXp}</span>
            </div>
            
            <div className="flex items-center justify-between py-3">
              <div className="flex items-center space-x-3">
                <Trophy className="h-5 w-5 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Leaderboard Rank</span>
              </div>
              <span className="text-sm font-semibold text-gray-700">#{student.rank}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
