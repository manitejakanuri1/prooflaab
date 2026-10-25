import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, ArrowRight, Check, Menu, Moon, Sun, X } from "lucide-react";
import { Button } from "./LandingButton";
import { cn } from "@/lib/utils";
import "./landing.css";

// The home page: an exact port of prooflab-ai.lovable.app (MinimalLanding + PilotCTA),
// owner decision 25 Oct 2026. Only the look and the words changed. Every sign-in /
// get-started button still goes to /auth, the same place the old home page sent people.

// Our own brand-kit logo (owner's kit, background removed), served from the public
// bucket gs://prooflab_logo/brand: white artwork on dark pages, navy on light pages.
const LOGO = "https://storage.googleapis.com/prooflab_logo/brand";

function BrandLogo() {
  return (
    <span className="inline-flex items-center gap-1">
      {(["white", "navy"] as const).map((tone) => (
        <span key={tone} className={cn("inline-flex items-center gap-1", tone === "white" ? "hidden dark:inline-flex" : "dark:hidden")}>
          <img src={`${LOGO}/prooflab-icon-${tone}.svg`} alt="" aria-hidden="true" className="h-6 w-auto" width={1000} height={1000} />
          <img src={`${LOGO}/prooflab-wordmark-${tone}.svg`} alt={tone === "white" ? "ProofLab" : ""} className="h-3.5 w-auto" width={900} height={118} />
        </span>
      ))}
    </span>
  );
}

// Same switch as the rest of the app (html class + localStorage "theme"), Lovable's look.
const subscribeTheme = (cb: () => void) => {
  const observer = new MutationObserver(cb);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
};
const isDark = () => document.documentElement.classList.contains("dark");

