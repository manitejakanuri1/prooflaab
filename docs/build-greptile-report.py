"""Build the Greptile findings report as a PDF."""
import io
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, PageBreak,
                                PageTemplate, Paragraph, Spacer, Table, TableStyle)

OUT = r"C:\Users\manit\prooflabai-mvp\docs\greptile-review-2026-08-23.pdf"

INK      = colors.HexColor("#16181d")
MUTED    = colors.HexColor("#63676f")
RULE     = colors.HexColor("#d8d5cd")
PAPER    = colors.HexColor("#f4f1ea")
RED      = colors.HexColor("#b3391c")
GREEN    = colors.HexColor("#2f6f4e")
CODE_BG  = colors.HexColor("#1b1d22")
CODE_INK = colors.HexColor("#d9dde4")

ss = getSampleStyleSheet()

def style(name, **kw):
    base = dict(fontName="Helvetica", fontSize=9.5, leading=14, textColor=INK,
                alignment=TA_LEFT, spaceAfter=0)
    base.update(kw)
    return ParagraphStyle(name, **base)

TITLE   = style("title", fontName="Helvetica-Bold", fontSize=23, leading=27, spaceAfter=2)
SUB     = style("sub", fontSize=10.5, leading=15, textColor=MUTED)
EYEBROW = style("eyebrow", fontName="Helvetica-Bold", fontSize=7.5, leading=11,
                textColor=MUTED, spaceAfter=3)
H1      = style("h1", fontName="Helvetica-Bold", fontSize=14, leading=18, spaceAfter=5)
H2      = style("h2", fontName="Helvetica-Bold", fontSize=10.5, leading=14, spaceAfter=3)
BODY    = style("body", spaceAfter=7)
SMALL   = style("small", fontSize=8.5, leading=12.5, textColor=MUTED)
CODE    = style("code", fontName="Courier", fontSize=8, leading=11.5, textColor=CODE_INK)
CODEL   = style("codel", fontName="Courier", fontSize=8, leading=11.5, textColor=INK)


def code_block(lines, tone="dark"):
    body = "<br/>".join(l.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                        .replace(" ", "&nbsp;") for l in lines)
    para = Paragraph(body, CODE if tone == "dark" else CODEL)
    t = Table([[para]], colWidths=[165 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CODE_BG if tone == "dark" else PAPER),
        ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LINEBEFORE", (0, 0), (0, -1), 2, RED if tone == "dark" else GREEN),
    ]))
    return t


def kv_table(rows, widths=(38 * mm, 127 * mm)):
    data = [[Paragraph(f"<b>{k}</b>", SMALL), Paragraph(v, BODY)] for k, v in rows]
    t = Table(data, colWidths=list(widths))
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
    ]))
    return t


def badge_row(pill, text):
    p = Table([[Paragraph(f"<b>{pill}</b>", ParagraphStyle(
        "pill", fontName="Helvetica-Bold", fontSize=8, leading=10,
        textColor=colors.white))]], colWidths=[13 * mm])
    p.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), RED),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    row = Table([[p, Paragraph(text, H1)]], colWidths=[16 * mm, 149 * mm])
    row.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return row


def rule(space_before=6, space_after=8):
    t = Table([[""]], colWidths=[165 * mm], rowHeights=[0.1])
    t.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, 0), 0.7, RULE)]))
    return [Spacer(1, space_before), t, Spacer(1, space_after)]


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(22 * mm, 12 * mm, "ProofLabAI  ·  Greptile review of PR #1  ·  23 August 2026")
    canvas.drawRightString(188 * mm, 12 * mm, f"{doc.page}")
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.5)
    canvas.line(22 * mm, 16 * mm, 188 * mm, 16 * mm)
    canvas.restoreState()


story = []

# -- cover block ---------------------------------------------------------
story.append(Paragraph("CODE REVIEW FINDINGS", EYEBROW))
story.append(Paragraph("Two P1 bugs in the Daily Lot engine", TITLE))
story.append(Spacer(1, 4))
story.append(Paragraph(
    "Greptile's first automated review of the ProofLabAI codebase, run against pull request #1 "
    "on 23 August 2026. It found two defects. Both were real, both were reproduced before being "
    "fixed and again afterwards, and both are now live.", SUB))
