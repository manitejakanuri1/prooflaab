
interface DashboardWelcomeProps {
  studentName: string;
}

export default function DashboardWelcome({ studentName }: DashboardWelcomeProps) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="mb-8">
      <h1 className="text-4xl font-bold text-gray-900 mb-2">
        Welcome back, {studentName} 👋
      </h1>
      <p className="text-gray-500">{today}</p>
    </div>
  );
}
