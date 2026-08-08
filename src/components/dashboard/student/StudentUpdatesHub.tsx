import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StudentNotificationsPage from "./StudentNotificationsPage";
import StudentResumeCertsPage from "./StudentResumeCertsPage";
import StudentResumeJobMatchPage from "./StudentResumeJobMatchPage";
import CodingStreaks from "./CodingStreaks";

// Everything that pulls a student back in: what happened (notifications),
// what to go do next (certs worth getting, jobs worth matching), and daily
// habit reminders (coding streaks).
const StudentUpdatesHub = () => {
  return (
    <Tabs defaultValue="notifications" className="space-y-4">
      <TabsList>
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
        <TabsTrigger value="certs">Certification Radar</TabsTrigger>
        <TabsTrigger value="jobmatch">Match a Job</TabsTrigger>
        <TabsTrigger value="streaks">Coding Streaks</TabsTrigger>
      </TabsList>

      <TabsContent value="notifications">
        <StudentNotificationsPage />
      </TabsContent>
      <TabsContent value="certs">
        <StudentResumeCertsPage />
      </TabsContent>
      <TabsContent value="jobmatch">
        <StudentResumeJobMatchPage />
      </TabsContent>
      <TabsContent value="streaks">
        <CodingStreaks />
      </TabsContent>
    </Tabs>
  );
};

export default StudentUpdatesHub;
