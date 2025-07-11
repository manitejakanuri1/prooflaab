
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useCreateTask } from "@/hooks/useCreateTask";

export default function CreateTaskButton() {
  const { createTask, loading } = useCreateTask();

  const handleCreateTask = async () => {
    const taskData = {
      title: "Build React Dashboard",
      description: "Design and build a functional student dashboard using React.js and Tailwind.",
      due_date: "2025-12-15T23:59:59.000Z",
      status: "Assigned",
      xp_reward: 150,
      xp: 150
    };

    try {
      await createTask(taskData);
      console.log('Task creation completed');
    } catch (error) {
      console.error('Failed to create task:', error);
    }
  };

  return (
    <Button
      onClick={handleCreateTask}
      disabled={loading}
      size="sm"
      className="bg-blue-600 hover:bg-blue-700 text-white"
    >
      <Plus className="h-4 w-4 mr-2" />
      {loading ? "Creating..." : "Add Sample Task"}
    </Button>
  );
}