story.append(Spacer(1, 10))

story.append(kv_table([
    ("Reviewed", "PR #1 — 23 files, +3,924 / -45 lines, three commits from 22–23 August"),
    ("Findings", '2 raised, 2 confirmed real, 2 fixed. Both rated <font color="#b3391c"><b>P1</b></font>; one also tagged Security.'),
    ("Method", "Greptile ran the code rather than only reading it, and attached the runs as evidence."),
    ("Fixed in", "Commit ca6ce47, deployed to production the same day"),
]))

story += rule(10, 12)

# -- finding 1 -----------------------------------------------------------
story.append(badge_row("P1", "Paying the AI provider twice for the same work"))
story.append(Paragraph("supabase/functions/lot-writer/index.ts", SMALL))
story.append(Spacer(1, 8))

story.append(Paragraph("What happens", H2))
story.append(Paragraph(
    "A Lot — the day's piece of work — is written once per topic by an AI model and then shared by "
    "every student who reaches that topic. That design exists precisely to keep the bill small: 146 "
    "topics means at most 146 paid calls, ever.", BODY))
story.append(Paragraph(
    "The check for “has this topic been written yet?” and the write that records the answer were "
    "separated by the model call itself, which takes several seconds. Two students arriving inside "
    "that window both saw an unwritten topic and both paid for it.", BODY))
story.append(Spacer(1, 4))
story.append(code_block([
    "student A  --read: not written-->  call the model (5s)  -->  save   PAID",
    "student B  --read: not written-->  call the model (5s)  -->  save   PAID AGAIN",
    "                                                             ^",
    "                              the two only converge after both bills",
]))
story.append(Spacer(1, 9))

story.append(Paragraph("Why it matters", H2))
story.append(Paragraph(
    "It is money, and it scales the wrong way. On the morning a cohort of students reaches the same "
    "new topic together, the number of duplicate charges rises with the number of students arriving "
    "at once — the opposite of what the write-once design was built to guarantee.", BODY))
story.append(Spacer(1, 2))

story.append(Paragraph("The fix", H2))
story.append(Paragraph(
    "A claim, taken in the database before any money is spent. One caller wins a conditional update "
    "and generates; everyone else is told the topic is being written and returns immediately. The "
    "claim expires after two minutes, so a crashed or timed-out generation cannot lock a topic out "
    "permanently, and it is released explicitly on every failure path.", BODY))
story.append(Spacer(1, 4))
story.append(code_block([
    "three simultaneous requests, one fresh topic:",
    "",
    "  caller 2   written: true, provider deepseek     <- one paid call",
    "  caller 0   \"another request is writing this topic\"",
    "  caller 1   \"another request is writing this topic\"",
], tone="light"))
story.append(Spacer(1, 5))
story.append(Paragraph(
    "<i>Verified against the live system with three concurrent HTTP calls under a real student "
    "session — not a simulation.</i>", SMALL))

story.append(PageBreak())

# -- finding 2 -----------------------------------------------------------
story.append(badge_row("P1", "The Daily Card could fail to load, or stop the nightly run"))
story.append(Paragraph("supabase/migrations — create_lot_for()", SMALL))
story.append(Spacer(1, 8))

story.append(Paragraph("What happens", H2))
story.append(Paragraph(
    "The same shape of race, one layer down. The function asks whether the student already has a Lot "
    "for today; if not, it creates one. A database rule allows only one Lot per student per day. Two "
    "callers passing that check together both tried to insert, and the loser was handed a "
    "duplicate-key error rather than the Lot that had just been created.", BODY))
story.append(Spacer(1, 4))
story.append(code_block([
    "caller A   no Lot today  -->  insert   OK",
    "caller B   no Lot today  -->  insert   ERROR  duplicate key",
    "",
    "who hits this:  the nightly job and a student opening the page",
    "                at the same moment, or one page opened twice",
]))
story.append(Spacer(1, 9))

story.append(Paragraph("Why it matters", H2))
story.append(Paragraph(
    "Two different failures, depending on who loses. A student sees an empty Daily Card — the one "
    "screen the product opens on — with no explanation and no work to do. Or the nightly job that "
    "prepares tomorrow's Lots aborts mid-loop, and every student after that point in the run wakes "
    "up with nothing.", BODY))
