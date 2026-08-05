import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldAlert, KeyRound, Gauge } from "lucide-react";

interface EventRow {
  id: string;
  event_type: string;
  severity: "info" | "warning" | "critical";
  source: "server" | "client";
  email: string | null;
  ip: string | null;
  user_agent: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

const LIMIT = 200;

const LABEL: Record<string, string> = {
  login_failed: "Failed sign-in",
  login_succeeded: "Successful sign-in",
  signup_failed: "Failed signup",
  password_reset_requested: "Password reset requested",
  email_verification_resent: "Verification email resent",
  rate_limited: "Rate limit hit",
  ai_rate_limited: "AI rate limit hit",
};

const severityVariant = (s: string) =>
  s === "critical" ? "destructive" : s === "warning" ? "default" : "secondary";

const timeAgo = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
};

const SecurityEvents = () => {
  const [rows, setRows] = useState<EventRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const load = () => {
    setRows(null);
    supabase
      .from("security_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(LIMIT)
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        else setRows((data ?? []) as EventRow[]);
      });
  };

  useEffect(load, []);

  // Repeated failures against one address is the pattern worth surfacing;
  // a single failure is almost always somebody mistyping their own password.
  const repeatedFailures = useMemo(() => {
    if (!rows) return [];
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (r.event_type !== "login_failed" || !r.email) continue;
      if (new Date(r.created_at).getTime() < since) continue;
      counts.set(r.email, (counts.get(r.email) ?? 0) + 1);
    }
    return [...counts.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-lg">Security Events</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">{error}</p></CardContent>
      </Card>
    );
  }

  if (!rows) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground p-6">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading events…
      </div>
    );
  }

  const failures = rows.filter((r) => r.event_type === "login_failed").length;
  const limited = rows.filter((r) => r.event_type.endsWith("rate_limited")).length;
  const shown = filter === "all" ? rows : rows.filter((r) => r.event_type === filter);
  const types = [...new Set(rows.map((r) => r.event_type))];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <KeyRound className="h-4 w-4" /> Failed sign-ins
            </div>
            <p className="text-2xl font-bold">{failures}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Gauge className="h-4 w-4" /> Rate limits hit
            </div>
            <p className="text-2xl font-bold">{limited}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <ShieldAlert className="h-4 w-4" /> Addresses under repeated attempts
            </div>
            <p className="text-2xl font-bold">{repeatedFailures.length}</p>
          </CardContent>
        </Card>
      </div>

      {repeatedFailures.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Worth a look</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Three or more failed sign-ins against the same address in the last 24 hours.
              Usually a locked-out student; occasionally someone guessing.
            </p>
            {repeatedFailures.map(([email, n]) => (
              <div key={email} className="flex justify-between text-sm border-b py-2 last:border-0">
                <span className="font-medium">{email}</span>
                <span className="text-muted-foreground">{n} attempts</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-lg">Recent events</CardTitle>
          <Button variant="outline" size="sm" onClick={load}>Refresh</Button>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 mb-4">
            <Button
              size="sm"
              variant={filter === "all" ? "default" : "outline"}
              onClick={() => setFilter("all")}
            >
              All
            </Button>
            {types.map((t) => (
              <Button
                key={t}
                size="sm"
                variant={filter === t ? "default" : "outline"}
                onClick={() => setFilter(t)}
              >
                {LABEL[t] ?? t}
              </Button>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing recorded yet. Events appear here as people sign in and as limits are hit.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Who</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {timeAgo(r.created_at)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={severityVariant(r.severity)}>
                          {LABEL[r.event_type] ?? r.event_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{r.email ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{r.ip ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {r.detail ? Object.entries(r.detail).map(([k, v]) => `${k}: ${v}`).join(", ") : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <p className="text-xs text-muted-foreground mt-4">
            Sign-in events are reported by the browser, so someone calling the auth API
            directly will not appear here. Rate limit events are recorded server-side and
            cannot be suppressed. Showing the most recent {LIMIT}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default SecurityEvents;
