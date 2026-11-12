"""Writes migration 235: 40 hand-written pitch Lots (4 kinds x 10), each with its own page, checker and simple
explainer, so no AI is called to make or explain them. Usage: python -I gen_pitch.py <out.sql>"""
import hashlib
import json
import sys

REG = "cffc035d-444b-45dc-a8fc-4d41a5fb8307"  # source_registry: "Material added by a ProofLab admin"
CRITERIA = [
    {"id": "effort", "name": "Effort & Relevance", "max_points": 40,
     "description": "The answer directly addresses the task and shows real engagement with it, not a generic or evasive response."},
    {"id": "soundness", "name": "Correctness / Soundness", "max_points": 30,
     "description": "The explained approach is technically correct and would actually work."},
    {"id": "clarity", "name": "Clarity of Explanation", "max_points": 30,
     "description": "A reader unfamiliar with the task could follow the reasoning."},
]
WHAT = ("What to write: In the answer box, write what you would say out loud, as you would say it. Aim for 150 to 250 words. "
        "Use short spoken-style sentences, not bullet points.")

# (topic, one-line meaning for "Words to know")
TECH = [
    ("large language models (LLMs)", "computer programs trained on huge amounts of text so they can write and answer in plain language"),
    ("retrieval-augmented generation (RAG)", "an AI that first looks up the right documents, then answers using them"),
    ("AI agents", "AI helpers that can plan steps and use tools on their own to finish a job"),
    ("Docker containers", "a box that holds an app with everything it needs, so it runs the same on any computer"),
    ("Kubernetes", "a system that starts, watches and restarts many containers across many machines"),
    ("serverless functions", "small pieces of a backend that run only when called, on servers someone else manages"),
    ("CI/CD with GitHub Actions", "automatic checks and releases that run every time code is pushed"),
    ("vector databases", "databases that find items with similar meaning, not just the same words"),
    ("GraphQL", "a way for an app to ask a server for exactly the data it needs in one request"),
    ("edge computing and CDNs", "running or storing things on servers close to the user so pages load faster"),
]
STRUCT = [
    ("a React web app", "a website made of small reusable screen parts called components"),
    ("a Python FastAPI backend", "a Python server that answers requests from apps over the web"),
    ("a Node.js Express API", "a JavaScript server that answers web requests"),
    ("a Java Spring Boot service", "a Java backend made with the Spring Boot framework"),
    ("a data analysis project with notebooks", "a project where you explore data step by step in notebook files"),
    ("an Android app", "an app for Android phones, made of screens, logic and resources"),
    ("a full-stack MERN app", "an app with a MongoDB database, an Express server, a React screen and Node.js"),
    ("a machine learning model project", "a project that trains a model on data and saves it for use"),
    ("a plain HTML, CSS and JavaScript website", "a simple website made of pages, styles and scripts"),
    ("a Flutter mobile app", "one app project that runs on both Android and iPhone"),
]
ROAD = [
    ("full-stack web developer", "someone who makes both the screens and the server side of a website"),
    ("data scientist", "someone who finds answers and predictions in data"),
    ("machine learning engineer", "someone who trains AI models and puts them into real products"),
    ("cloud engineer", "someone who sets up and runs apps on cloud services like AWS or Azure"),
    ("DevOps engineer", "someone who automates testing, releasing and running software"),
    ("cybersecurity analyst", "someone who protects systems and finds attacks and weak spots"),
    ("mobile app developer", "someone who makes apps for phones"),
    ("data analyst", "someone who cleans data and turns it into reports and charts for decisions"),
    ("backend developer", "someone who makes the server, database and APIs behind an app"),
    ("AI engineer", "someone who builds products on top of AI models like LLMs"),
]
TOPIC = [
    ("recursion", "a function that solves a problem by calling itself on a smaller part of it"),
    ("SQL JOINs", "a way to combine rows from two tables that share a column"),
    ("REST APIs", "a common way for apps to ask a server for data using web addresses"),
    ("Git branching and merging", "working on a separate copy of a project and then joining the changes back"),
    ("object-oriented programming", "organising a program around objects that hold data and actions together"),
    ("Big-O time complexity", "a way to say how much slower a solution gets as the input grows"),
    ("how an HTTP request and response work", "how a browser asks a server for something and gets an answer"),
    ("hash tables", "a structure that finds a value by its key almost instantly"),
    ("overfitting in machine learning", "when a model learns the training data too well and fails on new data"),
    ("async and await", "a way to wait for slow work, like a web call, without freezing the program"),
]


