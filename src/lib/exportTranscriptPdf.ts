import { jsPDF } from "jspdf";

/**
 * A neat, downloadable record of one spoken answer — the question, exactly
 * what was said, the score, and the feedback. Built entirely in the browser
 * (jsPDF), no server involved, generates in well under a second.
 */
export interface TranscriptPdfEntry {
  question: string;
  transcript: string;
  score?: number | null;
  feedback?: string | null;
}

export interface TranscriptPdfOptions {
  title: string;
  studentName?: string;
  date?: Date;
  entries: TranscriptPdfEntry[];
  overallScore?: number | null;
  overallFeedback?: string | null;
}

const MARGIN = 18;
const PAGE_WIDTH = 210;
const USABLE_WIDTH = PAGE_WIDTH - MARGIN * 2;

export function exportTranscriptPdf(opts: TranscriptPdfOptions, filename: string): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = MARGIN;

  const ensureSpace = (needed: number) => {
    if (y + needed > 280) { doc.addPage(); y = MARGIN; }
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(opts.title, MARGIN, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(110);
  const meta = [opts.studentName, (opts.date ?? new Date()).toLocaleDateString()].filter(Boolean).join(" · ");
  doc.text(meta, MARGIN, y);
  doc.setTextColor(20);
  y += 10;

  if (opts.overallScore != null) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(`Overall score: ${opts.overallScore}/100`, MARGIN, y);
    y += 7;
  }
  if (opts.overallFeedback) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(opts.overallFeedback, USABLE_WIDTH);
    ensureSpace(lines.length * 5 + 4);
    doc.text(lines, MARGIN, y);
    y += lines.length * 5 + 6;
  }

  opts.entries.forEach((entry, i) => {
    ensureSpace(20);
    doc.setDrawColor(220);
    doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
    y += 6;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    const qLines = doc.splitTextToSize(`${i + 1}. ${entry.question}`, USABLE_WIDTH);
    ensureSpace(qLines.length * 5.5);
    doc.text(qLines, MARGIN, y);
    y += qLines.length * 5.5 + 2;

    if (entry.score != null) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(90);
      doc.text(`Scored ${entry.score}/100`, MARGIN, y);
      doc.setTextColor(20);
      y += 5;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const transcriptLines = doc.splitTextToSize(entry.transcript || "(no speech captured)", USABLE_WIDTH);
    ensureSpace(transcriptLines.length * 5);
    doc.text(transcriptLines, MARGIN, y);
    y += transcriptLines.length * 5 + 2;

    if (entry.feedback) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9.5);
      doc.setTextColor(70);
      const fbLines = doc.splitTextToSize(entry.feedback, USABLE_WIDTH);
      ensureSpace(fbLines.length * 5);
      doc.text(fbLines, MARGIN, y);
      doc.setTextColor(20);
      y += fbLines.length * 5 + 4;
    } else {
      y += 4;
    }
  });

  doc.save(filename);
}
