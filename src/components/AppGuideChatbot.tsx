import { useState, useRef, useEffect } from "react";
import { MessageCircleQuestion, X, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

interface ChatMessage {
  role: "user" | "guide";
  text: string;
}

const AppGuideChatbot = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "guide", text: "Hey! I can walk you through any part of ProofLabAI — what are you trying to find?" },
  ]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  if (!user) return null;

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const history = messages;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("app-guide-chat", {
        body: { message: text, history },
      });
      if (error) throw error;
      setMessages((m) => [...m, { role: "guide", text: data?.reply || "Not sure, try rephrasing that?" }]);
    } catch {
      setMessages((m) => [...m, { role: "guide", text: "Couldn't reach the guide right now — try again in a bit." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {open && (
        <div className="mb-3 w-80 sm:w-96 h-[28rem] bg-card border border-border rounded-xl shadow-xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
            <span className="font-medium text-sm text-foreground">App Guide</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
            <div className="space-y-2">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`text-sm rounded-lg px-3 py-2 max-w-[85%] ${
                    m.role === "user"
                      ? "ml-auto bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {m.text}
                </div>
              ))}
              {loading && (
                <div className="bg-muted text-muted-foreground text-sm rounded-lg px-3 py-2 max-w-[85%] flex items-center gap-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> thinking...
                </div>
              )}
            </div>
          </div>
          <div className="p-2 border-t border-border flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Ask how to do something..."
              className="text-sm"
            />
            <Button size="icon" onClick={send} disabled={loading || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      <Button
        size="icon"
        className="h-12 w-12 rounded-full shadow-lg"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircleQuestion className="h-5 w-5" />}
      </Button>
    </div>
  );
};

export default AppGuideChatbot;
