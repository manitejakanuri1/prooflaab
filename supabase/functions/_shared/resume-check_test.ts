import { fileTypeMatches, resumeShapeProblem } from './resume-check.ts';

const assert = (ok: boolean, msg: string) => { if (!ok) throw new Error(msg); };

const RESUME = `Siva Kumar
siva.kumar@gmail.com | +91 98765 43210
EDUCATION
B.Tech Computer Science, 2026
SKILLS
Python, React, SQL
PROJECTS
Attendance app - React and Firebase`;

const ASSIGNMENT = `Assignment 3: Operating Systems
Q1. Explain the difference between a process and a thread.
A process has its own memory space while threads share memory within a process.
Q2. What is a deadlock? A deadlock happens when two processes each wait for a resource the other holds.`;

const REPORT_WITH_EMAIL = `Project Report on Water Quality
Submitted to prof.rao@college.edu
Chapter 1 Introduction. Water quality in the region has declined over the past decade.
Chapter 2 Methodology. Samples were collected from twelve sites.`;

Deno.test('a real resume passes', () => {
  assert(resumeShapeProblem(RESUME) === null, 'resume should pass');
});

Deno.test('a resume with only a phone number and a LinkedIn link passes', () => {
  const t = 'Ravi\nlinkedin.com/in/ravi\nSkills: Java\nExperience: Intern at X';
  assert(resumeShapeProblem(t) === null, 'linkedin counts as contact');
});

Deno.test('an assignment is refused: no contact details', () => {
  assert(resumeShapeProblem(ASSIGNMENT) === 'no contact details', 'assignment should fail');
});

Deno.test('a report with an email but no resume sections is refused', () => {
  assert(resumeShapeProblem(REPORT_WITH_EMAIL) === 'no resume sections', 'report should fail');
});

Deno.test('a very long document is refused', () => {
  assert(resumeShapeProblem(RESUME + ' word'.repeat(7000)) === 'too long for a resume', 'long doc should fail');
});

Deno.test('file bytes must match the file type', () => {
  const pdf = new TextEncoder().encode('%PDF-1.7 ...');
  const zip = new Uint8Array([0x50, 0x4b, 3, 4, 0]);
  assert(fileTypeMatches(pdf, true), 'pdf bytes are a pdf');
  assert(!fileTypeMatches(zip, true), 'zip bytes are not a pdf');
  assert(fileTypeMatches(zip, false), 'zip bytes are a docx');
  assert(!fileTypeMatches(pdf, false), 'pdf bytes are not a docx');
});
