import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import RecruiterDashboardSidebar from "@/components/dashboard/recruiter/RecruiterDashboardSidebar";
import RecruiterDashboardContent from "@/components/dashboard/recruiter/RecruiterDashboardContent";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Menu } from "lucide-react";

/**
 * The recruiter dashboard, laid out like the other three: a sidebar of four
 * destinations and one content area.
 *
 * The extra step here is the recruiter record itself. A signed-in user with the
 * recruiter role may still have no company on file — that happens on the first
 * visit after signing up — so this asks for it once rather than showing an
 * empty dashboard that looks broken.
 */
const RecruiterDashboard = () => {
  const [activeTab, setActiveTab] = useState("home");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hasRecord, setHasRecord] = useState<boolean | null>(null);
  const [company, setCompany] = useState("");
  const [contactName, setContactName] = useState("");
  const [saving, setSaving] = useState(false);
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate("/auth"); return; }
      const { data } = await supabase
        .from("recruiters").select("id").eq("id", user.id).maybeSingle();
      setHasRecord(Boolean(data));
      setContactName(String(user.user_metadata?.full_name ?? ""));
    })();
  }, [navigate]);

  const createRecord = async () => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    const { error } = await supabase.from("recruiters").insert({
      id: user.id,
      company: company.trim(),
      contact_name: contactName.trim() || (user.email ?? "").split("@")[0],
      work_email: user.email,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Not saved", description: error.message, variant: "destructive" });
      return;
    }
    setHasRecord(true);
  };

  if (hasRecord === null) {
    return <div className="p-6"><Skeleton className="h-64 w-full rounded-xl" /></div>;
  }

  if (!hasRecord) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 space-y-4">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                One-time setup
              </span>
              <h1 className="text-xl font-semibold mt-1">Who are you hiring for?</h1>
              <p className="text-sm text-muted-foreground mt-1 max-w-prose">
                Students see your company name when you shortlist them, so it is worth getting
                right. An administrator verifies the account before candidates appear.
              </p>
            </div>
            <div>
              <Label htmlFor="company" className="text-xs">Company</Label>
              <Input id="company" value={company} onChange={(e) => setCompany(e.target.value)}
                     placeholder="NovaTech Hiring" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="contact" className="text-xs">Your name</Label>
              <Input id="contact" value={contactName} onChange={(e) => setContactName(e.target.value)}
                     className="mt-1" />
            </div>
            <Button className="w-full" disabled={saving || !company.trim()}
                    onClick={() => void createRecord()}>
              {saving ? "Saving…" : "Continue"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="flex relative">
        {isMobile && sidebarOpen && (
          <div className="fixed inset-0 bg-black/50 z-40 lg:hidden"
               onClick={() => setSidebarOpen(false)} />
        )}

        <div className={`
          ${isMobile ? "fixed" : "relative"}
          ${isMobile && !sidebarOpen ? "-translate-x-full" : "translate-x-0"}
          ${isMobile ? "z-50" : ""}
          transition-transform duration-300 ease-in-out
        `}>
          <RecruiterDashboardSidebar
            activeTab={activeTab}
            onTabChange={(tab) => {
              setActiveTab(tab);
              if (isMobile) setSidebarOpen(false);
            }}
          />
        </div>

        <main className="flex-1 p-2 md:p-3 lg:p-6 w-full min-w-0 overflow-x-hidden">
          {isMobile && (
            <Button variant="ghost" size="icon" className="mb-2"
                    onClick={() => setSidebarOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
          )}
          <RecruiterDashboardContent activeTab={activeTab} onTabChange={setActiveTab} />
        </main>
      </div>
    </div>
  );
};

export default RecruiterDashboard;
