import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

interface Rule { type: string; enabled: boolean; sent_90d: number }

const words = (type: string) => type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/**
 * One switch per kind of in-app notification (migration 105). Off means the
 * database no longer creates that kind for anyone; notifications already sent
 * stay. The list is every kind sent in the last 90 days.
 */
const NotificationRulesDialog = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: rules, isLoading, error } = useQuery({
    queryKey: ["admin-notification-rules"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_notification_rules" as never);
      if (error) throw error;
      return (data ?? []) as unknown as Rule[];
    },
  });

  const setRule = useMutation({
    mutationFn: async (rule: { type: string; enabled: boolean }) => {
      const { error } = await supabase.rpc("admin_set_notification_rule" as never,
        { _type: rule.type, _enabled: rule.enabled } as never);
      if (error) throw error;
    },
    onSuccess: (_, rule) => {
      toast({ title: `${words(rule.type)}: ${rule.enabled ? "on" : "off"}` });
    },
    onError: (e: Error) => toast({ title: "Not changed", description: e.message, variant: "destructive" }),
    // Always re-read: the switch shows what the database holds, not what was clicked.
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["admin-notification-rules"] }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Notification rules</DialogTitle>
          <DialogDescription>
            Switch a kind of in-app notification off and it is no longer created for anyone. Notifications already
            sent are kept.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-red-600">Could not load the rules: {(error as Error).message}</p>
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !rules?.length ? (
          <p className="text-sm text-muted-foreground">No notifications have been sent in the last 90 days.</p>
        ) : (
          <div className="max-h-96 space-y-3 overflow-y-auto">
            {rules.map((r) => (
              <div key={r.type} className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor={`rule-${r.type}`}>{words(r.type)}</Label>
                  <p className="text-xs text-muted-foreground">{r.sent_90d} sent in the last 90 days</p>
                </div>
                <Switch id={`rule-${r.type}`} checked={r.enabled} disabled={setRule.isPending}
                  onCheckedChange={(enabled) => setRule.mutate({ type: r.type, enabled })} />
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default NotificationRulesDialog;
