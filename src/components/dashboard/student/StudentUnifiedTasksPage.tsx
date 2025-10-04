import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Briefcase, ListTodo } from "lucide-react";
import StudentAvailableTasksPage from "./StudentAvailableTasksPage";
import StudentTasksPage from "./StudentTasksPage";
import { useAvailableTasks } from "@/hooks/useAvailableTasks";
import { useAllStudentTasks } from "@/hooks/useAllStudentTasks";

const StudentUnifiedTasksPage = () => {
  const [activeTab, setActiveTab] = useState("available");
  const { data: availableTasks } = useAvailableTasks();
  const { tasks: myTasks } = useAllStudentTasks();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Tasks</h2>
        <p className="text-muted-foreground">
          Browse available opportunities and manage your assigned tasks
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="available" className="gap-2">
            <Briefcase className="h-4 w-4" />
            Available Tasks
            {availableTasks && availableTasks.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {availableTasks.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="my-tasks" className="gap-2">
            <ListTodo className="h-4 w-4" />
            My Tasks
            {myTasks && myTasks.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {myTasks.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="available" className="mt-6">
          <StudentAvailableTasksPage />
        </TabsContent>

        <TabsContent value="my-tasks" className="mt-6">
          <StudentTasksPage />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default StudentUnifiedTasksPage;