def tech(t):
    return (f"Explain {t} to an interviewer",
            f"You are in a technical interview. The interviewer says: \"Everyone talks about {t}. Explain it to me "
            f"as if I were a new teammate.\" You want to show you really understand it, not just the name.\n\n"
            f"Your task: Explain what {t} is, the problem it solves, one real place it is used, and one limit or risk.\n\n" + WHAT,
            f"Explain what {t} is and why people use it, in a short spoken answer for an interviewer.",
            f"You are in an interview. You are asked to explain {t}. Say what it is, what problem it solves, one real use, "
            f"and one weak point. Write it the way you would say it, about 150 to 250 words.",
            ["Say in one sentence what it is.", "Say what problem it solves, with an everyday comparison.",
             "Give one real place it is used.", "Say one limit or risk.", "Read it aloud and check it is 150 to 250 words."],
            f"You have written a spoken answer of 150 to 250 words that says what {t} is, what it solves, one real use and one limit.")


def struct(t):
    return (f"Walk through the VS Code project structure of {t}",
            f"In an interview, you share your screen with {t} open in VS Code. The interviewer says: \"Walk me "
            f"through how this project is organised.\" A new teammate should understand where everything lives.\n\n"
            f"Your task: Describe the main folders and files you would see in the VS Code explorer, what each one is for, "
            f"where you would add a new feature, and how you start the project and run its tests.\n\n" + WHAT,
            f"Describe how {t} is organised in VS Code: the main folders and files and what each is for.",
            f"Imagine {t} is open in VS Code. You talk an interviewer through the folders and files on the left side: "
            f"what each one is for, where a new feature would go, and how to start and test it. About 150 to 250 words.",
            ["List the top-level folders and files you would see.", "Say in one line what each main one is for.",
             "Say where you would add a new feature.", "Say how you start the project and run its tests.",
             "Check it is 150 to 250 words, in talking sentences."],
            f"You have written a 150 to 250 word walk-through of {t}'s folders and files, where a new feature goes, and how to run it.")


def road(t):
    return (f"Explain the roadmap to become a {t}",
            f"In an interview, you are asked: \"How are you preparing to become a {t}? Walk me through the path.\" "
            f"The interviewer wants a clear plan, not a list of buzzwords.\n\n"
            f"Your task: Explain the learning roadmap for a {t} in order: the main stages, what you would make or "
            f"practise at each stage, where you are on it today, and your next step this month.\n\n" + WHAT,
            f"Explain, in order, the steps to become a {t}, where you are now, and what you will do next.",
            f"An interviewer asks how you plan to become a {t}. Explain the stages of learning in order, what you would "
            f"practise at each stage, where you are today, and your next step. About 150 to 250 words.",
            ["Name the 3 to 5 main stages in order.", "For each stage, say one thing you would make or practise.",
             "Say honestly where you are today.", "Say your next step for this month.", "Check it is 150 to 250 words."],
            f"You have written a 150 to 250 word answer that gives the {t} roadmap in order, where you are, and your next step.")


def topic(t):
    return (f"Explain {t} in simple words",
            f"In an interview, you are asked: \"Pick something you learned recently - explain {t} to a junior who "
            f"has never heard of it.\" Good engineers can make hard ideas simple.\n\n"
            f"Your task: Explain {t} in plain words, using one everyday comparison, one small real example of where "
            f"it is used, and one common mistake people make with it.\n\n" + WHAT,
            f"Explain {t} so a beginner understands it, with an everyday comparison and a real example.",
            f"You teach {t} to a junior in an interview answer. Use plain words, one everyday comparison, one real "
            f"example, and one common mistake. About 150 to 250 words.",
            ["Say what it is in one plain sentence.", "Give an everyday comparison.", "Give one small real example of its use.",
             "Name one common mistake.", "Check it is 150 to 250 words."],
            f"You have written a 150 to 250 word plain explanation of {t} with a comparison, a real example and a common mistake.")


