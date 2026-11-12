import { useEffect, useState } from "react";
import { BookOpen, Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MarkdownLite } from "./ReadableText";
import { nextUnread, readText } from "@/lib/courseText";

interface Course { slug: string; title: string; credit: string | null; chapters: number }

/**
 * Owner 12 Nov 2026 (option Y, migration 241): the whole course for a roadmap track, read inside the app,
 * chapters easy to hard, each one "Mark as read". Nothing links outside the app (links were removed).
 */
const FullCourse = ({ trackSlug }: { trackSlug: string }) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [open, setOpen] = useState<Course | null>(null);
  useEffect(() => {
    let gone = false;
    supabase.from("course_tracks" as never).select("courses(slug, title, credit, chapters)").eq("track_slug", trackSlug)
      .then(({ data }) => {
        if (!gone) setCourses(((data ?? []) as { courses: Course | null }[]).flatMap((r) => (r.courses ? [r.courses] : [])));
      });
    return () => { gone = true; };
  }, [trackSlug]);
  if (!courses.length) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-2">
      {courses.map((c) => (
        <Button key={c.slug} size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(c)} data-testid="full-course">
          <BookOpen className="h-4 w-4" /> Full course: {c.title}
        </Button>
      ))}
      {open && <CourseReader course={open} onClose={() => setOpen(null)} />}
    </div>
  );
};

const CourseReader = ({ course, onClose }: { course: Course; onClose: () => void }) => {
  const [titles, setTitles] = useState<{ position: number; title: string }[] | null>(null);
  const [read, setRead] = useState<Set<number>>(new Set());
  const [at, setAt] = useState<number | null>(null);
  const [body, setBody] = useState<{ body: string; credit: string | null } | null>(null);

  useEffect(() => {
    void Promise.all([
      supabase.from("course_chapters" as never).select("position, title").eq("course_slug", course.slug).order("sort"),
      supabase.from("course_reads" as never).select("position").eq("course_slug", course.slug),
    ]).then(([t, r]) => {
      setTitles((t.data ?? []) as { position: number; title: string }[]);
      setRead(new Set(((r.data ?? []) as { position: number }[]).map((x) => x.position)));
    });
  }, [course.slug]);

  useEffect(() => {
    if (at == null) return;
    setBody(null);
    supabase.from("course_chapters" as never).select("body, credit").eq("course_slug", course.slug).eq("position", at).single()
      .then(({ data }) => setBody((data as { body: string; credit: string | null } | null) ?? { body: "", credit: null }));
    document.getElementById("course-reader-top")?.scrollIntoView();
  }, [at, course.slug]);

  const toggleRead = async (p: number) => {
    const has = read.has(p);
    const { error } = has
      ? await supabase.from("course_reads" as never).delete().eq("course_slug", course.slug).eq("position", p)
      : await supabase.from("course_reads" as never).insert({ course_slug: course.slug, position: p } as never);
    if (error) return;
    setRead((s) => {
      const n = new Set(s);
      if (has) n.delete(p); else n.add(p);
      return n;
    });
  };

  const total = titles?.length ?? course.chapters;
  // Migration 260: reading order is the list order (sort), so numbers and "Next" follow the list, not position.
  const idx = titles?.findIndex((t) => t.position === at) ?? -1;
  const title = idx >= 0 ? titles![idx].title : undefined;
  const next = idx >= 0 ? titles![idx + 1]?.position : undefined;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="course-reader">
        <div id="course-reader-top" />
        <DialogHeader>
          <DialogTitle>{course.title}</DialogTitle>
          <p className="text-xs text-muted-foreground" data-testid="course-progress">{readText(read.size, total)}</p>
        </DialogHeader>
        {titles == null ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : at == null ? (
          <div className="space-y-2">
            <Button size="sm" onClick={() => setAt(nextUnread(read, titles.map((t) => t.position)))}>
              {read.size ? "Continue reading" : "Start with chapter 1"}
            </Button>
            <ol className="divide-y rounded-lg border text-sm">
              {titles.map((t, i) => (
                <li key={t.position}>
                  <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50"
                          onClick={() => setAt(t.position)} data-testid="chapter-row">
                    <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">{i + 1}</span>
                    <span className="flex-1">{t.title}</span>
                    {read.has(t.position) && <Check className="h-4 w-4 text-verified" aria-label="read" />}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="space-y-3">
            <Button size="sm" variant="ghost" className="gap-1 px-2" onClick={() => setAt(null)}>
              <ChevronLeft className="h-4 w-4" /> All chapters
            </Button>
            <h3 className="text-lg font-semibold" data-testid="chapter-title">{idx + 1}. {title}</h3>
            {body == null ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <MarkdownLite text={body.body} />}
            {(body?.credit ?? course.credit) && <p className="text-[11px] text-muted-foreground" data-testid="chapter-credit">{body?.credit ?? course.credit}</p>}
            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <Button size="sm" variant={read.has(at) ? "secondary" : "default"} onClick={() => void toggleRead(at)} data-testid="mark-read">
                <Check className="mr-1 h-4 w-4" /> {read.has(at) ? "Read" : "Mark as read"}
              </Button>
              {next != null && (
                <Button size="sm" variant="outline" className="gap-1" onClick={() => setAt(next)}>
                  Next chapter <ChevronRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default FullCourse;
