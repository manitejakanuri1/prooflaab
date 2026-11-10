import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { matchScore, matchStatus } from "@/lib/matchStatus";
import { SCORE_HELP } from "@/lib/lotMarks";

export interface MatchLike {
  id: string;
  home_squad: string;
  away_squad: string;
  home_points: number | null;
  away_points: number | null;
  winner_squad?: string | null;
  decided_by?: string | null;
  status: string;
  round_number?: number | null;
  scheduled_at: string;
  stage?: string | null;
}

// Polish pass D: one match, opened from a Matches row (student or college). Only the stored match row.
const WHY: Record<string, string> = {
  score: "More points wins.",
  draw: "Same points: a draw.",
  no_activity: "Neither squad scored any points that week.",
  higher_seed: "Tie: higher-ranked squad wins.",
};

const MatchDetailDialog = ({ match, names, onClose, onOpenSquad }: {
  match: MatchLike | null;
  names: Record<string, string>;
  onClose: () => void;
  onOpenSquad?: (squadId: string) => void;
}) => (
  <Dialog open={Boolean(match)} onOpenChange={(v) => !v && onClose()}>
    <DialogContent className="max-w-md">
      {match && (
        <>
          <DialogHeader>
            <DialogTitle>
              {names[match.home_squad] ?? "?"} <span className="font-normal text-muted-foreground">vs</span> {names[match.away_squad] ?? "?"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              {match.round_number ? `Week ${match.round_number} · ` : ""}
              {match.stage && match.stage !== "league" ? `${match.stage} · ` : ""}
              {format(new Date(match.scheduled_at), "EEEE d MMM, h:mm a")}
            </p>
            <p><span className="font-medium">Status:</span> {matchStatus(match)}</p>
            <p><span className="font-medium">Week points:</span> {matchScore(match)}</p>
            {match.winner_squad && <p><span className="font-medium">Winner:</span> {names[match.winner_squad] ?? "?"}</p>}
            {match.decided_by && WHY[match.decided_by] && <p className="text-muted-foreground">{WHY[match.decided_by]}</p>}
            <p className="text-xs text-muted-foreground">{SCORE_HELP.squad}</p>
          </div>
          {onOpenSquad && (
            <div className="flex flex-wrap gap-2 pt-2">
              {[match.home_squad, match.away_squad].map((id) => (
                <Button key={id} size="sm" variant="outline" onClick={() => { onClose(); onOpenSquad(id); }}>
                  Open {names[id] ?? "squad"}
                </Button>
              ))}
            </div>
          )}
        </>
      )}
    </DialogContent>
  </Dialog>
);

export default MatchDetailDialog;
