
import { User, Eye, EyeOff, Camera } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useState } from "react";

interface Student {
  name: string;
  email: string;
  profilePhoto: string | null;
  totalXp: number;
}

interface ProfileSectionProps {
  student: Student;
}

export default function ProfileSection({ student }: ProfileSectionProps) {
  const [isPortfolioPublic, setIsPortfolioPublic] = useState(true);

  return (
    <Card className="border-0 shadow-lg bg-gradient-to-br from-indigo-50 to-purple-50">
      <CardHeader className="text-center pb-4">
        <CardTitle className="text-lg font-semibold text-gray-800 flex items-center justify-center gap-2">
          👤 Profile
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-center space-y-3">
          <div className="relative inline-block">
            <Avatar className="h-20 w-20 border-4 border-white shadow-lg">
              <AvatarImage src={student.profilePhoto || ""} alt={student.name} />
              <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-xl font-bold">
                {student.name.split(' ').map(n => n[0]).join('')}
              </AvatarFallback>
            </Avatar>
            <Button 
              size="sm" 
              variant="outline" 
              className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full p-0 bg-white shadow-md hover:shadow-lg"
            >
              <Camera className="h-4 w-4" />
            </Button>
          </div>
          
          <div>
            <h3 className="font-bold text-xl text-gray-900">{student.name}</h3>
            <p className="text-gray-600 text-sm">{student.email}</p>
            <div className="mt-2 inline-flex items-center gap-1 bg-gradient-to-r from-yellow-100 to-orange-100 px-3 py-1 rounded-full">
              <span className="text-sm font-semibold text-orange-800">{student.totalXp.toLocaleString()} XP</span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <Button className="w-full bg-purple-600 hover:bg-purple-700 shadow-md">
            <Eye className="h-4 w-4 mr-2" />
            📁 View Portfolio
          </Button>
          
          <div className="flex items-center justify-between p-3 bg-white/60 rounded-lg border">
            <span className="text-sm font-medium text-gray-700">Portfolio Visibility</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsPortfolioPublic(!isPortfolioPublic)}
              className={`${isPortfolioPublic ? 'text-green-600 border-green-200 bg-green-50' : 'text-gray-600'} shadow-sm`}
            >
              {isPortfolioPublic ? (
                <>
                  <Eye className="h-4 w-4 mr-1" />
                  Public
                </>
              ) : (
                <>
                  <EyeOff className="h-4 w-4 mr-1" />
                  Private
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
