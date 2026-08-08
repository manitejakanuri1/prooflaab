import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StudentAssignedTasksPage from "./StudentAssignedTasksPage";
import StudentCreatedTasksPage from "./StudentCreatedTasksPage";
import StudentCreateTaskPage from "./StudentCreateTaskPage";
import StudentStartupOpportunitiesPage from "./StudentStartupOpportunitiesPage";

// One hub for everything task-related: what's assigned to you (college/admin/
// startup, including applications you've made), what you created for yourself,
// and outside opportunities you can apply to.
const StudentTasksHub = () => {
  return (
    <Tabs defaultValue="assigned" className="space-y-4">
      <TabsList>
        <TabsTrigger value="assigned">Assigned</TabsTrigger>
        <TabsTrigger value="opportunities">Outside Tasks</TabsTrigger>
        <TabsTrigger value="created">My Created</TabsTrigger>
        <TabsTrigger value="create">Create a Task</TabsTrigger>
      </TabsList>

      <TabsContent value="assigned">
        <StudentAssignedTasksPage />
      </TabsContent>
      <TabsContent value="opportunities">
        <StudentStartupOpportunitiesPage />
      </TabsContent>
      <TabsContent value="created">
        <StudentCreatedTasksPage />
      </TabsContent>
      <TabsContent value="create">
        <StudentCreateTaskPage />
      </TabsContent>
    </Tabs>
  );
};

export default StudentTasksHub;
