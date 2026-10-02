# Question wording and evaluation quality audit (3 Oct 2026)

Read-only. **Nothing was rewritten.**
- Samples are real production `lot_templates`, `task_sandbox_config` and `ai_templates` rows, read on 3 Oct (DATA). They contain no student data.
- Prompts are from source (SRC).

## 1. Every producer of student-facing question wording

| Producer | Kind | File |
|---|---|---|
| Daily Lot scenario, title, code_sample | AI-generated, stored | `lot-writer/index.ts` prompt + `auto-config` schema |
| Lot seed text | hard-coded SQL | `seed_lot_template` ("Build the smallest working thing that proves you understand …") |
| "In simple words" explainer | AI, stored | `_shared/explain.ts` → `task_explainers` |
| Coding constraints / starter / tests | AI, stored | `auto-config` SANDBOX_SCHEMA |
| Rubric criteria shown in the checklist | AI or generic | `auto-config` RUBRIC_SCHEMA; generic seed (migration stage 71) |
| Resume MCQ / short answer | AI per student | `resume-question-generator` |
| Resume coding problems | AI, cached per profile | `resume-coding-generate` |
| Retest | AI | `resume-retest-generate` |
| Roadmap tasks "Roadmap: …" | AI ("witty mentor, roast with love") | `resume-assessment-submit` |
| Track lessons and quizzes | AI once (written), stored | `_shared/levels.ts` |
| Assigned tasks | AI or human (admin/college) | `assign_tasks` |
| Company tasks / Sponsored Lots | human free text | Startup Post Task, `sponsor_lot` |
| College-submitted material | human; becomes source_content | `PostSourceMaterial` |
| UI labels | hard-coded React | many components |

## 2. What the Lot prompt asks for (SRC `lot-writer` prompt + fields)

**It asks for:**
- a "work order" in 3–5 sentences, second person, under an hour;
- "say exactly what to submit";
- no greeting;
- optional starter or broken code (≤ 15 lines);
- any material referred to as "below" must appear in `code_sample`;
- grounding in the excerpt;
- fields: title (≤ 90), scenario, code_sample, source_jd, difficulty, estimate (10–45), category, scratch_language.

**It does NOT ask for:**
- Input, Output or Constraints sections, except in sandbox mode via `constraints_text`;
- an example input/output with an explanation;
- a statement of how the answer will be checked;
- the actual delivery channel (a text box or the code editor).

The student-facing scenario has no fixed structure.

## 3. Real samples and what is wrong with them (DATA, 3 Oct)

| # | Title (verbatim) | Mode | Problem found |
|---|---|---|---|
| 1 | "Print FizzBuzz for the numbers 1 to n" | sandbox | Clear. Example I/O is only in the visible tests, not in the text. Fine |
| 2 | "Write a Placement Interview Prep Plan for Tech Mahindra" | rubric | Clear task, but the whole Lot is about **placement prep, not work**. It comes from PrepInsta interview pages, not job work |
| 3 | "Map LTIMindtree's 4-round hiring process and prep plan" | rubric | "**Use only the information from the attached PrepInsta article**": the article is **not shown** to the student (only "Real source: <title>"). A **referenced-content-not-shown** violation of the prompt's own rule |
| 4 | "Write a 45-Minute Study Plan for Microsoft's Fresher Hiring Rounds" | rubric | "**Submit your plan as a plain text or markdown file**": there is **no file upload** (owner rule: no upload proof). The deliverable is impossible as written. The title says 45-minute and the body says one page (confusing) |
| 5 | "Prepare a 2-minute self-introduction for Cognizant GenC interview" | rubric | "Submit the final script as a plain text file": same file problem |
| 6 | "Write a Capgemini Interview Experience Report for Your Campus" | rubric | "**You recently attended a Capgemini on-campus drive**": a fabricated premise. The student must invent an experience, which is unrealistic and rewards making things up |
| 7 | "Write a 60-Second Self-Introduction for Wipro's Business Discussion Round" | rubric | "**then record yourself delivering it**": mixes the voice step into a written task and duplicates the separate voice flow |
| 8 | "Fix the Accenture OA-style buggy array sum and document the fix" | **rubric** | A coding bug-fix ("run a few test cases … submit your corrected code") graded as **written** by AI. INFERRED: a sandbox attempt failed validation twice, then `rubric_downgrade`. The student cannot run code unless a scratchpad language was set |
| 9 | Sandbox config: S3 policy JSON | sandbox | Exact `indent=2, sort_keys=True` formatting requirement: **output-format trivia dominates** the skill tested |
| 10 | Sandbox config: "EDIT: …" loop | sandbox | **All tests have empty stdin and identical expected output** (t1 visible == t2 hidden == …). A program that **prints the constant string passes every hidden test**. Validation passed because the reference solution also prints it. Proof that test quality is not checked |
| 11 | Resume coding: "reverseString" | resume | Trivial; 3 tests (`hello`, `world`, `abc`); not tied to the claimed skills; cannot separate ability levels |

