import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Lock, Star } from "lucide-react";

export type LevelState = "mastered" | "cleared" | "placed" | "current" | "locked";

export interface PathLevel {
  id: string;
  level_number: number;
  skill: string;
  title: string;
  state: LevelState;
  shaky?: boolean;
}

interface LevelPathProps {
  levels: PathLevel[];
  trackEmoji: string;
  role: string;
  onOpen: (levelNumber: number) => void;
}

/**
 * The roadmap as a board you climb rather than a list you scroll.
 *
 * Level 1 sits at the bottom and the goal at the top. The design carries the
 * meaning rather than decorating it:
 *
 *   · temperature — ground you have covered is warm and lit, ground ahead is
 *     cool and grey, so "how far am I" is answerable without reading a word
 *   · one hero — only the level you are on wears the brand orange, and it is
 *     the only thing on the board with a glow, so the eye lands there first
 *   · solid vs dotted trail — walked road is a filled rope, road ahead is
 *     dotted, the same way a map draws a route you have not taken yet
 *   · hollow vs filled — a level ticked from a resume is an outline, because
 *     nothing has actually been filled in yet
 *
 * Every colour comes from the tokens in index.css, so the board themes with
 * the rest of the app instead of carrying its own palette.
 */

const ROW = 128; // vertical distance between two levels
const PAD_BOTTOM = 84; // room for the opening plaque
const PAD_TOP = 118; // room for the destination sign
const BANNER_GAP = 66; // extra space where a chapter plaque sits
const CHAPTER = 4; // levels per chapter

/** Depth cue only — the further from the wall, the smaller the rung. */
const SIZE: Record<LevelState, number> = {
  current: 68,
  mastered: 56,
  cleared: 54,
  placed: 54,
  locked: 46,
};

const FACE: Record<LevelState, string> = {
  mastered:
    "bg-rung-gold text-white ring-1 ring-inset ring-white/45 shadow-[0_4px_0_0_hsl(var(--rung-gold-deep))]",
  cleared:
    "bg-rung-pass text-white ring-1 ring-inset ring-white/35 shadow-[0_4px_0_0_hsl(var(--rung-pass-deep))]",
  // Hollow on purpose: the tick came from a resume line, not from work.
  placed:
    "bg-card text-rung-pass border-2 border-dashed border-rung-pass/70 shadow-[0_3px_0_0_hsl(var(--rung-pass)/0.3)]",
  current:
    "bg-primary text-primary-foreground ring-1 ring-inset ring-white/40 shadow-[0_5px_0_0_hsl(var(--rung-now-deep))]",
  locked:
    "bg-rung-idle text-muted-foreground/70 ring-1 ring-inset ring-white/25 shadow-[0_3px_0_0_hsl(var(--rung-idle-deep))]",
};

