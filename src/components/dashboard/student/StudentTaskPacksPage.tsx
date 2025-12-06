import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package, Sparkles, Clock } from "lucide-react";

const StudentTaskPacksPage = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Task Packs</h2>
        <p className="text-muted-foreground">Curated collections of tasks to build your skills</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold flex items-center gap-2">
            <Package className="h-5 w-5" />
            Coming Soon
            <Badge variant="outline" className="ml-auto bg-primary/10 text-primary border-primary/20">
              <Sparkles className="h-3 w-3 mr-1" />
              New Feature
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-16">
            <div className="relative inline-block mb-6">
              <Package className="h-20 w-20 text-muted-foreground mx-auto opacity-50" />
              <div className="absolute -top-2 -right-2 bg-primary text-primary-foreground rounded-full p-2">
                <Clock className="h-4 w-4" />
              </div>
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-3">
              Task Packs are on the way!
            </h3>
            <p className="text-muted-foreground max-w-md mx-auto mb-6">
              Soon you'll be able to access curated collections of tasks designed to help you master specific skills and build a stronger portfolio.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Badge variant="secondary" className="text-sm">
                🎯 Skill-based learning
              </Badge>
              <Badge variant="secondary" className="text-sm">
                📚 Structured paths
              </Badge>
              <Badge variant="secondary" className="text-sm">
                🏆 Achievement rewards
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default StudentTaskPacksPage;
