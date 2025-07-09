
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play } from "lucide-react";

interface WaitingTask {
  id: string;
  title: string;
  assignedBy: 'AI Generated' | 'Start-up Assigned' | 'College Assigned';
}

export default function TasksWaitingForYou() {
  const waitingTasks: WaitingTask[] = [
    {
      id: "1",
      title: "Complete Machine Learning Tutorial",
      assignedBy: "AI Generated"
    },
    {
      id: "2", 
      title: "Develop Mobile App Prototype",
      assignedBy: "Start-up Assigned"
    },
    {
      id: "3",
      title: "Research Paper on Blockchain",
      assignedBy: "College Assigned"
    }
  ];

  const getTagColor = (assignedBy: string) => {
    switch (assignedBy) {
      case 'AI Generated':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'Start-up Assigned':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'College Assigned':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg rounded-3xl">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg font-semibold text-gray-900 text-center">
          Tasks waiting for you
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {waitingTasks.map((task) => (
          <div key={task.id} className="bg-gray-50/80 rounded-2xl p-4 space-y-3">
            <div className="space-y-2">
              <h4 className="font-medium text-gray-900 text-sm leading-tight">
                {task.title}
              </h4>
              <Badge className={`${getTagColor(task.assignedBy)} text-xs font-medium border w-fit`}>
                {task.assignedBy}
              </Badge>
            </div>
            
            <Button 
              size="sm" 
              className="w-full bg-gray-900 hover:bg-gray-800 text-white rounded-xl shadow-sm"
            >
              <Play className="h-3 w-3 mr-2" />
              Start Task
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