SAMPLE = ("A tiny made-up example of the style: 'Think of it like a library. Instead of guessing, you first find the "
          "right book, then answer from it.' This is only a sample of the style, not your answer.")
REF = ("A strong answer is spoken, plain and specific: it opens with one clear sentence that answers the question, "
       "uses one everyday comparison, gives one concrete real-world example, names one limit or common mistake, "
       "and ends with what the speaker would do or learn next. It stays between 150 and 250 words and never "
       "just lists buzzwords.")


def q(s):
    return "'" + s.replace("'", "''") + "'"


def main(out):
    rows = []
    for kind, items in (("tech", TECH), ("struct", STRUCT), ("road", ROAD), ("topic", TOPIC)):
        fn = {"tech": tech, "struct": struct, "road": road, "topic": topic}[kind]
        for t, meaning in items:
            title, scenario, one, means, steps, done = fn(t)
            brief = {"in_one_line": one, "what_it_means": means, "steps": steps, "example": SAMPLE,
                     "words": [{"word": t, "meaning": meaning},
                               {"word": "interview", "meaning": "a meeting where someone asks you questions to decide if you get a job"}],
                     "done_when": done}
            key = hashlib.sha256(f"{title}\n{scenario}".encode()).hexdigest()
            slug = hashlib.md5(title.encode()).hexdigest()[:12]
            rows.append(f"""with sc as (insert into public.source_content (source_id, url, title, markdown, content_hash, fetch_method, rights_flag, visibility)
  values ('{REG}', 'prooflab://pitch/{slug}', {q(title)}, {q(scenario)}, '{slug}', 'manual', 'ORIGINAL_ONLY', 'platform')
  on conflict (source_id, content_hash) do nothing returning id),
rc as (insert into public.task_rubric_config (prompt_text, criteria, min_words, max_words, pass_threshold, reference_answer, origin)
  select {q(scenario)}, {q(json.dumps(CRITERIA))}::jsonb, 150, 250, 70, {q(REF)}, 'manual' from sc returning id)
insert into public.lot_templates (title, scenario, source_jd, difficulty, estimate_minutes, lot_category, origin, xp_reward, rubric_config_id, source_content_id)
  select {q(title)}, {q(scenario)}, 'Written by ProofLab (pitch practice)', 'Easy', 20, 'pitch', 'ai', 10, rc.id, sc.id from sc, rc;
insert into public.task_explainers (key, brief) values ('{key}', {q(json.dumps(brief, ensure_ascii=False))}::jsonb) on conflict (key) do nothing;""")
    head = """-- 235 (owner 12 Nov 2026, TEST): 40 more pitch Lots, hand-written by ProofLab (no AI to make or explain them):
--   10 x explain a new technology, 10 x walk through a VS Code project structure, 10 x explain a career roadmap,
--   10 x explain one topic in simple words. Each has its own page (source registry "Material added by a ProofLab
--   admin", prooflab:// address, never shown as a link), its own checker (pass 70, 150-250 words) and a stored
--   simple explainer (task_explainers), so opening it calls no AI. The Thursday picker (next_lot_pick) sees them
--   through lot_candidates (made by the lot_template_to_candidate trigger).
-- Rollback: migration/235-rollback-pitch-lots-40.sql
begin;
"""
    tail = """
do $$
declare n int;
begin
  select count(*) into n from public.lot_templates t join public.lot_candidates c on c.lot_template_id = t.id
   where t.source_jd = 'Written by ProofLab (pitch practice)' and c.status = 'active';
  if n <> 40 then raise exception '235 self-check: % active pitch candidates, want 40', n; end if;
  if exists (select 1 from public.lot_templates where source_jd = 'Written by ProofLab (pitch practice)'
              and public.lot_text_asks_for_code(title, scenario, code_sample)) then
    raise exception '235 self-check: a pitch Lot reads like a coding task';
  end if;
end $$;
commit;
"""
    open(out, "w", encoding="utf-8", newline="\n").write(head + "\n".join(rows) + tail)
    assert len(rows) == 40


if __name__ == "__main__":
    main(sys.argv[1])
