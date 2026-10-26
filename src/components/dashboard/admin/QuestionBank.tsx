import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Check, EyeOff, Undo2 } from "lucide-react";

type Status = "draft" | "approved" | "hidden";

interface BankItem {
  id: string; question: string; answer_notes: string | null; topic: string | null; skill: string | null;
  difficulty: string | null; kind: string; status: Status; created_at: string;
  page_title: string | null; page_url: string | null;
}
interface Bank {
  counts: { draft: number; approved: number; hidden: number; untagged: number };
  items: BankItem[];
}

const TABS: { id: Status; label: string }[] = [
  { id: "draft", label: "To review" },
  { id: "approved", label: "Approved" },
  { id: "hidden", label: "Hidden" },
];

/**
 * Admin > Work > Question bank: the small questions the crawler's pages were cut into (migration 147).
 * They arrive as drafts. Approving one only marks it good: nothing picks Lots from the bank yet.
 * The skill tag is set by the database from the fixed skill list; "no skill" means no listed skill matched.
 */
const QuestionBank = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>("draft");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-question-bank", status],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_question_bank" as never, { _status: status, _limit: 100 } as never);
      if (error) throw error;
      return data as unknown as Bank;
    },
  });

  const move = async (item: BankItem, to: Status) => {
    const { error } = await supabase.rpc("admin_set_question_status" as never, { _id: item.id, _status: to } as never);
    if (error) return toast({ title: "Not changed", description: error.message, variant: "destructive" });
    toast({ title: to === "approved" ? "Approved" : to === "hidden" ? "Hidden" : "Back to review" });
    void qc.invalidateQueries({ queryKey: ["admin-question-bank"] });
  };

  if (isLoading) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (error || !data) return <p className="text-sm text-alert">Could not load the question bank.</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Question bank</h1>
        <p className="text-sm text-muted-foreground">
          Small questions cut from crawled pages. Review them here; approving does not change which Lot a student gets.
          {data.counts.untagged > 0 && ` ${data.counts.untagged} match no listed skill.`}
        </p>
      </div>

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
          {status === "draft"
            ? "Nothing to review. Questions appear here after the crawler runs with the question bank switched on."
            : "Nothing here yet."}
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
                  {q.topic && <span className="text-xs text-muted-foreground">{q.topic}</span>}
                </div>
                <p className="whitespace-pre-wrap text-sm">{q.question}</p>
                {q.answer_notes && (
                  <p className="whitespace-pre-wrap text-xs text-muted-foreground border-l-2 pl-3">{q.answer_notes}</p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground truncate max-w-[60%]">
                    From: {q.page_title || q.page_url || "a crawled page"}
                  </span>
                  <div className="flex gap-2">
                    {q.status !== "approved" && (
                      <Button size="sm" onClick={() => void move(q, "approved")}><Check className="h-4 w-4 mr-1" />Approve</Button>
                    )}
                    {q.status !== "hidden" && (
                      <Button size="sm" variant="outline" onClick={() => void move(q, "hidden")}><EyeOff className="h-4 w-4 mr-1" />Hide</Button>
                    )}
                    {q.status !== "draft" && (
                      <Button size="sm" variant="ghost" onClick={() => void move(q, "draft")}><Undo2 className="h-4 w-4 mr-1" />Back to review</Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default QuestionBank;
