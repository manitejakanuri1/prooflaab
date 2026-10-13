import { useCallback, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Ask = { title: string; points?: string[]; action: string };

/**
 * An in-app "are you sure?" box with Cancel and one red button (13 Oct, owner: no typing).
 * Cancel has the focus, and closing the box any other way counts as Cancel.
 *   const [confirmBox, ask] = useConfirm();
 *   if (!(await ask({ title: "Delete X?", points: ["..."], action: "Delete" }))) return;
 *   ... render {confirmBox} once in the page.
 */
export function useConfirm(): [ReactNode, (a: Ask) => Promise<boolean>] {
  const [open, setOpen] = useState<Ask | null>(null);
  const resolver = useRef<(ok: boolean) => void>();

  const ask = useCallback((a: Ask) => new Promise<boolean>((resolve) => {
    resolver.current = resolve;
    setOpen(a);
  }), []);

  const finish = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = undefined;
    setOpen(null);
  };

  const box = (
    <Dialog open={!!open} onOpenChange={(o) => { if (!o) finish(false); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{open?.title}</DialogTitle>
          <DialogDescription asChild>
            <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
              {(open?.points ?? []).map((p) => <li key={p}>{p}</li>)}
              <li>This cannot be undone.</li>
            </ul>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" autoFocus onClick={() => finish(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => finish(true)}>{open?.action}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return [box, ask];
}
