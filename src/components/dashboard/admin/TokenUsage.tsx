import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Coins, Users, Layers } from "lucide-react";

interface UsageRow {
  student_id: string | null;
  email: string | null;
  full_name: string | null;
  feature: string;
  provider: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  last_used: string;
}

const nf = new Intl.NumberFormat();

/** Sums rows by a key, biggest first. */
function rollUp(rows: UsageRow[], key: (r: UsageRow) => string) {
  const map = new Map<string, { label: string; calls: number; tokens: number }>();
  for (const r of rows) {
    const label = key(r);
    const cur = map.get(label) ?? { label, calls: 0, tokens: 0 };
    cur.calls += Number(r.calls) || 0;
    cur.tokens += Number(r.total_tokens) || 0;
    map.set(label, cur);
  }
  return [...map.values()].sort((a, b) => b.tokens - a.tokens);
}

const TokenUsage = () => {
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("llm_usage_by_student")
      .select("*")
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else setRows((data ?? []) as UsageRow[]);
      });
  }, []);

  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-lg">Token Usage</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">{error}</p></CardContent>
      </Card>
    );
  }

  if (!rows) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground p-6">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading usage…
      </div>
    );
  }

  const totalTokens = rows.reduce((n, r) => n + (Number(r.total_tokens) || 0), 0);
  const totalCalls = rows.reduce((n, r) => n + (Number(r.calls) || 0), 0);
  // Rows with no student are real calls that simply were not attributed, so they
  // still count towards the total — they are just excluded from the per-student view.
  const byStudent = rollUp(rows.filter((r) => r.email), (r) => r.email!);
  const byFeature = rollUp(rows, (r) => r.feature);
  const unattributed = rows
    .filter((r) => !r.email)
    .reduce((n, r) => n + (Number(r.total_tokens) || 0), 0);

  const bar = (tokens: number, max: number) =>
    `${max > 0 ? Math.max(2, Math.round((tokens / max) * 100)) : 0}%`;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Coins className="h-4 w-4" /> Total tokens
            </div>
            <p className="text-2xl font-bold">{nf.format(totalTokens)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Layers className="h-4 w-4" /> AI calls
            </div>
            <p className="text-2xl font-bold">{nf.format(totalCalls)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Users className="h-4 w-4" /> Students tracked
            </div>
            <p className="text-2xl font-bold">{byStudent.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">By feature</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {byFeature.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing recorded yet. Usage appears here once students use an AI feature.
            </p>
          )}
          {byFeature.map((f) => (
            <div key={f.label}>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium">{f.label}</span>
                <span className="text-muted-foreground">
                  {nf.format(f.tokens)} · {f.calls} call{f.calls === 1 ? "" : "s"}
                </span>
              </div>
              <div className="h-2 rounded bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary"
                  style={{ width: bar(f.tokens, byFeature[0].tokens) }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">By student</CardTitle></CardHeader>
        <CardContent>
          {byStudent.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No per-student usage yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byStudent.map((s) => (
                    <TableRow key={s.label}>
                      <TableCell className="font-medium">{s.label}</TableCell>
                      <TableCell className="text-right">{nf.format(s.calls)}</TableCell>
                      <TableCell className="text-right">{nf.format(s.tokens)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {unattributed > 0 && (
            <p className="text-xs text-muted-foreground mt-4">
              <Badge variant="outline" className="mr-2">{nf.format(unattributed)}</Badge>
              tokens came from calls that record the feature but not the student —
              included in the totals above, not in this table.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TokenUsage;