**Patterns:**
- Many Lots derive from **interview-experience and aptitude pages**, so they become "write a prep plan / self-intro / experience report" tasks, not real work.
- "Submit a file" wording conflicts with the product, which has only a text box or editor.
- Referenced material is not shown.
- Fabricated first-person premises.
- No Input/Output/Example block.
- Voice is folded into written tasks.

## 4. Grading-mode selection (SRC, DATA)

1. The `grading_mode_hint` column exists (stage 76) and is NULL on all 28 pages. **It is never used.**
2. The keyword regex `CODE_SIGNALS` runs on the title plus the first 400 chars. "api", "query", "function", "array", "loop" or "script" in an aptitude page or JD gives sandbox. An article mentioning "code of conduct" matches `code`, which gives sandbox.
3. Sandbox generation must pass execution validation twice. Otherwise it is downgraded to a rubric with fixed generic criteria (effort 40 / soundness 30 / clarity 30). Otherwise it falls back to the generic checklist.
4. Result in production: 7 sandbox and 30 rubric templates; **0 sandbox tasks handed out in the current window**.

**Misclassification risks:**
- Aptitude content (IndiaBix) with words like "array" or "function" becomes a coding task.
- Real coding work whose test generation fails becomes a written explanation (#8).
- Job descriptions that mention SQL or APIs become coding with no clear spec.

## 5. Written grading quality (SRC)

| Mechanism | Strength | Weakness |
|---|---|---|
| `gradeOnce`: `<answer>` tags + "ignore instructions" | prompt-injection aware | single `user` message; no system role |
| Evidence must be a verbatim quote ≥ 8 chars | stops credit for absent content | a rambling answer that touches keywords can collect quotes |
| Second grader within ±`NEAR_THRESHOLD` of the pass line; the lower total wins | conservative | only near the line |
| `grader_disagreement` flag (>15 points) | surfaces to admin "Flagged" | no human workflow found beyond the flag list |
| `similar_written_submission` (pg_trgm, 0.8) on task-specific checklists | catches near copies of another student's answer | skipped for the generic checklist (72 roadmap tasks); does not catch AI-written answers |
| Word limits | cheap gate | — |
| Unlimited resubmits after a fail | — | each costs 1–2 AI calls; no cap |
| AI-authorship detection | **not active** in the current flow (`ai-authorship` is legacy, admin-only) | — |

## 6. MCQ / deterministic systems (SRC)

| System | Key | Scoring | Randomisation | Retry |
|---|---|---|---|---|
| Resume MCQ (5) | `correct_index` in `resume_assessments.questions` | server | options shuffled with key remapping (`resume-question-generator:292-298`) | retest after cooldown |
| Track quiz | level content `correct_index` | server `level-quiz-submit`, pass mark | pool | attempts counted |
| Placement questions | `placement_questions` / `submit_placement` RPCs | server | — | — |

## 7. Intended quality vs current (gap only; no rewrite)

| Intended element | Current |
|---|---|
| Title | present |
| Real context | present, sometimes fabricated (#6) |
| Your task | present, sometimes impossible (#4, #5) |
| Input / Output | **absent** in the text (sandbox only via tests) |
| Constraints | sandbox only (`constraints_text`) |
| Example input/output + explanation | **absent** |
| Starter / broken code | sometimes (≤ 15 lines) |
| Simple professional English | mostly; the "simple words" explainer helps |
| Understood on first read | not guaranteed: hidden references, file deliverables |

## 8. Where a validator would sit (analysis only; point 124)

The current chain:

```text
source_content → lot-writer prompt → auto-config (generate + execute) → save_lot_template → explainTask
```

A contract check (required sections present; no "file", "attached" or "below" references without `code_sample`; no first-person fabricated premise) fits **between `generateGradedConfig` and `save_lot_template`**. A test-quality check (distinct stdin across tests; at least one boundary case; a known-wrong solution must fail) fits **inside `tryGenerateSandbox` after `gradeTests`**. Neither exists today.
