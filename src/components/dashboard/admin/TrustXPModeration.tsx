import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Search, Shield, Edit, RotateCcw } from "lucide-react";

const TrustXPModeration = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [editXP, setEditXP] = useState(0);
  const [editTrust, setEditTrust] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: students, isLoading } = useQuery({
    queryKey: ['trust-xp-moderation', searchTerm],
    queryFn: async () => {
      let query = supabase
        .from('student_profiles')
        .select('*');

      if (searchTerm) {
        query = query.or(`full_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`);
      }

      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ studentId, xp, trust }: { 
      studentId: string; 
      xp: number; 
      trust: number; 
    }) => {
      const { error } = await supabase
        .from('student_profiles')
        .update({ 
          total_xp: xp,
          trust_score: Math.min(Math.max(trust, 0), 100)
        })
        .eq('id', studentId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trust-xp-moderation'] });
      toast({
        title: "Success",
        description: "Student data updated successfully.",
      });
      setSelectedStudent(null);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to update student: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const resetMutation = useMutation({
    mutationFn: async (studentId: string) => {
      const { error } = await supabase
        .from('student_profiles')
        .update({ 
          total_xp: 0,
          trust_score: 50
        })
        .eq('id', studentId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trust-xp-moderation'] });
      toast({
        title: "Success",
        description: "Student data reset successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to reset student data: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const handleEdit = (student: any) => {
    setSelectedStudent(student);
    setEditXP(student.total_xp || 0);
    setEditTrust(student.trust_score || 50);
  };

  const handleSave = () => {
    if (!selectedStudent) return;
    
    updateMutation.mutate({
      studentId: selectedStudent.id,
      xp: editXP,
      trust: editTrust
    });
  };

  const handleReset = (student: any) => {
    if (confirm(`Reset XP and Trust Score for ${student.full_name}?`)) {
      resetMutation.mutate(student.id);
    }
  };

  const paginatedStudents = students?.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil((students?.length || 0) / itemsPerPage);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse">
          <div className="h-8 bg-muted rounded w-1/3 mb-6"></div>
          <div className="h-10 bg-muted rounded mb-4"></div>
          <div className="space-y-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-16 bg-muted rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-primary/10">
          <Shield className="h-8 w-8 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">Trust & XP Moderation</h1>
          <p className="text-muted-foreground">Manage student XP and trust scores</p>
        </div>
      </div>

      <Card className="border-0 shadow-lg">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search students..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-semibold">Name</TableHead>
                <TableHead className="font-semibold">Email</TableHead>
                <TableHead className="font-semibold">XP</TableHead>
                <TableHead className="font-semibold">Trust Score</TableHead>
                <TableHead className="font-semibold">Created</TableHead>
                <TableHead className="font-semibold text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedStudents?.map((student) => (
                <TableRow key={student.id} className="hover:bg-muted/30">
                  <TableCell className="font-medium">{student.full_name}</TableCell>
                  <TableCell className="text-muted-foreground">{student.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono">
                      {student.total_xp || 0}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={
                      (student.trust_score || 0) >= 80 ? 'default' :
                      (student.trust_score || 0) >= 60 ? 'secondary' : 'destructive'
                    }>
                      {student.trust_score || 0}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(student.created_at).toLocaleDateString('en-GB')}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEdit(student)}
                        className="h-8 px-3"
                      >
                        <Edit className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleReset(student)}
                        className="h-8 px-3"
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Reset
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6">
              <p className="text-sm text-muted-foreground">
                Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, students?.length || 0)} of {students?.length || 0} students
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <span className="text-sm px-3 py-1 bg-muted rounded">
                  {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Modal */}
      <Dialog open={!!selectedStudent} onOpenChange={() => setSelectedStudent(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Student Data</DialogTitle>
            <DialogDescription>
              Update XP and Trust Score for {selectedStudent?.full_name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Current XP</label>
              <Input
                type="number"
                value={editXP}
                onChange={(e) => setEditXP(parseInt(e.target.value) || 0)}
                min="0"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Current Trust Score</label>
              <Input
                type="number"
                value={editTrust}
                onChange={(e) => setEditTrust(parseInt(e.target.value) || 0)}
                min="0"
                max="100"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedStudent(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TrustXPModeration;