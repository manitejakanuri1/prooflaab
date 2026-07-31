import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface SkillGapData {
  verified: string[];
  needs_improvement: string[];
  missing: string[];
}

const GROUPS: { key: keyof SkillGapData; label: string; icon: typeof CheckCircle2; className: string }[] = [
  { key: "verified", label: "Verified Skills", icon: CheckCircle2, className: "text-green-600 border-green-600/30 bg-green-600/10" },
  { key: "needs_improvement", label: "Needs Improvement", icon: AlertTriangle, className: "text-amber-600 border-amber-600/30 bg-amber-600/10" },
  { key: "missing", label: "Missing Skills", icon: XCircle, className: "text-red-600 border-red-600/30 bg-red-600/10" },
];

// Null when the target role isn't in the known role list — nothing to render.
export function SkillGap({ skillGap }: { skillGap: SkillGapData | null | undefined }) {
  if (!skillGap) return null;

  return (
    <div className="space-y-3">
      {GROUPS.map(({ key, label, icon: Icon, className }) => (
        skillGap[key].length > 0 && (
          <div key={key}>
            <p className="text-sm font-medium mb-1.5 flex items-center gap-1.5">
              <Icon className="h-4 w-4" /> {label}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {skillGap[key].map((skill) => (
                <Badge key={skill} variant="outline" className={className}>{skill}</Badge>
              ))}
            </div>
          </div>
        )
      ))}
    </div>
  );
}
