import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const AdminTaskPackEditPage = () => {
  const navigate = useNavigate();
  const { packId } = useParams();

  return (
    <div className="space-y-6">
      {/* Header with Back Button */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/admin/task-packs")}
          className="h-9 w-9"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2">
            <Package className="h-7 w-7 text-primary" />
            Edit Task Pack
          </h1>
          <p className="text-muted-foreground mt-1">
            Editing pack: {packId}
          </p>
        </div>
      </div>

      {/* Placeholder Content */}
      <Card>
        <CardHeader>
          <CardTitle>Pack Details</CardTitle>
          <CardDescription>
            This form will be implemented in the next step
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>Task Pack edit form coming soon...</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminTaskPackEditPage;
