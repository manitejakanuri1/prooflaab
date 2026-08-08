import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ResumeCheckFlow from "./ResumeCheckFlow";
import StudentResumeCertsPage from "./StudentResumeCertsPage";
import StudentResumeJobMatchPage from "./StudentResumeJobMatchPage";

// Everything that reads your resume: take/retake the check (which is also
// how you update your resume — each run re-uploads it), then the two tools
// that analyze it: certs worth getting, jobs worth matching to.
const StudentResumeHub = () => {
  return (
    <Tabs defaultValue="resume-check" className="space-y-4">
      <TabsList>
        <TabsTrigger value="resume-check">Resume Check</TabsTrigger>
        <TabsTrigger value="certs">Certification Radar</TabsTrigger>
        <TabsTrigger value="jobmatch">Match a Job</TabsTrigger>
      </TabsList>

      <TabsContent value="resume-check">
        <ResumeCheckFlow />
      </TabsContent>
      <TabsContent value="certs">
        <StudentResumeCertsPage />
      </TabsContent>
      <TabsContent value="jobmatch">
        <StudentResumeJobMatchPage />
      </TabsContent>
    </Tabs>
  );
};

export default StudentResumeHub;
