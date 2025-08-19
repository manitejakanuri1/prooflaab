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
import { Search, Shield, TrendingUp, TrendingDown, School, Building2 } from "lucide-react";

interface XPModerationProps {
  type: 'xp-moderation' | 'college-oversight' | 'startup-oversight';
}

const XPModeration = ({ type }: XPModerationProps) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [adjustmentAmount, setAdjustmentAmount] = useState(0);
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [adjustmentType, setAdjustmentType] = useState<'XP' | 'Trust'>('XP');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: items, isLoading } = useQuery({
    queryKey: [`admin-${type}`, searchTerm],
    queryFn: async () => {
      if (type === 'xp-moderation') {
        let query = supabase
          .from('student_profiles')
          .select('*');

        if (searchTerm) {
          query = query.ilike('full_name', `%${searchTerm}%`);
        }

        const { data, error } = await query.order('total_xp', { ascending: false });
        if (error) throw error;
        return data;
      } else if (type === 'college-oversight') {
        const { data, error } = await supabase
          .from('colleges')
          .select(`
            *,
            tasks:tasks!tasks_created_by_startup_id_fkey(count)
          `);
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await supabase
          .from('startups')
          .select(`
            *,
            tasks:tasks!tasks_created_by_startup_id_fkey(count)
          `);
        if (error) throw error;
        return data;
      }
    }
  });

  const adjustmentMutation = useMutation({
    mutationFn: async ({ studentId, type, amount, reason }: { 
      studentId: string; 
      type: 'XP' | 'Trust'; 
      amount: number; 
      reason: string; 
    }) => {
      // Log the adjustment
      await supabase
        .from('manual_adjustment_log')
        .insert({
          student_id: studentId,
          admin_id: 'admin-id', // Replace with actual admin ID
          adjustment_type: type,
          amount,
          reason
        });

      // Get current values and update
      const { data: currentProfile } = await supabase
        .from('student_profiles')
        .select('total_xp, trust_score')
        .eq('id', studentId)
        .single();

      if (!currentProfile) throw new Error('Student not found');

      const updates: any = {};
      if (type === 'XP') {
        updates.total_xp = (currentProfile.total_xp || 0) + amount;
      } else {
        updates.trust_score = Math.min(Math.max((currentProfile.trust_score || 0) + amount, 0), 100);
      }

      const { error } = await supabase
        .from('student_profiles')
        .update(updates)
        .eq('id', studentId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`admin-${type}`] });
      toast({
        title: "Success",
        description: `${adjustmentType} adjustment applied successfully.`,
      });
      setSelectedItem(null);
      setAdjustmentAmount(0);
      setAdjustmentReason("");
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to apply adjustment: ${error.message}`,
        variant: "destructive",
      });
    }
  });

  const handleAdjustment = (student: any) => {
    setSelectedItem(student);
  };

  const confirmAdjustment = () => {
    if (!selectedItem || adjustmentAmount === 0) return;

    adjustmentMutation.mutate({
      studentId: selectedItem.id,
      type: adjustmentType,
      amount: adjustmentAmount,
      reason: adjustmentReason
    });
  };

  const getIcon = () => {
    switch (type) {
      case 'xp-moderation': return Shield;
      case 'college-oversight': return School;
      case 'startup-oversight': return Building2;
    }
  };

  const Icon = getIcon();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse">
          <div className="h-8 bg-muted rounded w-1/4 mb-4"></div>
          <div className="h-10 bg-muted rounded mb-4"></div>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 bg-muted rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-6 w-6" />
          <h2 className="text-2xl font-bold">
            {type === 'xp-moderation' ? 'Trust & XP Moderation' :
             type === 'college-oversight' ? 'College Oversight' : 'Startup Oversight'}
          </h2>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder={`Search ${type === 'xp-moderation' ? 'students' : type.split('-')[0]}...`}
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
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                {type === 'xp-moderation' && (
                  <>
                    <TableHead>XP</TableHead>
                    <TableHead>Trust Score</TableHead>
                  </>
                )}
                {type !== 'xp-moderation' && (
                  <>
                    <TableHead>Status</TableHead>
                    <TableHead>Tasks</TableHead>
                  </>
                )}
                <TableHead>Created</TableHead>
                {type === 'xp-moderation' && (
                  <TableHead className="text-right">Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items?.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">
                    {type === 'xp-moderation' ? item.full_name : item.name}
                  </TableCell>
                  <TableCell>{item.email}</TableCell>
                  {type === 'xp-moderation' && (
                    <>
                      <TableCell>{item.total_xp || 0}</TableCell>
                      <TableCell>
                        <Badge variant={
                          (item.trust_score || 0) >= 80 ? 'default' :
                          (item.trust_score || 0) >= 60 ? 'secondary' : 'destructive'
                        }>
                          {item.trust_score || 0}
                        </Badge>
                      </TableCell>
                    </>
                  )}
                  {type !== 'xp-moderation' && (
                    <>
                      <TableCell>
                        <Badge variant={
                          item.verification_status === 'approved' ? 'default' : 'secondary'
                        }>
                          {item.verification_status || 'pending'}
                        </Badge>
                      </TableCell>
                      <TableCell>{(item as any).tasks?.length || 0}</TableCell>
                    </>
                  )}
                  <TableCell>
                    {new Date(item.created_at).toLocaleDateString()}
                  </TableCell>
                  {type === 'xp-moderation' && (
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAdjustment(item)}
                      >
                        Adjust
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Adjustment Dialog */}
      <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manual Adjustment</DialogTitle>
            <DialogDescription>
              Adjust XP or Trust Score for {selectedItem?.full_name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button
                variant={adjustmentType === 'XP' ? 'default' : 'outline'}
                onClick={() => setAdjustmentType('XP')}
              >
                XP
              </Button>
              <Button
                variant={adjustmentType === 'Trust' ? 'default' : 'outline'}
                onClick={() => setAdjustmentType('Trust')}
              >
                Trust Score
              </Button>
            </div>
            <div>
              <label className="text-sm font-medium">Adjustment Amount</label>
              <Input
                type="number"
                value={adjustmentAmount}
                onChange={(e) => setAdjustmentAmount(parseInt(e.target.value) || 0)}
                placeholder="Enter positive or negative value"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Reason</label>
              <Input
                value={adjustmentReason}
                onChange={(e) => setAdjustmentReason(e.target.value)}
                placeholder="Reason for adjustment"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedItem(null)}>
              Cancel
            </Button>
            <Button
              onClick={confirmAdjustment}
              disabled={adjustmentMutation.isPending || adjustmentAmount === 0}
            >
              {adjustmentMutation.isPending ? 'Applying...' : 'Apply Adjustment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default XPModeration;