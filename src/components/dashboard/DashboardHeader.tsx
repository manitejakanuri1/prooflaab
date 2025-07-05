
import { Calendar } from "lucide-react";

interface DashboardHeaderProps {
  studentName: string;
}

export default function DashboardHeader({ studentName }: DashboardHeaderProps) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <div className="mb-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">
        Welcome back, {studentName}! 👋
      </h1>
      <div className="flex items-center text-gray-600">
        <Calendar className="h-4 w-4 mr-2" />
        <span>{today}</span>
      </div>
    </div>
  );
}
