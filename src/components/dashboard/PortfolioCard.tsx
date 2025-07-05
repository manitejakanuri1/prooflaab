
import { User, Eye, EyeOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function PortfolioCard() {
  const [isPublic, setIsPublic] = useState(true);

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <CardTitle className="text-xl font-semibold flex items-center gap-2">
          📁 Public Portfolio
          <User className="h-5 w-5 text-purple-600" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button className="w-full bg-purple-600 hover:bg-purple-700">
          <Eye className="h-4 w-4 mr-2" />
          View Portfolio
        </Button>
        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
          <span className="text-sm font-medium">Portfolio Visibility</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsPublic(!isPublic)}
            className={isPublic ? 'text-green-600 border-green-200' : 'text-gray-600'}
          >
            {isPublic ? (
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
      </CardContent>
    </Card>
  );
}
