from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import Paragraph
from reportlab.pdfgen import canvas


PAGE_WIDTH, PAGE_HEIGHT = A4
MARGIN = 34

TEXT = HexColor("#111827")
MUTED = HexColor("#4B5563")
SOFT = HexColor("#6B7280")
BORDER = HexColor("#D1D5DB")
PANEL = HexColor("#F8FAFC")
PANEL_ALT = HexColor("#F3F4F6")
ACCENT = HexColor("#334155")
ARROW = HexColor("#64748B")


def build_styles():
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="BodySmall",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=9.1,
            leading=12.1,
            textColor=TEXT,
            alignment=TA_LEFT,
            spaceAfter=0,
            spaceBefore=0,
        )
    )
    styles.add(
        ParagraphStyle(
            name="BulletSmall",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=8.8,
            leading=11.2,
            textColor=TEXT,
            leftIndent=11,
            bulletIndent=0,
            spaceAfter=0,
            spaceBefore=0,
        )
    )
    styles.add(
        ParagraphStyle(
            name="StackSmall",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=8.8,
            leading=11.2,
            textColor=TEXT,
            spaceAfter=0,
            spaceBefore=0,
        )
    )
    return styles


def draw_label(c: canvas.Canvas, x: float, y: float, text: str):
    c.setFillColor(ACCENT)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(x, y, text.upper())


def draw_paragraph(c: canvas.Canvas, text: str, style, x: float, y_top: float, width: float):
    paragraph = Paragraph(text, style)
    _, height = paragraph.wrap(width, 1000)
    paragraph.drawOn(c, x, y_top - height)
    return height


def draw_panel(c: canvas.Canvas, x: float, y_top: float, width: float, height: float, radius: float = 10):
    c.setFillColor(PANEL)
    c.setStrokeColor(BORDER)
    c.roundRect(x, y_top - height, width, height, radius, fill=1, stroke=1)


def draw_section_box(
    c: canvas.Canvas,
    styles,
    x: float,
    y_top: float,
    width: float,
    height: float,
    title: str,
    content: str,
    style_name: str = "BodySmall",
):
    draw_panel(c, x, y_top, width, height)
    pad_x = 13
    pad_y = 12
    draw_label(c, x + pad_x, y_top - pad_y, title)
    draw_paragraph(
        c,
        content,
        styles[style_name],
        x + pad_x,
        y_top - pad_y - 10,
        width - pad_x * 2,
    )


def draw_bullet_box(
    c: canvas.Canvas,
    styles,
    x: float,
    y_top: float,
    width: float,
    height: float,
    title: str,
    items,
):
    draw_panel(c, x, y_top, width, height)
    pad_x = 13
    pad_y = 12
    draw_label(c, x + pad_x, y_top - pad_y, title)
    current_y = y_top - pad_y - 10
    for item in items:
        current_y -= draw_paragraph(
            c,
            item,
            styles["BulletSmall"],
            x + pad_x,
            current_y,
            width - pad_x * 2,
        )
        current_y -= 3


def draw_stack_box(
    c: canvas.Canvas,
    styles,
    x: float,
    y_top: float,
    width: float,
    height: float,
    items,
):
    draw_panel(c, x, y_top, width, height)
    pad_x = 13
    pad_y = 12
    draw_label(c, x + pad_x, y_top - pad_y, "Stack")
    current_y = y_top - pad_y - 9
    item_height = 18
    for item in items:
        current_y -= item_height
        c.setFillColor(white)
        c.setStrokeColor(BORDER)
        c.roundRect(x + pad_x, current_y, width - pad_x * 2, 13, 6, fill=1, stroke=1)
        c.setFillColor(TEXT)
        c.setFont("Helvetica", 8.7)
        c.drawString(x + pad_x + 8, current_y + 3.4, item)


def draw_header(c: canvas.Canvas):
    c.setFillColor(TEXT)
    c.setFont("Helvetica-Bold", 20)
    c.drawString(MARGIN, PAGE_HEIGHT - 46, "Softbox — AI Runtime for Safe")
    c.drawString(MARGIN, PAGE_HEIGHT - 68, "App Modification and Promotion")

    c.setFillColor(MUTED)
    c.setFont("Helvetica", 10.3)
    c.drawString(
        MARGIN,
        PAGE_HEIGHT - 88,
        "Selected work sample for AI engineering, orchestration, and deployment workflow projects",
    )

    c.setStrokeColor(BORDER)
    c.setLineWidth(0.9)
    c.line(MARGIN, PAGE_HEIGHT - 101, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 101)


def draw_summary(c: canvas.Canvas, styles, y_top: float):
    width = PAGE_WIDTH - MARGIN * 2
    height = 92
    draw_panel(c, MARGIN, y_top, width, height, radius=12)
    draw_label(c, MARGIN + 14, y_top - 13, "Project Summary")
    body = (
        "Softbox is a runtime for AI-modified applications. Instead of letting an agent change code and "
        "deploy it directly, it routes each prompt through a controlled workflow: rewrite, build, preview, "
        "validate, then promote. The result is a practical system for AI-driven app changes with deployment "
        "safety built in. It matters because the engineering problem is not generating code alone, but turning "
        "generated code into a release process that is observable, testable, and safe to promote."
    )
    draw_paragraph(c, body, styles["BodySmall"], MARGIN + 14, y_top - 25, width - 28)


