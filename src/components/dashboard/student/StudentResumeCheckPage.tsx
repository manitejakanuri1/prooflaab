import ResumeCheckFlow from "./ResumeCheckFlow";

interface StudentResumeCheckPageProps {
  onNavigateTab?: (tab: string) => void;
}

const StudentResumeCheckPage = ({ onNavigateTab }: StudentResumeCheckPageProps) => {
  return <ResumeCheckFlow onNavigateTab={onNavigateTab} />;
};

export default StudentResumeCheckPage;
