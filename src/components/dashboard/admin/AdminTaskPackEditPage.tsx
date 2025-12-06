import React from "react";
import { useParams } from "react-router-dom";
import AdminTaskPackForm from "./AdminTaskPackForm";

// Mock data for editing - will be replaced with API fetch
const mockPacksData: Record<string, {
  id: string;
  title: string;
  description: string;
  difficulty: "Beginner" | "Intermediate" | "Advanced";
  isPublished: boolean;
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    difficulty: "Beginner" | "Intermediate" | "Advanced";
    order: number;
  }>;
}> = {
  "pack-1": {
    id: "pack-1",
    title: "Full Stack Beginner Pack",
    description: "Learn the fundamentals of full stack development with hands-on projects.",
    difficulty: "Beginner",
    isPublished: true,
    tasks: [
      {
        id: "task-1",
        title: "Build a Simple HTML Page",
        description: "Create a personal portfolio page using HTML and CSS basics.",
        difficulty: "Beginner",
        order: 1,
      },
      {
        id: "task-2",
        title: "Add JavaScript Interactivity",
        description: "Implement form validation and dynamic content updates.",
        difficulty: "Beginner",
        order: 2,
      },
      {
        id: "task-3",
        title: "Create a REST API",
        description: "Build a simple Express.js API with CRUD operations.",
        difficulty: "Intermediate",
        order: 3,
      },
      {
        id: "task-4",
        title: "Connect Frontend to Backend",
        description: "Integrate your frontend with the REST API using fetch.",
        difficulty: "Intermediate",
        order: 4,
      },
      {
        id: "task-5",
        title: "Deploy Your Application",
        description: "Deploy your full stack app to a cloud platform.",
        difficulty: "Beginner",
        order: 5,
      },
    ],
  },
  "pack-2": {
    id: "pack-2",
    title: "React Advanced Patterns",
    description: "Master advanced React patterns including hooks, context, and performance optimization.",
    difficulty: "Advanced",
    isPublished: true,
    tasks: [
      {
        id: "task-1",
        title: "Custom Hooks Deep Dive",
        description: "Build reusable custom hooks for common patterns.",
        difficulty: "Advanced",
        order: 1,
      },
      {
        id: "task-2",
        title: "Context API Patterns",
        description: "Implement global state management with Context.",
        difficulty: "Advanced",
        order: 2,
      },
    ],
  },
  "pack-3": {
    id: "pack-3",
    title: "API Design Fundamentals",
    description: "Build RESTful APIs with proper authentication, validation, and documentation.",
    difficulty: "Intermediate",
    isPublished: false,
    tasks: [
      {
        id: "task-1",
        title: "RESTful API Basics",
        description: "Design and implement a RESTful API following best practices.",
        difficulty: "Intermediate",
        order: 1,
      },
    ],
  },
};

const AdminTaskPackEditPage = () => {
  const { packId } = useParams();
  
  // Get mock data for the pack
  const packData = packId ? mockPacksData[packId] : undefined;

  if (!packData) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Pack not found: {packId}</p>
      </div>
    );
  }

  return (
    <AdminTaskPackForm 
      mode="edit" 
      initialData={packData}
      packId={packId}
    />
  );
};

export default AdminTaskPackEditPage;