def draw_flow_diagram(c: canvas.Canvas, y_top: float):
    width = PAGE_WIDTH - MARGIN * 2
    height = 84
    draw_panel(c, MARGIN, y_top, width, height, radius=12)
    draw_label(c, MARGIN + 14, y_top - 13, "Runtime Flow")

    nodes = [
        "User\nPrompt",
        "Job\nTracking",
        "Worker",
        "Coding\nAgent",
        "Build",
        "Artifact\nStorage",
        "Preview",
        "Health\nCheck",
        "Live\nPromotion",
    ]
    available = width - 28
    gap = 6
    box_width = (available - gap * (len(nodes) - 1)) / len(nodes)
    box_height = 24
    start_x = MARGIN + 14
    y = y_top - 48

    for index, node in enumerate(nodes):
        x = start_x + index * (box_width + gap)
        c.setFillColor(PANEL_ALT if index % 2 == 0 else white)
        c.setStrokeColor(BORDER)
        c.roundRect(x, y, box_width, box_height, 5, fill=1, stroke=1)
        c.setFillColor(TEXT)
        c.setFont("Helvetica", 7.2)
        lines = node.split("\n")
        if len(lines) == 1:
            c.drawCentredString(x + box_width / 2, y + 8.2, lines[0])
        else:
            c.drawCentredString(x + box_width / 2, y + 12.3, lines[0])
            c.drawCentredString(x + box_width / 2, y + 4.1, lines[1])
        if index < len(nodes) - 1:
            arrow_x = x + box_width
            c.setStrokeColor(ARROW)
            c.setLineWidth(1)
            c.line(arrow_x + 1.5, y + box_height / 2, arrow_x + gap - 2.5, y + box_height / 2)
            c.line(arrow_x + gap - 5.5, y + box_height / 2 + 2.5, arrow_x + gap - 2.5, y + box_height / 2)
            c.line(arrow_x + gap - 5.5, y + box_height / 2 - 2.5, arrow_x + gap - 2.5, y + box_height / 2)


def draw_footer(c: canvas.Canvas):
    footer = "Case study sample focused on AI workflow orchestration, deployment safety, and backend systems design."
    c.setFillColor(SOFT)
    c.setFont("Helvetica", 7.8)
    c.drawString(MARGIN, 18, footer)


def generate_pdf(output_path: Path):
    styles = build_styles()
    c = canvas.Canvas(str(output_path), pagesize=A4)
    c.setTitle("Softbox — AI Runtime for Safe App Modification and Promotion")
    c.setAuthor("Softbox")
    c.setSubject("Upwork work sample")

    draw_header(c)
    draw_summary(c, styles, PAGE_HEIGHT - 116)
    draw_flow_diagram(c, PAGE_HEIGHT - 221)

    column_gap = 14
    col_width = (PAGE_WIDTH - MARGIN * 2 - column_gap) / 2
    left_x = MARGIN
    right_x = MARGIN + col_width + column_gap

    draw_section_box(
        c,
        styles,
        left_x,
        PAGE_HEIGHT - 320,
        col_width,
        72,
        "Problem",
        "AI can modify application code quickly, but direct handoff from model output to production is risky. "
        "The core problem is creating a workflow where generated changes can be evaluated without exposing the "
        "live app to unstable code paths.",
    )

    draw_bullet_box(
        c,
        styles,
        right_x,
        PAGE_HEIGHT - 320,
        col_width,
        112,
        "Technical Highlights",
        [
            "- AI-assisted code rewrite pipeline",
            "- Job orchestration and state tracking",
            "- Immutable build and version workflow",
            "- Preview environment before promotion",
            "- Deployment gating via health checks",
            "- Backend integration with Convex and Cloudflare R2",
        ],
    )

    draw_section_box(
        c,
        styles,
        left_x,
        PAGE_HEIGHT - 404,
        col_width,
        129,
        "Solution",
        "Softbox separates the system into a stable outer shell and a mutable inner app. A prompt creates a "
        "tracked job, a worker sends the selected app to a coding agent, the agent rewrites source, and the "
        "worker builds a new immutable artifact. That artifact is mounted in preview inside the shell, "
        "health-checked, and only then promoted live.",
    )

    draw_section_box(
        c,
        styles,
        right_x,
        PAGE_HEIGHT - 444,
        col_width,
        96,
        "Why This Is Relevant for Client Work",
        "This project demonstrates real AI application engineering rather than model demos alone. It maps directly "
        "to backend implementation, workflow automation, API and system integration, and production-minded release "
        "logic for AI-powered products.",
    )

    draw_section_box(
        c,
        styles,
        left_x,
        PAGE_HEIGHT - 546,
        col_width,
        118,
        "My Contribution",
        "I designed and built the runtime workflow end to end. I implemented the orchestration between prompt "
        "submission, job tracking, worker execution, agent-driven code changes, artifact creation, preview "
        "mounting, and promotion. I also handled backend and systems concerns including versioning, artifact flow, "
        "validation rules, and deployment safety.",
    )

    draw_stack_box(
        c,
        styles,
        right_x,
        PAGE_HEIGHT - 552,
        col_width,
        110,
        [
            "AI agent-based code modification",
            "Convex",
            "Cloudflare R2",
            "Backend/runtime orchestration",
        ],
    )

    draw_footer(c)
    c.showPage()
    c.save()


if __name__ == "__main__":
    output = Path(__file__).resolve().parents[1] / "docs" / "softbox-upwork-work-sample.pdf"
    output.parent.mkdir(parents=True, exist_ok=True)
    generate_pdf(output)
    print(f"Wrote {output}")
