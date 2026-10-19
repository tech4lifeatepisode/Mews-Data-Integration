"""Two-page summary of the Final_Format reconciliation work (16 Oct 2026)."""
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

OUT = Path(__file__).resolve().parent / "Mews-Data-Reconciliation-Summary-16-10-2026.pdf"

styles = getSampleStyleSheet()
H1 = ParagraphStyle("H1", parent=styles["Title"], fontSize=16, spaceAfter=4)
SUB = ParagraphStyle("Sub", parent=styles["Normal"], fontSize=9, textColor=colors.grey, spaceAfter=8)
H2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=11.5, spaceBefore=7, spaceAfter=3,
                    textColor=colors.HexColor("#1F3A5F"))
BODY = ParagraphStyle("Body", parent=styles["Normal"], fontSize=9, leading=11.8, spaceAfter=3)
BUL = ParagraphStyle("Bul", parent=BODY, leftIndent=10, bulletIndent=2, spaceAfter=1.5)
CELL = ParagraphStyle("Cell", parent=BODY, fontSize=8.3, leading=10, spaceAfter=0)
HEAD = ParagraphStyle("Head", parent=CELL, textColor=colors.white, fontName="Helvetica-Bold")


def p(text):
    return Paragraph(text, BODY)


def bullets(items):
    return [Paragraph(t, BUL, bulletText="•") for t in items]


def table(rows, widths):
    data = [[Paragraph(str(c), HEAD if i == 0 else CELL) for c in r] for i, r in enumerate(rows)]
    t = Table(data, colWidths=widths, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F3A5F")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#BBBBBB")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F2F5F9")]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    return t


story = []

# ---------------- Page 1 ----------------
story.append(Paragraph("Mews Data Integration – Reconciliation Summary", H1))
story.append(Paragraph("Contracts vs. Seguimiento vs. HouseMonk · status as of 16 October 2026", SUB))

story.append(Paragraph("1. Purpose", H2))
story.append(p(
    "Before importing reservations into Mews, every reservation (identified by its NC code, e.g. "
    "<b>NC_1858</b>) is compared across three sources: the contract extraction "
    "(<i>Final_Format_Customers_Contracts_Extraction_15_10_2026</i>), the Seguimiento tracking sheet "
    "(<i>Final_Format_Seguimiento_15_10_2026</i>) and the HouseMonk billing system "
    "(<i>Final_Format_HouseMonk_15_10_2026</i>). Reservations where everything agrees are ready for import; "
    "the rest are listed in review tables by type of disagreement."))

story.append(Paragraph("2. How the comparison works", H2))
story.append(p(
    "A single build script (<i>contract-extraction/build-final-format-three-way-match.mjs</i>, run via "
    "<i>upload-matching-across-final-format-15-10-2026.mjs</i>) loads all three sources, links rows by NC "
    "number, compares each field and rewrites every result table in Supabase. HouseMonk rows already flagged "
    "in <i>Missing_Group_Code_HouseMonk_15_10_2026</i> (15) are left out. Current rules:"))
story.extend(bullets([
    "<b>Names</b> – Contract vs. HouseMonk takes priority; tolerant of accents, spelling variants "
    "(e.g. Luis/Lluis), extra given names and multi-guest HouseMonk strings.",
    "<b>Unit types</b> – labels are normalised to common categories (Standard, Standard + Terrace, Comfort, "
    "Rooftop, Two Bedroom 2+1 / 2+2, etc.), ignoring PMR tags and typos.",
    "<b>Dates</b> – arrival and departure must agree across every source present.",
    "<b>Extras</b> (meal plan / parking) – treated as matching when contract and HouseMonk both exist, because "
    "HouseMonk exports do not carry these flags.",
    "<b>Rent</b> and <b>deposit</b> (new) – when contract and HouseMonk both exist, only that pair is compared, "
    "with a <b>±€10</b> tolerance; Seguimiento differences are ignored.",
]))

story.append(Paragraph("3. Data corrections applied", H2))
story.extend(bullets([
    "<b>Missing contract rows (26 NCs).</b> Mismatch rows had no contract linked. 14 existed in "
    "<i>Customers_Contracts_Extraction_12_10_2026</i> but were not copied (NC_932 vs NC_0932 formatting) and were "
    "added. 12 had no contract at all (likely B2B2C / no PDF) and were created from Seguimiento + HouseMonk data, "
    "marked <i>Source: Seguimiento+HouseMonk backfill</i>.",
    "<b>Deposit extraction errors (4 NCs).</b> NC_1858 (1 → 1005), NC_1777 (1.02 → 1020), NC_1273 "
    "(1950 → 995), NC_1290 (1970 → 985) were set to the Seguimiento/HouseMonk value.",
    "<b>Fundación Mamá Cumbé (68 rows, NC_1963–2030).</b> The company agreement states 1441 €/month "
    "including 10% VAT; HouseMonk invoices 1310 €/month. Contract rent was set to 1310.",
    "<b>Other company contracts (24 fixes).</b> Where the contract is company-linked (partner company, match "
    "in <i>Companies_Extraction_12_10_2026</i>, or a company name as guest) and Seguimiento and HouseMonk agree, "
    "the contract rent/deposit was aligned to HouseMonk (e.g. CHAMARI ITG, JJ Activos España). A follow-up "
    "audit found <b>no remaining</b> rent or deposit mismatches caused by company agreements.",
]))

