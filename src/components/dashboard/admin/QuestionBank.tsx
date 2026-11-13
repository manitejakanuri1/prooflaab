import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useInfiniteQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff } from "lucide-react";

type Status = "draft" | "approved" | "hidden";

interface BankItem {
  id: string; question: string; answer_notes: string | null; topic: string | null; skill: string | null;
  difficulty: string | null; kind: string; status: Status; created_at: string;
  page_title: string | null; page_url: string | null;
}
interface Bank {
  counts: { draft: number; approved: number; hidden: number; untagged: number; matching: number };
  items: BankItem[];
}

// S2: {item} template placeholders shown as "<your resume item>"
const cleanItem = (s: string | null | undefined): string => (s ?? "").replace(/\{item\}/g, "<your resume item>");

const TABS: { id: Status; label: string }[] = [
  { id: "approved", label: "Live" },
  { id: "hidden", label: "Hidden" },
];

/**
 * Admin > Work > Question bank: the questions the crawler, admin material and college material were cut into.
 * Owner 31 Oct 2026 (migration 200): they go live straight away and become Daily Lots (week 2 onwards, picked
 * for the student's weak skills). Hiding one takes it out of the picker. The skill tag is set by the database
 * from the fixed skill list; "no skill" means no listed skill matched.
 */
const QuestionBank = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>("approved");
  const [search, setSearch] = useState("");

  // A6 (migration 541): search and "Load more" pages of 100, newest first, on a (created_at, id) cursor.
  const { data: pages, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["admin-question-bank", status, search.trim()],
    initialPageParam: null as { ts: string; id: string } | null,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc("admin_question_bank_page" as never, {
        _status: status, _q: search.trim() || null, _limit: 100,
        _after_ts: pageParam?.ts ?? null, _after_id: pageParam?.id ?? null,
      } as never);
      if (error) throw error;
      return data as unknown as Bank;
    },
    getNextPageParam: (last) => {
      const end = last.items[last.items.length - 1];
      return last.items.length === 100 && end ? { ts: end.created_at, id: end.id } : undefined;
    },
    placeholderData: keepPreviousData,
  });
  const data = pages && { counts: pages.pages[0].counts, items: pages.pages.flatMap((p) => p.items) };

  const move = async (item: BankItem, to: Status) => {
    const { error } = await supabase.rpc("admin_set_question_status" as never, { _id: item.id, _status: to } as never);
    if (error) return toast({ title: "Not changed", description: error.message, variant: "destructive" });
    toast({ title: to === "approved" ? "Live again" : "Hidden: no student gets it from now on" });
    void qc.invalidateQueries({ queryKey: ["admin-question-bank"] });
  };

  if (isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (error || !data) return <p className="text-sm text-alert">Could not load the question bank.</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Question bank</h1>
        <p className="text-sm text-muted-foreground">
          Questions written from crawled pages and from added material. They are live straight away and become
          Daily Lots from a student's second week, picked for their weak skills. Hide any you do not want used.
        </p>
        <p className="text-sm text-muted-foreground" data-testid="qb-untagged">Untagged (no listed skill): {data.counts.untagged}</p>
      </div>

      <Input className="max-w-md" placeholder="Search questions, topics or skills…" value={search}
        onChange={(e) => setSearch(e.target.value)} aria-label="Search questions" />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Question status">
        {TABS.map((t) => (
          <Button key={t.id} size="sm" role="tab" aria-selected={status === t.id}
            variant={status === t.id ? "default" : "outline"} onClick={() => setStatus(t.id)}>
            {t.label} ({data.counts[t.id]})
          </Button>
        ))}
      </div>

      {data.items.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          {search.trim() ? "No question matches that search." : status === "approved"
            ? "No questions yet. They appear here after the Sunday crawl, or straight away when material is added in Resources."
            : "Nothing hidden."}
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {data.items.map((q) => (
            <Card key={q.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{q.kind}</Badge>
                  {q.difficulty && <Badge variant="outline">{q.difficulty}</Badge>}
                  <Badge variant={q.skill ? "secondary" : "outline"}>{q.skill ?? "no skill matched"}</Badge>
                  {q.topic && <span className="text-xs text-muted-foreground">{cleanItem(q.topic)}</span>}
                </div>
                <p className="whitespace-pre-wrap text-sm">{cleanItem(q.question)}</p>
                {q.answer_notes && (
                  <p className="whitespace-pre-wrap text-xs text-muted-foreground border-l-2 pl-3">{cleanItem(q.answer_notes)}</p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground truncate max-w-[60%]">
                    From: {cleanItem(q.page_title || q.page_url) || "a crawled page"}
                  </span>
                  <div className="flex gap-2">
                    {q.status !== "approved" && (
                      <Button size="sm" onClick={() => void move(q, "approved")}><Eye className="h-4 w-4 mr-1" />Make live</Button>
                    )}
                    {q.status !== "hidden" && (
                      <Button size="sm" variant="outline" onClick={() => void move(q, "hidden")}><EyeOff className="h-4 w-4 mr-1" />Hide</Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground" data-testid="qb-range">
            <span>Showing 1-{data.items.length} of {data.counts.matching}</span>
            {hasNextPage && (
              <Button size="sm" variant="outline" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
                {isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default QuestionBank;
