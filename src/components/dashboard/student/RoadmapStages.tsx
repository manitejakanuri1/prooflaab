import { Flag } from "lucide-react";

export interface RoadmapStage {
  title: string;
  why: string;
  action: string;
}

export function parseStages(roadmap: string): RoadmapStage[] | null {
  try {
    const parsed = JSON.parse(roadmap);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((s) => typeof s?.title === "string" && typeof s?.why === "string" && typeof s?.action === "string")
    ) {
      return parsed;
    }
  } catch {
    // pre-stage-format roadmap text — fall back to plain rendering below
  }
  return null;
}

// Older graded assessments stored the roadmap as free-text prose, not the
// staged JSON shape — render those as-is instead of breaking on them.
export function RoadmapStages({ roadmap }: { roadmap: string }) {
  const stages = parseStages(roadmap);

  if (!stages) {
    return <p className="text-sm text-muted-foreground whitespace-pre-line">{roadmap}</p>;
  }

  return (
    <div className="space-y-3">
      {stages.map((stage, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
              {i + 1}
            </div>
            {i < stages.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
          </div>
          <div className="pb-3">
            <p className="text-sm font-semibold leading-snug">{stage.title}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{stage.why}</p>
            <p className="text-sm mt-1 flex items-start gap-1.5">
              <Flag className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" />
              <span>{stage.action}</span>
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
