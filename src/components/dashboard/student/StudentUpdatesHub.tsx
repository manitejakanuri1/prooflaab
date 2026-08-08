import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StudentNotificationsPage from "./StudentNotificationsPage";
import CodingStreaks from "./CodingStreaks";

// Things that pull a student back in on a schedule: what happened
// (notifications) and daily habit reminders (coding streaks). Resume-analysis
// tools (certs, job match) moved to the Resume card — they're one-off tools,
// not recurring check-ins.
const StudentUpdatesHub = () => {
  return (
    <Tabs defaultValue="notifications" className="space-y-4">
      <TabsList>
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
        <TabsTrigger value="streaks">Coding Streaks</TabsTrigger>
      </TabsList>

      <TabsContent value="notifications">
        <StudentNotificationsPage />
      </TabsContent>
      <TabsContent value="streaks">
        <CodingStreaks />
      </TabsContent>
    </Tabs>
  );
};

export default StudentUpdatesHub;