story.append(Spacer(1, 2))

story.append(Paragraph("The fix", H2))
story.append(Paragraph(
    "The insert now tolerates the collision instead of raising on it, and the caller that loses reads "
    "back the winner's Lot and reports it as today's Lot — which is exactly what it is.", BODY))
story.append(Spacer(1, 4))
story.append(code_block([
    "two callers straddling the check:",
    "",
    "  caller A   created: true    task 5e885339",
    "  caller B   created: false   task 5e885339   <- same Lot, no error",
    "  rows for the day: 1",
], tone="light"))

story += rule(14, 12)

# -- the third bug -------------------------------------------------------
story.append(Paragraph("A third bug, found while fixing the first", H1))
story.append(Paragraph(
    "The first deployment of the claim refused every caller, including the one that should have won, "
    "so nothing was generated at all. The cause is a trap worth recording, because it will recur:", BODY))
story.append(Spacer(1, 3))
story.append(code_block([
    "revoke all on function ... from public, anon, authenticated",
    "",
    "  ^ the standard sweep that keeps new functions away from browsers.",
    "    It works because Postgres grants EXECUTE to PUBLIC by default -",
    "    which means it also strips service_role, the identity the edge",
    "    functions run as. Any function an edge function calls has to be",
    "    granted back by name.",
]))
story.append(Spacer(1, 8))
story.append(Paragraph(
    "Caught by re-running the concurrency test after deploying, rather than by assuming the fix "
    "worked. It is now written into the migration so the next person meets the explanation before "
    "they meet the bug.", BODY))

story += rule(12, 10)

# -- status --------------------------------------------------------------
status = Table([
    [Paragraph("<b>Finding</b>", SMALL), Paragraph("<b>Severity</b>", SMALL),
     Paragraph("<b>State</b>", SMALL), Paragraph("<b>Proof</b>", SMALL)],
    [Paragraph("Duplicate provider charges", BODY), Paragraph("P1 · Security", BODY),
     Paragraph('<font color="#2f6f4e"><b>Fixed, live</b></font>', BODY),
     Paragraph("3 concurrent calls, 1 paid", SMALL)],
    [Paragraph("Daily Lot duplicate key", BODY), Paragraph("P1", BODY),
     Paragraph('<font color="#2f6f4e"><b>Fixed, live</b></font>', BODY),
     Paragraph("2 racing callers, 1 row", SMALL)],
    [Paragraph("service_role lost EXECUTE", BODY), Paragraph("Found in-house", BODY),
     Paragraph('<font color="#2f6f4e"><b>Fixed, live</b></font>', BODY),
     Paragraph("Re-ran the same test", SMALL)],
], colWidths=[58 * mm, 30 * mm, 34 * mm, 43 * mm])
status.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK),
    ("LINEBELOW", (0, 1), (-1, -2), 0.4, RULE),
]))
story.append(KeepTogether([Paragraph("Status", H1), status]))
story.append(Spacer(1, 12))

story.append(Paragraph("What this review does not cover", H2))
story.append(Paragraph(
    "Both findings are races — two things happening at the same instant. That is the class of bug "
    "hardest to find by clicking through screens, and the class this review was worth running for. "
    "It says nothing about whether the features behave correctly for one user at a time; that was "
    "established separately by walking each flow against the live database.", BODY))
story.append(Spacer(1, 6))
story.append(Paragraph(
    "Greptile reviews pull requests only. Work pushed straight to the main branch is never seen by "
    "it — which is why nothing before this pull request has been reviewed.", BODY))

doc = BaseDocTemplate(OUT, pagesize=A4,
                      leftMargin=22 * mm, rightMargin=23 * mm,
                      topMargin=20 * mm, bottomMargin=22 * mm,
                      title="ProofLabAI — Greptile review of PR #1",
                      author="ProofLabAI")
frame = Frame(doc.leftMargin, doc.bottomMargin,
              doc.width, doc.height, id="body",
              leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=footer)])
doc.build(story)
print("written:", OUT)