story.append(PageBreak())

# ---------------- Page 2 ----------------
story.append(Paragraph("4. Tables in Supabase", H2))
story.append(table([
    ["Table", "Content", "Rows"],
    ["Final_Format_Three_Way_Match_15_10_2026", "One row per NC found in at least 2 sources, with every value "
     "side by side and a match flag per field (incl. new rent_match / deposits_match)", "674"],
    ["Final_Format_All_Fields_Match_Mews_Import_15_10_2026", "<b>New.</b> Reservations where every field matches, "
     "with the exact 79 column headers of Mews_import_v2.10.0.xlsx (Customers sheet)", "389"],
    ["Final_Format_Mismatch_Names_15_10_2026", "Name disagreements", "23"],
    ["Final_Format_Mismatch_Unit_Types_15_10_2026", "Unit type disagreements", "18"],
    ["Final_Format_Mismatch_Dates_15_10_2026", "Arrival / departure disagreements", "107"],
    ["Final_Format_Mismatch_Rent_15_10_2026", "<b>New.</b> Monthly rent differs by more than €10", "148"],
    ["Final_Format_Mismatch_Deposits_15_10_2026", "<b>New.</b> Deposit differs by more than €10", "25"],
    ["Final_Format_Mismatch_Extras_15_10_2026", "Meal plan / parking disagreements", "0"],
], [8.6 * cm, 7.0 * cm, 1.4 * cm]))
story.append(Spacer(1, 4))
story.append(p(
    "Mismatch table layout: <i>nc_code</i>, <i>nc_number</i>, <b>guest_name</b>, <b>guest_document_number</b>, "
    "the compared values from each source, the source row ids (<i>customers_final_id</i>, "
    "<i>seguimiento_final_id</i>, <i>housemonk_final_id</i>) and finally an empty <b>Acutal Value</b> column "
    "for manual entry of the correct value."))

story.append(Paragraph("5. Progress", H2))
story.append(table([
    ["Stage", "Rent mismatches", "Deposit mismatches", "Fully matching reservations"],
    ["Rent / deposit added (exact amounts)", "508", "70", "120"],
    ["Seguimiento rescale fix (e.g. 1.32 = 1320)", "429", "70", "178"],
    ["Contract vs HouseMonk only, ±€10 tolerance", "234", "32", "306"],
    ["4 deposit fixes", "234", "28", "310"],
    ["Mamá Cumbé 1441 → 1310", "169", "28", "375"],
    ["Company-linked contracts aligned", "<b>148</b>", "<b>25</b>", "<b>389</b>"],
], [6.6 * cm, 3.2 * cm, 3.4 * cm, 3.8 * cm]))

story.append(Paragraph("6. What remains to review", H2))
story.extend(bullets([
    "<b>Rent (148):</b> 80 where Seguimiento and HouseMonk also disagree with each other (operational data "
    "issue); 68 individual contracts where the extracted rent differs from billing even though Seguimiento "
    "and HouseMonk agree – these need a case-by-case check against the PDF.",
    "<b>Deposits (25):</b> 16 where Seguimiento and HouseMonk disagree; 9 individual contracts.",
    "<b>Dates (107):</b> the rule is still strict across all sources; many are likely extensions or "
    "early departures that are recorded in one system only.",
    "<b>Names (23) and units (18):</b> small residual sets for manual review (e.g. NC_1943 Standard + "
    "Terrace in the contract vs Comfort in HouseMonk).",
    "<b>12 backfilled reservations</b> without a contract should be confirmed as B2B2C or similar.",
]))

story.append(Paragraph("7. How to refresh", H2))
story.append(p(
    "After any data change run <i>cd contract-extraction</i> then "
    "<i>node upload-matching-across-final-format-15-10-2026.mjs</i>. It rebuilds and overwrites all tables "
    "above (anything typed into <b>Acutal Value</b> will be cleared, so export reviewed values first). "
    "SQL for new columns/tables is in <i>contract-analysis</i> and documented in "
    "<i>RUN-IN-SUPABASE-SQL-EDITOR.md</i>. Note: the column-reorder SQL drops and recreates the mismatch "
    "tables, so the upload must be run again afterwards."))

doc = SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=1.8 * cm, rightMargin=1.8 * cm,
                        topMargin=1.5 * cm, bottomMargin=1.5 * cm,
                        title="Mews Data Reconciliation Summary 16-10-2026")
doc.build(story)
print(OUT)
