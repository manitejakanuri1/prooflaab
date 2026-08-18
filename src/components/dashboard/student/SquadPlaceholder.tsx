import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users } from "lucide-react";

/**
 * Squad exists in the navigation before it exists in the database.
 *
 * The design deck makes Squad one of four destinations, so leaving it out of
 * the sidebar would misrepresent the product. Showing an empty page with no
 * explanation would look broken. This says plainly what is coming and what is
 * not here yet.
 */
const SquadPlaceholder = () => (
  <Card>
    <CardHeader>
      <CardTitle className="text-lg flex items-center gap-2">
        <Users className="h-5 w-5" />
        Squad
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground max-w-prose">
        You are not in a squad yet. When squads open, this is where you will see your
        team's rank and points, the eleven members and how active each one is, your
        upcoming matches and results, and the full standings.
      </p>
      <div className="grid gap-2 sm:grid-cols-4">
        {["Overview", "Members", "Matches", "Standings"].map((view) => (
          <div
            key={view}
            className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground"
          >
            {view}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Four views inside this one page — not four menu items.
      </p>
    </CardContent>
  </Card>
);

export default SquadPlaceholder;
