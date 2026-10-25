import { Link } from "react-router-dom";
import type { ReactNode } from "react";

/**
 * Terms & Conditions and Privacy Policy, linked from the landing page footer.
 *
 * DRAFT written from what the product actually does (names, college data, resumes, code,
 * recorded voice, AI marking). Have it reviewed by a lawyer before relying on it.
 */

const CONTACT = "hello@prooflab.co.in";
const UPDATED = "25 October 2026";

const LegalPage = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="min-h-screen bg-background text-foreground">
    <header className="border-b border-border">
      <div className="container mx-auto px-6 py-4 flex items-center justify-between">
        <Link to="/" className="font-bold">ProofLabAI</Link>
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">Back to home</Link>
      </div>
    </header>
    <main className="container mx-auto px-6 py-12 max-w-3xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="text-sm text-muted-foreground mt-1">Last updated {UPDATED}</p>
      </div>
      {children}
    </main>
  </div>
);

const Section = ({ heading, children }: { heading: string; children: ReactNode }) => (
  <section className="space-y-2">
    <h2 className="text-xl font-semibold">{heading}</h2>
    <div className="space-y-2 text-muted-foreground leading-relaxed">{children}</div>
  </section>
);

export const Terms = () => (
  <LegalPage title="Terms & Conditions">
    <Section heading="1. What ProofLabAI is">
      <p>
        ProofLabAI is a platform where engineering students do one real task a day, explain it aloud, and build a record of
        verified work. Colleges and companies can see that record as described in the Privacy Policy.
      </p>
    </Section>
    <Section heading="2. Accounts">
      <p>
        Accounts are created by your college or by a ProofLabAI administrator. You cannot sign up on your own. Keep your
        password private and tell us if you think someone else is using your account. You are responsible for what is done
        under your account.
      </p>
    </Section>
    <Section heading="3. Doing your own work">
      <p>
        Tasks must be your own work. Do not copy another student's answer, share task answers, use another person to explain
        your work, or try to see hidden tests or answer keys. Answers that look copied are flagged and may be reviewed by a
        person, and your college may be told.
      </p>
    </Section>
    <Section heading="4. Using the service fairly">
      <p>
        Do not attack, overload or probe the platform, including the code editor and code runner. Code you run must not try to
        reach the internet, other users' data or the platform's systems. We may limit how often you can run or submit code.
      </p>
    </Section>
    <Section heading="5. Your content">
      <p>
        You keep ownership of your code, written answers and recordings. You allow ProofLabAI to store them, process them
        (including with the AI services described in the Privacy Policy), mark them, and show them to the people described in
        the Privacy Policy so the service can work.
      </p>
    </Section>
    <Section heading="6. Marks and AI">
      <p>
        Code is marked by running tests. Written answers and spoken explanations are marked with the help of AI and fixed
        rules, and some answers are held for a person to review. Marks are our best assessment and can be wrong. If you think a
        mark is wrong, tell your college or write to us.
      </p>
    </Section>
    <Section heading="7. Availability">
      <p>
        We work to keep the service running but do not promise it will always be available or error free. Features may change.
      </p>
    </Section>
    <Section heading="8. Ending access">
      <p>
        Your college or ProofLabAI may suspend or remove an account that breaks these terms or that the college asks us to
        close. Students cannot delete their own accounts or recordings from the app; ask your college or write to us.
      </p>
    </Section>
    <Section heading="9. Changes and contact">
      <p>
        We may update these terms and will change the date above when we do. Questions: <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </Section>
  </LegalPage>
);

export const PrivacyPolicy = () => (
  <LegalPage title="Privacy Policy">
    <Section heading="1. What we collect">
      <ul className="list-disc pl-6 space-y-1">
        <li>Account details from your college or administrator: name, email, college, branch, section and roll number.</li>
        <li>Your resume text and the skills, projects and certificates read from it, if you use the resume check.</li>
        <li>Your work: code, written answers, marks, test results and feedback.</li>
        <li>Your spoken explanations: the audio recording, its transcript and its score.</li>
        <li>Activity: when you were active, streaks, squad and season results, and a step trail of the screens you use.</li>
        <li>Security events, such as failed sign-ins.</li>
      </ul>
    </Section>
    <Section heading="2. Why we use it">
      <p>
        To run the service: to give you a daily task, mark your work, show your progress, run squads and seasons, keep the
        platform safe, and let colleges and companies see verified work as described below.
      </p>
    </Section>
    <Section heading="3. Who can see it">
      <ul className="list-disc pl-6 space-y-1">
        <li><b>You</b> see all of your own record.</li>
        <li><b>Your college</b> (its placement officers) sees progress, marks and activity for its own students only.</li>
        <li><b>Companies</b> can see your profile, verified work and scored explanations only when you are set as discoverable. Recordings are played through a protected player.</li>
        <li><b>Public portfolio:</b> a page is public only if you publish it.</li>
        <li><b>ProofLabAI administrators</b> can see records needed to run and protect the service.</li>
      </ul>
    </Section>
    <Section heading="4. AI services">
      <p>
        To read resumes, write tasks and mark written answers and explanations, parts of your text (such as your answer, the
        transcript of your recording or your resume text) are sent to AI providers. We use DeepSeek, with Google Gemini and
        Kimi as backups. Speech is turned into text on ProofLabAI's own service. We ask the AI to ignore instructions hidden in
        your text, and we do not use a mark if the AI fails.
      </p>
    </Section>
    <Section heading="5. Where it is stored and how it is protected">
      <p>
        Data is stored on Google Cloud in Mumbai, India. Your sign-in session is kept in a protected cookie that web pages
        cannot read. The database restricts each college to its own students. Private files, such as recordings, are not
        publicly reachable.
      </p>
    </Section>
    <Section heading="6. How long we keep it">
      <p>
        We keep the audio of your 7 newest recordings (task and mock interview together) and remove older audio automatically.
        Your scores, feedback and written work stay in your history. Activity step trails are cleared after about 90 days.
        Other records are kept while your account is active and as your college needs for its placement records.
      </p>
    </Section>
    <Section heading="7. Your choices">
      <ul className="list-disc pl-6 space-y-1">
        <li>Choose whether companies can discover you, and whether to share your voice recordings, in your Privacy settings.</li>
        <li>Ask your college or us to correct or remove your data. Students cannot delete their own account in the app.</li>
      </ul>
    </Section>
    <Section heading="8. Cookies">
      <p>We use one sign-in session cookie that is needed for the service to work. We do not use advertising cookies.</p>
    </Section>
    <Section heading="9. Contact">
      <p>
        Questions or requests about your data: <a className="underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        We may update this policy and will change the date above when we do.
      </p>
    </Section>
  </LegalPage>
);
