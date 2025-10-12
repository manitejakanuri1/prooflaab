import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useStudentProfile } from "@/hooks/useStudentProfile";
import { useStudentCredits } from "@/hooks/useStudentCredits";
import { Sparkles, Edit3, Coins } from "lucide-react";
import ManualTaskForm from "./create-task/ManualTaskForm";
import AITaskGenerator from "./create-task/AITaskGenerator";
import { Alert, AlertDescription } from "@/components/ui/alert";

const StudentCreateTaskPage = () => {
  const { profile } = useStudentProfile();
  const { credits, loading: creditsLoading } = useStudentCredits(profile?.id);
  const [activeTab, setActiveTab] = useState("manual");

  return (
    <div className="space-y-6">
      {/* Header with Credits Counter */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Create a Task</h1>
          <p className="text-muted-foreground mt-1">
            Create your own learning tasks to track your progress
          </p>
        </div>
        
        {!creditsLoading && credits && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 border border-primary/20">
            <Coins className="w-5 h-5 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Credits Left</p>
              <p className="text-2xl font-bold text-primary">
                {credits.credits_available}/10
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Info Alert */}
      <Alert>
        <AlertDescription>
          💡 Each self-created task costs 10 credits. Credits reset daily at midnight. 
          Private tasks help you learn but won't appear on your public portfolio.
        </AlertDescription>
      </Alert>

      {/* Main Content */}
      <Card>
        <CardHeader>
          <CardTitle>Choose Creation Method</CardTitle>
          <CardDescription>
            Create tasks manually or let AI generate one based on your learning goals
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2 bg-muted">
              <TabsTrigger 
                value="manual" 
                className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                <Edit3 className="w-4 h-4" />
                Manual Task
              </TabsTrigger>
              <TabsTrigger 
                value="ai" 
                className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                <Sparkles className="w-4 h-4" />
                AI Generator
              </TabsTrigger>
            </TabsList>

            <TabsContent value="manual" className="mt-6">
              <ManualTaskForm studentId={profile?.id} />
            </TabsContent>

            <TabsContent value="ai" className="mt-6">
              <AITaskGenerator studentId={profile?.id} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default StudentCreateTaskPage;