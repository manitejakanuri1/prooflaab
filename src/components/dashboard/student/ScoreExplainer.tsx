// "How is this scored?" for the resume check and the resume assessment (owner decision 24 Oct 2026).
// Every rule here mirrors the server: resume-parser / resume-improve (ATS, quality), resume-assessment-submit
// (skill proof, project proof, reasoning, interview readiness) and resume-code-execute (coding).
// Change them together.

export interface ExplainedAnswer {
  question_type: "mcq" | "short_answer";
  category?: "skill" | "project_defense";
  final_score: number;
  reasoning_clarity_score?: number;
}

interface ScoreExplainerProps {
  quality?: number | null;
  ats?: number | null;
  skill?: number | null;
  project?: number | null;
  reasoning?: number | null;
  readiness?: number | null;
  coding?: number | null;
  answers?: ExplainedAnswer[];
}

const WEIGHTS = { quality: 20, ats: 20, skill: 30, project: 15, reasoning: 15 } as const;

const avgLine = (marks: number[]) =>
  marks.length ? `(${marks.join(" + ")}) ÷ ${marks.length} = ${Math.round(marks.reduce((a, b) => a + b, 0) / marks.length)}` : null;

function Part({ title, score, children }: { title: string; score?: number | null; children: React.ReactNode }) {
  return (
    <div className="rounded-md border p-3 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        <span className="font-mono text-sm">{score == null ? "not asked" : `${score}/100`}</span>
      </div>
      <div className="text-xs text-muted-foreground space-y-1">{children}</div>
    </div>
  );
}

export function ScoreExplainer({ quality, ats, skill, project, reasoning, readiness, coding, answers }: ScoreExplainerProps) {
  const skillMarks = answers?.filter((a) => a.category !== "project_defense").map((a) => a.final_score) ?? [];
  const projectMarks = answers?.filter((a) => a.category === "project_defense").map((a) => a.final_score) ?? [];
  const clarityMarks = answers?.filter((a) => a.question_type === "short_answer").map((a) => a.reasoning_clarity_score ?? 0) ?? [];
  const mcqs = answers?.filter((a) => a.question_type === "mcq") ?? [];

  const parts = ([
    ["Resume quality", quality, WEIGHTS.quality],
    ["ATS match", ats, WEIGHTS.ats],
    ["Skill proof", skill, WEIGHTS.skill],
    ["Project proof", project, WEIGHTS.project],
    ["Reasoning", reasoning, WEIGHTS.reasoning],
  ] as const).filter(([, v]) => v != null) as [string, number, number][];
  const weightSum = parts.reduce((a, [, , w]) => a + w, 0);
  const total = parts.reduce((a, [, v, w]) => a + v * w, 0);

  return (
    <details className="rounded-lg border bg-muted/20 p-3 text-left">
      <summary className="cursor-pointer text-sm font-medium">How is this scored?</summary>
      <div className="mt-3 space-y-2">
        {quality !== undefined && (
          <Part title="Resume quality: how well your resume is written" score={quality}>
            <p>The AI reads your resume and gives 0-100 for: clear structure, results with numbers (not just duties), action words, no fluff, and the right length (about one page).</p>
            <p>It is about the writing only, not how skilled you are.</p>
          </Part>
        )}
        {ats !== undefined && (
          <Part title="ATS match: will a company's hiring software find you" score={ats}>
            <p>Companies scan resumes with software (ATS) before a person reads them. The AI gives 0-100 for: the keywords and skills your target role needs, standard section headings (SKILLS, PROJECTS, EDUCATION...), and plain text the software can read (no images or tables).</p>
            <p>Below 60 you need the one-time Auto-fix or a better resume before the assessment.</p>
          </Part>
        )}
        {skill !== undefined && (
          <Part title="Skill proof: do you really know the skills you wrote" score={skill}>
            <p>Marks for being <b>right</b>. 5 multiple-choice questions on your skills (30 seconds each): right = 100, wrong or no answer = 0. A written skill question, if you got one, is marked 0-100 for correctness.</p>
            <p>Skill proof = the average of these marks.</p>
            {skillMarks.length > 0 && <p className="font-mono">Yours: {avgLine(skillMarks)}{mcqs.length > 0 && ` (${mcqs.filter((a) => a.final_score >= 100).length} of ${mcqs.length} MCQs right)`}</p>}
          </Part>
        )}
        {project !== undefined && (
          <Part title="Project proof: did you really build your projects" score={project}>
            <p>Up to 3 of your projects, 2 written questions each (90 seconds each), e.g. "What exactly was your own part?". The AI marks each answer 0-100 for correctness: real, specific details score high; vague or copied-sounding answers score low.</p>
            <p>Project proof = the average of these marks. No projects on your resume = not asked.</p>
            {projectMarks.length > 0 && <p className="font-mono">Yours: {avgLine(projectMarks)}</p>}
          </Part>
        )}
        {reasoning !== undefined && (
          <Part title="Reasoning: can you explain your thinking clearly" score={reasoning}>
            <p>Marks for <b>how clearly</b> you explain, not whether you are right. Every written answer (project and skill) gets a second, separate mark 0-100 for clear, logical explanation, even if the answer is not fully correct.</p>
            <p>Reasoning = the average of these clarity marks. MCQs do not count here.</p>
            {clarityMarks.length > 0 && <p className="font-mono">Yours: {avgLine(clarityMarks)}</p>}
          </Part>
        )}
        {coding !== undefined && coding !== null && (
          <Part title="Coding round" score={coding}>
            <p>Each coding problem (5 minutes) is run against hidden tests. Coding = tests passed ÷ all tests × 100. Tests that the starting code already passes are not counted.</p>
            <p>Shown on its own; it is not part of Interview Readiness.</p>
          </Part>
        )}
        {readiness !== undefined && (
          <Part title="Interview Readiness: your final score" score={readiness}>
            <p>A weighted mix: Resume quality 20% + ATS match 20% + Skill proof 30% + Project proof 15% + Reasoning 15%.</p>
            <p>A part that was not asked is left out, and the others are scaled back up to 100.</p>
            {parts.length > 0 && (
              <p className="font-mono">
                Yours: ({parts.map(([, v, w]) => `${v}×${w}`).join(" + ")}) ÷ {weightSum} = {(total / weightSum).toFixed(1)}, rounded {readiness ?? Math.round(total / weightSum)}
              </p>
            )}
          </Part>
        )}
      </div>
    </details>
  );
}