function ThemeToggle() {
  const dark = useSyncExternalStore(subscribeTheme, isDark, () => true);
  const toggle = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(next);
    try { localStorage.setItem("theme", next); } catch { /* private mode */ }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="rounded-md border border-border p-2 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

const navLinks = [
  { label: "Become Job-Ready", href: "#students" },
  { label: "Build Future Talent", href: "#colleges" },
  { label: "Find Proven Talent", href: "#recruiters" },
  { label: "The League", href: "#squad-league" },
];

const evidence = [
  ["Java", "Challenge completed"],
  ["SQL", "Query solved"],
  ["DSA", "Problem solved"],
  ["Communication", "Explanation recorded"],
];
const steps = [
  ["01", "Pick a Skill", "Start with something you say you know."],
  ["02", "Take On a Challenge", "Put that skill to work."],
  ["03", "Show Your Progress", "Keep a clear record of every challenge."],
];

function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function SectionHeading({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn("max-w-3xl text-[32px] font-medium leading-[1.08] tracking-normal md:text-[38px] lg:text-[44px]", className)}>{children}</h2>;
}

function SectionEyebrow({ children }: { children: ReactNode }) {
  return <p className="mb-5 font-mono text-[13px] font-semibold uppercase tracking-[0.11em] text-primary md:text-[15px]">{children}</p>;
}

function PrimaryLink({ children }: { children: ReactNode }) {
  return <Button asChild size="lg" className="h-11 px-5 text-sm"><Link to="/auth">{children}</Link></Button>;
}

function LandingNav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={cn("fixed inset-x-0 top-0 z-50 border-b transition-colors", scrolled ? "border-border bg-background/90 backdrop-blur-xl" : "border-transparent bg-transparent")}>
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
        <a href="#top" aria-label="Prooflab home" className="flex shrink-0 items-center"><BrandLogo /></a>
        <nav className="hidden items-center gap-6 lg:flex" aria-label="Main navigation">
          {navLinks.map((link) => <a key={link.href} href={link.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">{link.label}</a>)}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost" className="hidden text-sm sm:inline-flex"><Link to="/auth">Sign In <ArrowRight /></Link></Button>
          <Button asChild className="hidden text-sm sm:inline-flex"><Link to="/auth">Get Started <ArrowRight /></Link></Button>
          <Button variant="outline" size="icon" className="lg:hidden" onClick={() => setOpen((value) => !value)} aria-label="Toggle navigation" aria-expanded={open}>{open ? <X /> : <Menu />}</Button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-t border-border bg-background lg:hidden">
            <div className="space-y-1 px-5 py-4 sm:px-8">
              {navLinks.map((link) => <a key={link.href} href={link.href} onClick={() => setOpen(false)} className="block py-2.5 text-sm text-muted-foreground">{link.label}</a>)}
              <div className="grid grid-cols-2 gap-2 pt-3 sm:hidden"><Button asChild variant="outline"><Link to="/auth">Sign In</Link></Button><Button asChild><Link to="/auth">Get Started</Link></Button></div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

function Hero() {
  return (
    <section id="top" className="relative overflow-hidden px-5 pb-16 pt-28 sm:px-8 md:pb-20 md:pt-32">
      <div className="absolute inset-0 grid-lines opacity-20" />
      <div className="relative mx-auto grid min-h-[560px] w-full max-w-7xl items-center gap-12 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
        <Reveal>
          <h1 className="max-w-4xl text-[40px] font-medium leading-[1.02] tracking-normal sm:text-[52px] lg:text-[64px]">
            Resumes show what you say.<br />Proof shows what you can do.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-[18px]">Put your skills to work, one challenge at a time.</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <PrimaryLink>Start Building Proof <ArrowRight /></PrimaryLink>
            <Button asChild variant="outline" size="lg" className="h-11 px-5 text-sm"><a href="#colleges">For Colleges <ArrowRight /></a></Button>
          </div>
        </Reveal>
        <Reveal delay={0.1} className="mx-auto w-full max-w-md lg:ml-auto">
          <div className="relative overflow-hidden border border-border bg-card/70 p-5 shadow-sm backdrop-blur-sm sm:p-7">
            <div className="mb-6 flex items-center justify-between border-b border-border pb-4">
              <span className="font-mono text-xs text-muted-foreground">FROM CLAIM TO PROOF</span>
              <span className="size-2 rounded-full bg-primary" />
            </div>

            <div className="grid gap-5 sm:grid-cols-[0.85fr_auto_1.15fr] sm:items-center sm:gap-4">
              <motion.div
                animate={{ opacity: [1, 1, 0.55, 0.55, 1] }}
                transition={{ duration: 9, repeat: Infinity, times: [0, 0.3, 0.48, 0.88, 1] }}
                className="border-l-2 border-muted-foreground/30 pl-4"
              >
                <p className="font-mono text-xs text-muted-foreground">CLAIM</p>
                <p className="mt-2 text-[24px] font-medium">JAVA</p>
                <p className="mt-1 text-sm text-muted-foreground">Claimed skill</p>
              </motion.div>

              <ArrowRight className="hidden size-4 text-muted-foreground/50 sm:block" />
              <ArrowDown className="size-4 text-muted-foreground/50 sm:hidden" />

              <div className="min-h-[164px] border border-border bg-background/50 p-4">
                <p className="font-mono text-xs text-muted-foreground">EVIDENCE</p>
                <div className="mt-4 space-y-2.5">
                  {["Challenge completed", "Solution submitted", "Explanation recorded"].map((item, index) => (
                    <motion.div
                      key={item}
                      animate={{ opacity: [0, 0, 1, 1, 0], y: [6, 6, 0, 0, -2] }}
                      transition={{ duration: 9, delay: index * 0.45, repeat: Infinity, times: [0, 0.16, 0.34, 0.88, 1] }}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Check className="size-3.5 text-verified" />
                      <span>{item}</span>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>

            <motion.div
              animate={{ opacity: [0, 0, 1, 1, 0], y: [8, 8, 0, 0, 4] }}
              transition={{ duration: 9, repeat: Infinity, times: [0, 0.5, 0.64, 0.9, 1] }}
              className="mt-5 flex items-center justify-between border-t border-primary/40 pt-5"
            >
              <span className="flex items-center gap-2 font-mono text-xs text-primary"><Check className="size-4" /> PROOF</span>
              <span className="text-sm font-medium">Java · Verified</span>
            </motion.div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function ProofTrail() {
  return (
    <section className="border-t border-border px-5 py-16 sm:px-8 md:py-20">
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <Reveal><SectionHeading>A resume is a snapshot.<br />Proof is a trail.</SectionHeading></Reveal>
        <Reveal delay={0.08} className="border-l border-border pl-6 sm:pl-8" aria-label="Growing proof trail">
          {evidence.map(([skill, proof], index) => (
            <div key={skill} className="relative grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-4 border-b border-border py-4 first:pt-0 last:border-0 last:pb-0">
              <motion.span initial={{ scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true }} transition={{ delay: index * 0.08 }} className="absolute -left-[29px] top-5 size-2 rounded-full bg-primary sm:-left-[37px]" />
              <span className="text-sm font-medium sm:text-base">{skill}</span><span className="text-sm text-muted-foreground sm:text-base">{proof}</span>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="bg-surface px-5 py-16 sm:px-8 md:py-20">
      <div className="mx-auto max-w-7xl">
        <Reveal><SectionEyebrow>HOW IT WORKS</SectionEyebrow><SectionHeading>Do. Explain. Improve. <span className="text-primary">Prove.</span></SectionHeading></Reveal>
        <div className="mt-10 grid gap-px bg-border lg:grid-cols-3">
          {steps.map(([number, title, copy], index) => (
            <Reveal key={number} delay={index * 0.06} className="bg-surface py-6 lg:px-7">
              <span className="font-mono text-xs text-primary">{number}</span>
              <h3 className="mt-5 text-[22px] font-medium leading-tight tracking-normal lg:text-[24px]">{title}</h3>
              <p className="mt-3 max-w-sm text-base leading-7 text-muted-foreground lg:text-[17px]">{copy}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function SkillBar({ label, width }: { label: string; width: string }) {
  return <div><div className="mb-2 flex justify-between text-sm"><span>{label}</span><span className="text-muted-foreground">Verified</span></div><div className="h-1 bg-muted"><motion.div className="h-full bg-primary" initial={{ width: 0 }} whileInView={{ width }} viewport={{ once: true }} transition={{ duration: 0.8 }} /></div></div>;
}

function StudentSection() {
  return (
    <section id="students" className="scroll-mt-16 border-t border-border px-5 py-16 sm:px-8 md:py-20">
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2 lg:items-center">
        <Reveal><SectionEyebrow>BECOME JOB-READY</SectionEyebrow><SectionHeading>Your work can become proof.</SectionHeading><p className="mt-5 text-base leading-7 text-muted-foreground sm:text-[18px]">Every challenge you complete adds evidence to the story you can show.</p><div className="mt-7"><PrimaryLink>Start Building Proof <ArrowRight /></PrimaryLink></div></Reveal>
        <Reveal delay={0.08} className="border border-border bg-card p-6 sm:p-7">
          <div className="flex items-center justify-between border-b border-border pb-4"><span className="font-mono text-xs text-muted-foreground">PROOF PROFILE</span><span className="flex items-center gap-2 text-sm text-verified"><Check className="size-4" /> Active</span></div>
          <div className="mt-6 space-y-4"><SkillBar label="Technical Skills" width="82%" /><SkillBar label="Communication" width="72%" /><SkillBar label="Consistency" width="90%" /></div>
          <div className="mt-6 flex flex-wrap gap-5 border-t border-border pt-5">{["Java", "SQL", "DSA"].map((skill) => <span key={skill} className="flex items-center gap-2 text-sm"><Check className="size-4 text-verified" />{skill}</span>)}</div>
        </Reveal>
      </div>
    </section>
  );
}

function CollegeSection() {
  return (
    <section id="colleges" className="scroll-mt-16 border-t border-border bg-surface px-5 py-16 sm:px-8 md:py-20">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <Reveal><SectionEyebrow>BUILD FUTURE TALENT</SectionEyebrow><SectionHeading>Know who&apos;s ready.</SectionHeading><p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-[18px]">See who is participating, improving and building toward placement.</p><div className="mt-7"><Button asChild variant="outline" size="lg" className="h-11 text-sm"><Link to="/auth">Bring Prooflab to Your College <ArrowRight /></Link></Button></div></Reveal>
        <Reveal delay={0.08} className="divide-y divide-border border-y border-border">
          {["Participation", "Skills", "Progress"].map((label, index) => <div key={label} className="flex items-center justify-between py-5"><span className="text-base">{label}</span><span className="font-mono text-xs text-primary">0{index + 1}</span></div>)}
        </Reveal>
      </div>
    </section>
  );
}

function RecruiterSection() {
  return (
    <section id="recruiters" className="scroll-mt-16 border-t border-border px-5 py-16 sm:px-8 md:py-20">
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2 lg:items-center">
        <Reveal><SectionEyebrow>FIND PROVEN TALENT</SectionEyebrow><SectionHeading>Look beyond the resume.</SectionHeading><p className="mt-5 text-base text-muted-foreground sm:text-[18px]">See what candidates have actually done.</p><div className="mt-7"><Button asChild variant="outline" size="lg" className="h-11 text-sm"><Link to="/auth">Explore Recruiter Access <ArrowRight /></Link></Button></div></Reveal>
        <Reveal delay={0.08} className="border-y border-border py-6">
          <div className="flex items-center justify-between"><span className="font-mono text-xs text-muted-foreground">CANDIDATE</span><span className="flex items-center gap-2 text-sm text-verified"><span className="size-2 rounded-full bg-verified" /> Proof verified</span></div>
          <div className="mt-6 flex flex-wrap gap-2">{["Java", "SQL", "Python"].map((item) => <span key={item} className="border border-border px-3 py-2 text-sm">{item}</span>)}</div>
          <div className="mt-6 flex flex-wrap gap-5 border-t border-border pt-5">{["Built", "Solved", "Explained"].map((item) => <span key={item} className="flex items-center gap-2 text-sm"><Check className="size-4 text-primary" />{item}</span>)}</div>
        </Reveal>
      </div>
    </section>
  );
}

function SquadLeague() {
  return (
    <section id="squad-league" className="scroll-mt-16 border-t border-border bg-surface px-5 py-16 sm:px-8 md:py-20">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1fr_0.8fr] lg:items-center">
        <Reveal><SectionEyebrow>THE LEAGUE</SectionEyebrow><SectionHeading>A little competition goes a long way.</SectionHeading><p className="mt-5 text-base text-muted-foreground sm:text-[18px]">Build. Improve. Compete.</p><div className="mt-7"><PrimaryLink>Explore The League <ArrowRight /></PrimaryLink></div></Reveal>
        <Reveal delay={0.08} className="border border-compete/30 bg-background p-6">
          <p className="font-mono text-xs text-compete">THE LEAGUE</p>
          <div className="mt-6 flex items-end justify-between gap-4"><div><p className="text-sm text-muted-foreground">SQUAD 07</p><p className="mt-1 text-[32px] font-medium">842 <span className="text-sm text-muted-foreground">pts</span></p></div><span className="pb-2 text-sm text-compete">vs</span><div className="text-right"><p className="text-sm text-muted-foreground">SQUAD 03</p><p className="mt-1 text-[32px] font-medium">819 <span className="text-sm text-muted-foreground">pts</span></p></div></div>
        </Reveal>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border px-5 py-9 sm:px-8">
      <div className="mx-auto flex max-w-7xl flex-col justify-between gap-7 md:flex-row md:items-center">
        <div><BrandLogo /><p className="mt-3 text-sm text-muted-foreground">Build proof. Show readiness.</p></div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">{navLinks.map((link) => <a key={link.href} href={link.href} className="hover:text-foreground">{link.label}</a>)}<Link to="/auth" className="hover:text-foreground">Sign In</Link></div>
      </div>
      <div className="mx-auto mt-7 flex max-w-7xl justify-between border-t border-border pt-5 text-xs text-muted-foreground"><span>© 2026 PROOFLAB</span><div className="flex gap-5"><a href="#top">Privacy</a><a href="#top">Terms</a></div></div>
    </footer>
  );
}

export default function Landing() {
  return <main className="pl-landing min-h-screen overflow-x-hidden bg-background text-foreground"><LandingNav /><Hero /><ProofTrail /><HowItWorks /><StudentSection /><CollegeSection /><RecruiterSection /><SquadLeague /><PilotCTA /><Footer /></main>;
}

function PilotCTA() {
  return (
    <section id="pilot" className="scroll-mt-16 border-t border-border px-5 py-16 sm:px-8 md:py-20">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto max-w-4xl text-center"
      >
        <h2 className="text-[32px] font-medium leading-[1.08] tracking-normal md:text-[38px] lg:text-[44px]">
          Ready to show what you can do?
        </h2>
        <p className="mt-4 text-base text-muted-foreground sm:text-[18px]">Take the first challenge today.</p>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="h-11 px-5 text-sm">
            <Link to="/auth">Start Building Proof <ArrowRight /></Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="h-11 px-5 text-sm">
            <Link to="/auth">Bring Prooflab to Your College <ArrowRight /></Link>
          </Button>
        </div>
        <p className="mt-6 text-sm text-muted-foreground">Already have an account? <Link to="/auth" className="text-foreground transition-colors hover:text-primary">Sign in <ArrowRight className="inline size-3.5" /></Link></p>
      </motion.div>
    </section>
  );
}