const LevelPath = ({ levels, trackEmoji, role, onOpen }: LevelPathProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const didScroll = useRef(false);

  // The trail is drawn in real pixels. A percentage viewBox would stretch the
  // stroke, and the rope would go thin on wide screens and fat on narrow ones.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    // Keep every rung and its label inside the board on narrow phones.
    const amp = Math.max(0, Math.min(width * 0.28, width / 2 - 68));
    const cx = width / 2;
    const nodes: { level: PathLevel; x: number; y: number; i: number }[] = [];
    const banners: { y: number; chapter: number; label: string }[] = [];

    let y = PAD_BOTTOM;
    levels.forEach((level, i) => {
      if (i > 0 && i % CHAPTER === 0) {
        y += BANNER_GAP / 2;
        banners.push({ y, chapter: Math.floor(i / CHAPTER) + 1, label: level.skill });
        y += BANNER_GAP / 2;
      }
      nodes.push({ level, i, x: cx + amp * Math.sin(i * 0.85 + 0.4), y });
      if (i < levels.length - 1) y += ROW;
    });

    return { nodes, banners, total: y + PAD_TOP };
  }, [levels, width]);

  /** y is measured from the bottom; SVG counts from the top. */
  const flip = (y: number) => geo.total - y;

  const buildPath = (points: { x: number; y: number }[]) => {
    if (points.length < 2) return "";
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const mid = (a.y + b.y) / 2;
      d += ` C ${a.x} ${mid}, ${b.x} ${mid}, ${b.x} ${b.y}`;
    }
    return d;
  };

  const points = geo.nodes.map((n) => ({ x: n.x, y: flip(n.y) }));
  const currentIdx = geo.nodes.findIndex((n) => n.level.state === "current");
  const walkedTo = currentIdx === -1 ? points.length - 1 : currentIdx;
  const aheadPath = buildPath(points.slice(walkedTo));
  const walkedPath = buildPath(points.slice(0, walkedTo + 1));

  // Land on the level they are actually playing, not on level 1.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !width || didScroll.current || geo.nodes.length === 0) return;
    const target = geo.nodes[walkedTo] ?? geo.nodes[geo.nodes.length - 1];
    el.scrollTop = Math.max(0, flip(target.y) - el.clientHeight / 2);
    didScroll.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, geo, walkedTo]);

  const plaque =
    "rounded-full border border-border/70 bg-card/85 px-3.5 py-1 shadow-sm backdrop-blur-sm";

  return (
    <div
      ref={scrollRef}
      className="relative overflow-y-auto overflow-x-hidden rounded-xl border bg-gradient-to-t from-board-bottom to-board-top"
      style={{ maxHeight: "min(70vh, 620px)" }}
    >
      <div className="relative" style={{ height: geo.total }}>
        {width > 0 && (
          <svg
            className="pointer-events-none absolute inset-0"
            width={width}
            height={geo.total}
            viewBox={`0 0 ${width} ${geo.total}`}
            aria-hidden
          >
            {/* Ahead: dotted, the way a map draws a route not yet taken. */}
            <path
              d={aheadPath}
              fill="none"
              stroke="hsl(var(--trail-todo))"
              strokeWidth={9}
              strokeLinecap="round"
              strokeDasharray="0.1 22"
            />
            {/* Walked: a filled rope with a lit core running down the middle. */}
            <path
              d={walkedPath}
              fill="none"
              stroke="hsl(var(--trail-done))"
              strokeWidth={17}
              strokeLinecap="round"
              opacity={0.28}
            />
            <path
              d={walkedPath}
              fill="none"
              stroke="hsl(var(--trail-done))"
              strokeWidth={9}
              strokeLinecap="round"
            />
            <path
              d={walkedPath}
              fill="none"
              stroke="hsl(0 0% 100% / 0.5)"
              strokeWidth={3}
              strokeLinecap="round"
            />
          </svg>
        )}

        {/* Destination */}
        <div className="absolute inset-x-0 flex flex-col items-center gap-1.5" style={{ top: 18 }}>
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-rung-gold/40 bg-rung-gold/15">
            <span className="animate-float-emoji inline-block text-2xl">🏆</span>
          </div>
          <div className={plaque}>
            <p className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.16em] text-foreground/70">
              {role || "Your goal"}
            </p>
          </div>
        </div>

        {/* Chapter plaques — a rule through the board with the label set into it */}
        {geo.banners.map((b) => (
          <div
            key={b.chapter}
            className="animate-pop-in absolute inset-x-0 z-10 flex -translate-y-1/2 items-center gap-3 px-5"
            style={{ top: flip(b.y) }}
          >
            <span className="h-px flex-1 bg-border" />
            <span className={plaque}>
              <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Chapter {b.chapter} · {b.label}
              </span>
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
        ))}

        {/* Levels. Held back until the board has been measured, or every rung
            would paint stacked at x=0 for one frame before the trail appears. */}
        {width > 0 &&
          geo.nodes.map(({ level, x, y, i }) => {
            const clickable = level.state !== "locked";
            const size = SIZE[level.state];
            const isNow = level.state === "current";

            return (
              <div
                key={level.id}
                className="animate-node-pop absolute z-20"
                style={{
                  left: x,
                  top: flip(y),
                  transform: "translate(-50%, -50%)",
                  animationDelay: `${Math.min(i * 45, 550)}ms`,
                }}
              >
                {/* The one glow on the board. It says "here" better than a badge. */}
                {isNow && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,hsl(var(--primary)/0.3),transparent_68%)]"
                  />
                )}

                {level.state === "mastered" && (
                  <div className="pointer-events-none absolute -top-3.5 left-1/2 flex -translate-x-1/2 gap-0.5">
                    {[0, 1, 2].map((s) => (
                      <Star
                        key={s}
                        className="animate-star-twinkle h-3 w-3 fill-rung-gold text-rung-gold-deep drop-shadow-sm"
                        style={{ animationDelay: `${s * 260}ms` }}
                      />
                    ))}
                  </div>
                )}

                {isNow && (
                  <div className="animate-marker-bob pointer-events-none absolute -top-11 left-1/2 select-none text-2xl">
                    {trackEmoji}
                  </div>
                )}

                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => clickable && onOpen(level.level_number)}
                  aria-label={`Level ${level.level_number}: ${level.title}${clickable ? "" : " (locked)"}`}
                  className={`relative flex items-center justify-center overflow-hidden rounded-full font-extrabold tabular-nums transition-transform duration-150 ${
                    FACE[level.state]
                  } ${
                    clickable
                      ? "cursor-pointer hover:-translate-y-0.5 active:translate-y-1 active:shadow-none"
                      : "cursor-not-allowed"
                  }`}
                  style={{ width: size, height: size, fontSize: isNow ? 21 : 16 }}
                >
                  {/* Gloss. Two pixels of work, and the rung stops looking flat.
                      Skipped on the hollow rung, which has no face to catch it. */}
                  {level.state !== "placed" && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-x-1.5 top-1 h-1/3 rounded-full bg-white/25"
                    />
                  )}
                  {level.state === "mastered" ? (
                    <Star className="h-6 w-6 fill-current" />
                  ) : level.state === "locked" ? (
                    <Lock className="h-4 w-4" />
                  ) : level.state === "cleared" || level.state === "placed" ? (
                    <Check className="h-6 w-6" strokeWidth={3.5} />
                  ) : (
                    level.level_number
                  )}
                </button>

                <div className="pointer-events-none absolute left-1/2 top-full mt-2 w-[124px] -translate-x-1/2 text-center">
                  <p
                    className={`line-clamp-2 text-[12px] font-semibold leading-tight ${
                      level.state === "locked" ? "text-foreground/35" : "text-foreground/90"
                    }`}
                  >
                    {level.skill}
                  </p>
                  {level.shaky ? (
                    <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-rung-gold-deep">
                      revisit
                    </p>
                  ) : level.state === "placed" ? (
                    <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-rung-pass/80">
                      from resume
                    </p>
                  ) : isNow ? (
                    <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-primary">
                      you are here
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}

        {/* Opening plaque — same treatment as the chapter rules, so the board
            reads as one system top to bottom. */}
        <div className="absolute inset-x-0 z-10 flex items-center gap-3 px-5" style={{ bottom: 22 }}>
          <span className="h-px flex-1 bg-border" />
          <span className={plaque}>
            <span className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Chapter 1 · Start
            </span>
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>
      </div>
    </div>
  );
};

export default LevelPath;
