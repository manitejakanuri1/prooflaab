import jsPDF from "jspdf";

export function downloadResumeAsPdf(text: string, filename = "improved-resume.pdf") {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const marginX = 48;
  const marginY = 56;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - marginX * 2;
  const lineHeight = 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);

  let y = marginY;
  const lines = text.split("\n");

  for (const rawLine of lines) {
    const wrapped = doc.splitTextToSize(rawLine, maxWidth) as string[];
    for (const line of wrapped) {
      if (y > pageHeight - marginY) {
        doc.addPage();
        y = marginY;
      }
      const isHeading = /^[A-Z][A-Z\s&/]+$/.test(rawLine.trim()) && rawLine.trim().length > 2;
      doc.setFont("helvetica", isHeading ? "bold" : "normal");
      doc.text(line, marginX, y);
      y += lineHeight;
    }
  }

  doc.save(filename);
}
