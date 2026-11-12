import { Button } from "@/components/ui/button";

/**
 * Owner E2E S8/Y4 (12 Nov 2026): a panel whose read failed (often a 502) said nothing and stayed blank.
 * One line and a Try again button instead.
 */
export default function LoadFailed({ what = "this", onRetry }: { what?: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-4" role="alert" data-testid="load-failed">
      <p className="text-sm text-muted-foreground">Could not load {what}.</p>
      <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>
    </div>
  );
}
