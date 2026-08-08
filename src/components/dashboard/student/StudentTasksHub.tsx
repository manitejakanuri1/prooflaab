import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StudentAssignedTasksPage from "./StudentAssignedTasksPage";
import StudentCreatedTasksPage from "./StudentCreatedTasksPage";
import StudentStartupOpportunitiesPage from "./StudentStartupOpportunitiesPage";
import StudentUploadsPage from "./StudentUploadsPage";

// One hub for everything task-related: what's assigned to you (college/admin/
// startup, including applications you've made), outside opportunities you can
// apply to, what you created for yourself (with a "+ Create New" button —
// folded in there instead of its own tab), and the full history/review of
// everything you've submitted.
const StudentTasksHub = () => {
  return (
    <Tabs defaultValue="assigned" className="space-y-4">
      <TabsList>
        <TabsTrigger value="assigned">Assigned</TabsTrigger>
        <TabsTrigger value="opportunities">Outside Tasks</TabsTrigger>
        <TabsTrigger value="created">My Created</TabsTrigger>
        <TabsTrigger value="uploads">My Uploads</TabsTrigger>
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
      <TabsContent value="uploads">
        <StudentUploadsPage />
      </TabsContent>
    </Tabs>
  );
};

export default StudentTasksHub;
