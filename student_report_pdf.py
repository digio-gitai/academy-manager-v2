"""Generate per-student wrong-answer PDF reports.

Engines (parallel — FPDF default, WeasyPrint opt-in):
  - fpdf2 + NanumGothic: ``generate_wrong_answer_note_pdf`` …
  - WeasyPrint (HTML/CSS): ``generate_wrong_answer_note_pdf_weasyprint`` …

Filename pattern: ``{테스트명}{날짜}{학년}_{이름}.pdf``
"""

from __future__ import annotations

import io
import os
import re
from datetime import date
from pathlib import Path
from typing import Any

from ocr_extract import _normalize_wrong_analysis_rows
from pdf_math_render import (
    SIMILAR_SECTION_GAP_MM,
    clean_math_text,
    draw_pdf_math_block,
    draw_similar_multicell_block,
    estimate_multicell_height,
    estimate_plain_text_height,
    prepare_pdf_math_text,
)
from reports_visual import cumulative_score_chart_png, score_compare_chart_png
from similar_questions import prepare_similar_items_list

PDF_FONT_FAMILY = "NanumGothic"
ACCENT_COLOR = (30, 58, 138)
BODY_COLOR = (28, 28, 28)
MUTED_COLOR = (100, 116, 139)
BORDER_COLOR = (180, 190, 210)
COVER_BG = (248, 250, 252)


def _pdf_helpers():
    """Lazy import to avoid circular import with app.py."""
    import app as app_module

    return app_module._ensure_korean_font, app_module._safe_pdf_text


def infer_grade_label(class_name: str, class_description: str = "") -> str:
    """Derive a short grade label (학년) from class name or description."""
    for source in (class_name, class_description):
        if not source or source == "—":
            continue
        m = re.search(r"(중[1-3]|고[1-3]|[1-6]학년)", source)
        if m:
            return m.group(1)
        m = re.search(r"([중고]\d)", source.replace(" ", ""))
        if m:
            return m.group(1)
    cleaned = re.sub(r"[\\/:*?\"<>|\s]", "", class_name)
    return cleaned if cleaned and cleaned != "—" else "학년미상"


def sanitize_filename_part(text: str) -> str:
    """Remove characters invalid in file names and spaces."""
    cleaned = re.sub(r'[\\/:*?"<>|]', "", str(text or ""))
    return cleaned.replace(" ", "")


def build_student_report_pdf_filename(
    test_name: str,
    test_date: str,
    grade_label: str,
    student_name: str,
    *,
    suffix: str = "",
) -> str:
    """Build ``{테스트명}{날짜}{학년}_{이름}[suffix].pdf``."""
    base = (
        "".join(
            sanitize_filename_part(part)
            for part in (test_name, test_date, grade_label)
            if part
        )
        or "시험보고서"
    )
    name_part = sanitize_filename_part(student_name) or "학생"
    suffix_part = sanitize_filename_part(suffix) if suffix else ""
    if suffix_part:
        return f"{base}_{name_part}_{suffix_part}.pdf"
    return f"{base}_{name_part}.pdf"


def _make_pdf_document(title: str, *, skip_auto_page: bool = False):
    """Create fpdf2 document with ``NanumGothic`` registered for all text."""
    from fpdf import FPDF

    ensure_font, safe_text = _pdf_helpers()
    font_path = ensure_font()

    class _PDF(FPDF):
        def header(self):
            if self.page_no() == 1:
                return
            fam = PDF_FONT_FAMILY if font_path else "Helvetica"
            self.set_font(fam, size=8)
            self.set_text_color(*MUTED_COLOR)
            self.cell(0, 6, safe_text(f"Math Management — {title}"), align="C")
            self.ln(3)

        def footer(self):
            self.set_y(-12)
            fam = PDF_FONT_FAMILY if font_path else "Helvetica"
            self.set_font(fam, size=8)
            self.set_text_color(150, 150, 150)
            self.cell(0, 6, f"- {self.page_no()} -", align="C")

        def multi_cell(self, w, h=None, text="", *args, **kwargs):
            kwargs.setdefault("new_x", "LMARGIN")
            kwargs.setdefault("new_y", "NEXT")
            return super().multi_cell(w, h, safe_text(text), *args, **kwargs)

    pdf = _PDF()
    pdf.set_auto_page_break(auto=True, margin=18)
    if font_path:
        pdf.add_font(PDF_FONT_FAMILY, fname=font_path)
    if not skip_auto_page:
        pdf.add_page()

    def _font(
        size: int = 10, *, color: tuple[int, int, int] = BODY_COLOR, lh: float = 1.45
    ):
        pdf.set_font(PDF_FONT_FAMILY if font_path else "Helvetica", size=size)
        pdf.set_text_color(*color)

    def _section(section_title: str):
        _font(12, color=ACCENT_COLOR)
        pdf.set_fill_color(234, 240, 255)
        pdf.cell(0, 9, section_title, fill=True, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(2)
        _font(10)

    return pdf, font_path, safe_text, _font, _section


def _embed_png(pdf, png_bytes: bytes, *, w: float = 180) -> None:
    """Insert a high-resolution chart image centered on the page."""
    if not png_bytes:
        return
    x = (pdf.w - w) / 2
    pdf.image(io.BytesIO(png_bytes), x=x, w=w)
    pdf.ln(4)


def _render_parent_cover_page(
    pdf,
    *,
    _font,
    student_name: str,
    test_name: str,
    test_date: str,
    grade_label: str,
    class_name: str,
) -> None:
    """Formal cover — logo placeholder + emphasized title."""
    page_w = pdf.w - pdf.l_margin - pdf.r_margin
    pdf.set_fill_color(*COVER_BG)
    pdf.rect(
        pdf.l_margin,
        pdf.t_margin,
        page_w,
        pdf.h - pdf.t_margin - pdf.b_margin,
        style="F",
    )

    logo_w, logo_h = 42, 28
    logo_x = pdf.l_margin + (page_w - logo_w) / 2
    logo_y = 32
    pdf.set_draw_color(*BORDER_COLOR)
    pdf.set_fill_color(255, 255, 255)
    pdf.rect(logo_x, logo_y, logo_w, logo_h, style="DF")
    _font(9, color=MUTED_COLOR)
    pdf.set_xy(logo_x, logo_y + logo_h / 2 - 4)
    pdf.cell(logo_w, 8, "[ 학원 로고 ]", align="C")

    pdf.ln(logo_h + 18)
    _font(22, color=ACCENT_COLOR)
    pdf.multi_cell(0, 12, "학생 성적 분석 보고서", align="C")
    pdf.ln(6)
    _font(13, color=BODY_COLOR)
    pdf.multi_cell(0, 9, student_name, align="C")
    pdf.ln(4)
    _font(10, color=MUTED_COLOR)
    pdf.multi_cell(
        0,
        8,
        f"{test_name}  ·  {test_date}  ·  {grade_label or class_name or '—'}",
        align="C",
    )
    pdf.ln(10)
    _font(9, color=MUTED_COLOR)
    pdf.multi_cell(
        0,
        7,
        f"발행: Math Management  ·  {date.today().isoformat()}",
        align="C",
    )
    pdf.add_page()


def _write_pdf_meta_block(
    pdf,
    *,
    _font,
    doc_title: str,
    student_name: str,
    test_name: str,
    test_date: str,
    grade_label: str,
    class_name: str,
    score: float,
    wrong_count: int,
    total_questions: int,
) -> None:
    _font(17)
    pdf.cell(0, 11, doc_title, align="C", new_x="LMARGIN", new_y="NEXT")
    _font(10)
    meta_lines = [
        f"학생명: {student_name}",
        f"시험명: {test_name or '—'}",
        f"시험일: {test_date or '—'}",
        f"학년/반: {grade_label or class_name or '—'}",
        f"점수: {float(score):.1f}점 ({total_questions - wrong_count}/{total_questions})",
        f"오답: {wrong_count}문항",
        f"작성일: {date.today().isoformat()}",
    ]
    pdf.multi_cell(0, 7, "    ".join(meta_lines), align="C", wrapmode="CHAR")
    pdf.ln(5)


def _topic_map_from_questions(
    questions: list[dict[str, Any]],
) -> dict[int, dict[str, str]]:
    out: dict[int, dict[str, str]] = {}
    for q in questions:
        n = int(q.get("question_number") or 0)
        if n > 0:
            out[n] = {
                "topic": str(q.get("topic") or "미분류"),
                "difficulty": str(q.get("difficulty") or "Mid"),
            }
    return out


def _load_db_report_context(student_id: int, test_id: int) -> dict[str, Any]:
    """Load student_results + test metadata + optional AI analysis from DB."""
    from database import (
        get_grade_report_for_exam,
        get_student_profile,
        get_student_result_record,
        get_test_questions,
    )

    profile = get_student_profile(student_id)
    if not profile:
        raise ValueError(f"학생 ID {student_id}를 찾을 수 없습니다.")

    record = get_student_result_record(student_id=student_id, test_id=test_id)
    if not record:
        raise ValueError(
            f"{profile['student_name']} 학생의 시험 결과(student_results)가 없습니다. "
            "먼저 ** 오답 DB 저장**을 완료해 주세요."
        )

    questions = get_test_questions(test_id)
    analysis = get_grade_report_for_exam(
        student_id,
        record["test_name"],
        record["date"],
    )
    grade = infer_grade_label(
        profile.get("class_name", ""),
        profile.get("class_description", ""),
    )
    return {
        "profile": profile,
        "record": record,
        "questions": questions,
        "topic_by_number": _topic_map_from_questions(questions),
        "analysis": analysis or {},
        "grade_label": grade,
    }


def _render_teacher_message_section(
    pdf,
    *,
    _font,
    _section,
    teacher_message: str,
    section_number: int,
) -> None:
    """Render 강사 '드리고 싶은 말'block with styled inset."""
    msg = (teacher_message or "").strip()
    if not msg:
        return

    _section(f"{section_number}. 선생님이 드리고 싶은 말")
    page_w = pdf.w - pdf.l_margin - pdf.r_margin
    y0 = pdf.get_y()
    approx_lines = max(1, msg.count("\n") + 1 + len(msg) // 42)
    box_h = approx_lines * 8 + 6

    pdf.set_fill_color(248, 250, 255)
    pdf.rect(pdf.l_margin + 2.5, y0, page_w - 2.5, box_h, style="F")
    pdf.set_fill_color(*ACCENT_COLOR)
    pdf.rect(pdf.l_margin, y0, 2.5, box_h, style="F")

    _font(10, color=BODY_COLOR)
    pdf.set_xy(pdf.l_margin + 8, y0 + 4)
    pdf.multi_cell(page_w - 16, 8, msg, wrapmode="CHAR")
    pdf.set_y(max(pdf.get_y(), y0 + box_h) + 4)


def generate_parent_report_pdf(
    *,
    student_name: str,
    test_name: str,
    test_date: str,
    wrong_numbers: list[int],
    score: float,
    total_questions: int,
    grade_label: str = "",
    class_name: str = "",
    analysis_report: dict[str, Any] | None = None,
    include_average: bool = True,
    include_cumulative_chart: bool = True,
    test_average: float | None = None,
    score_history: list[dict[str, Any]] | None = None,
    teacher_message: str = "",
) -> tuple[bytes, str]:
    """학부모용 연구 보고서 스타일 PDF."""
    grade_label = grade_label or infer_grade_label(class_name)
    filename = build_student_report_pdf_filename(
        test_name, test_date, grade_label, student_name, suffix="학부모리포트"
    )
    report = analysis_report or {}
    overview = report.get("section_1_overview") or {}
    prescription = (
        report.get("section_3_prescription")
        or report.get("learning_prescription")
        or {}
    )
    sc = dict(report.get("score_comparison") or {})
    if test_average is not None:
        sc["test_average"] = test_average
        sc["class_average"] = test_average

    pdf, _fp, _st, _font, _section = _make_pdf_document(
        "학부모용 성적 리포트",
        skip_auto_page=True,
    )
    pdf.add_page()
    _render_parent_cover_page(
        pdf,
        _font=_font,
        student_name=student_name,
        test_name=test_name,
        test_date=test_date,
        grade_label=grade_label,
        class_name=class_name,
    )

    wrong_count = len(sorted({int(n) for n in wrong_numbers if int(n) > 0}))
    _section("요약 정보")
    _font(10)
    meta_lines = [
        f"학생명: {student_name}",
        f"시험: {test_name} ({test_date})",
        f"점수: {float(score):.1f}점 ({total_questions - wrong_count}/{total_questions})",
        f"오답: {wrong_count}문항",
    ]
    for line in meta_lines:
        pdf.multi_cell(0, 8, line, wrapmode="CHAR")
    pdf.ln(4)

    avg_for_chart = test_average if include_average else None
    if include_average and avg_for_chart is not None:
        _section("1. 성적 요약 · 전체 평균 비교")
        gap = float(score) - float(avg_for_chart)
        pdf.multi_cell(
            0,
            8,
            f"학생 {float(score):.1f}점  ·  "
            f"응시 전체 평균 {float(avg_for_chart):.1f}점  ({gap:+.1f}점)",
            wrapmode="CHAR",
        )
        pdf.ln(2)
        _embed_png(
            pdf,
            score_compare_chart_png(float(score), avg_for_chart, student_name),
            w=120,
        )
    elif include_average:
        _section("1. 성적 요약")
        pdf.multi_cell(
            0, 8, f"학생 {float(score):.1f}점 (응시 평균 데이터 없음)", wrapmode="CHAR"
        )
        pdf.ln(3)
    else:
        _section("1. 성적 요약")
        pdf.multi_cell(0, 8, f"학생 {float(score):.1f}점", wrapmode="CHAR")
        pdf.ln(3)

    if include_cumulative_chart:
        _section("2. 누적 성취도 추이")
        history = score_history or []
        _embed_png(
            pdf,
            cumulative_score_chart_png(
                history,
                student_name,
                test_average=avg_for_chart,
            ),
            w=175,
        )

    summary = overview.get("summary") or report.get("summary") or ""
    sec_num = 3 if include_cumulative_chart else 2
    _section(f"{sec_num}. 종합 총평")
    headline = overview.get("headline") or "종합 총평"
    _font(11, color=ACCENT_COLOR)
    pdf.multi_cell(0, 8, headline, wrapmode="CHAR")
    pdf.ln(1)
    _font(10)
    if summary:
        pdf.multi_cell(0, 7.5, summary, wrapmode="CHAR")
    else:
        pdf.multi_cell(
            0,
            7.5,
            "AI 종합 분석 데이터가 없습니다. 오답 현황을 바탕으로 상담해 주세요.",
            wrapmode="CHAR",
        )
    for label, key in (("강점", "strengths"), ("취약점", "weaknesses")):
        items = overview.get(key) or []
        if items:
            pdf.ln(2)
            pdf.multi_cell(0, 7, f"{label}:", wrapmode="CHAR")
            for item in items:
                pdf.multi_cell(0, 6.5, f"  • {item}", wrapmode="CHAR")
    pdf.ln(3)

    intro = prescription.get("intro") or ""
    rules = prescription.get("parent_action_rules") or []
    weekly = prescription.get("weekly_focus") or ""
    _section(f"{sec_num + 1}. 학습 처방 · 학부모 가이드")
    if intro:
        pdf.multi_cell(0, 7.5, intro, wrapmode="CHAR")
        pdf.ln(2)
    if rules:
        pdf.multi_cell(0, 7, "학부모 행동 가이드:", wrapmode="CHAR")
        for rule in rules[:6]:
            pdf.multi_cell(0, 6.5, f"  • {rule}", wrapmode="CHAR")
        pdf.ln(2)
    if weekly:
        pdf.multi_cell(0, 7, f"이번 주 집중: {weekly}", wrapmode="CHAR")
    if not intro and not rules and not weekly:
        pdf.multi_cell(
            0,
            7.5,
            "맞춤 처방 데이터가 없습니다. 틀린 문항과 단원별 오답을 참고해 학습 계획을 세워 주세요.",
            wrapmode="CHAR",
        )

    if (teacher_message or "").strip():
        _render_teacher_message_section(
            pdf,
            _font=_font,
            _section=_section,
            teacher_message=teacher_message,
            section_number=sec_num + 2,
        )

    return bytes(pdf.output()), filename


def _draw_wrong_note_card(
    pdf,
    *,
    _font,
    safe_text,
    body_font_family: str,
    x: float,
    y: float,
    w: float,
    question_number: int,
    topic: str,
    difficulty: str,
    detail_lines: list[str],
) -> float:
    """Draw one bordered card with dynamic height; return bottom y."""
    pad = 3
    line_h = 6.5
    content_w = w - pad * 2
    header_h = line_h * 2 + 1
    body_h = _estimate_card_content_height(detail_lines, content_w, line_h=line_h)
    card_h = pad * 2 + header_h + body_h

    pdf.set_draw_color(*BORDER_COLOR)
    pdf.set_fill_color(255, 255, 255)
    pdf.rect(x, y, w, card_h, style="DF")

    pdf.set_xy(x + pad, y + pad)
    _font(12, color=ACCENT_COLOR)
    pdf.cell(w * 0.22, line_h, f"{question_number}번", align="L")
    _font(10, color=BODY_COLOR)
    pdf.cell(w * 0.78 - pad * 2, line_h, f"{topic}  ·  {difficulty}", align="L")

    y_cur = y + pad + header_h
    for line in detail_lines:
        y_cur = draw_pdf_math_block(
            pdf,
            x=x + pad,
            y=y_cur,
            w=content_w,
            text=line,
            line_h=line_h,
            _font=_font,
            safe_text=safe_text,
            body_color=BODY_COLOR,
            font_size=9,
            body_font_family=body_font_family,
        )
        y_cur += 2

    return y + card_h + 4


def _similar_question_blocks(item: dict[str, Any]) -> list[tuple[str, str]]:
    """Stem / answer / explanation blocks (already cleaned for PDF)."""
    blocks: list[tuple[str, str]] = []
    stem = (item.get("stem") or "").strip()
    if stem:
        blocks.append(("stem", stem))
    answer = (item.get("answer") or "").strip()
    if answer:
        blocks.append(("answer", f"정답: {answer}"))
    explanation = (item.get("explanation") or "").strip()
    if explanation:
        blocks.append(("explanation", f"해설: {explanation}"))
    return blocks or [("empty", "(내용 없음)")]


def _estimate_similar_blocks_height(
    blocks: list[tuple[str, str]],
    content_w: float,
    *,
    line_h: float = 6.0,
    section_gap: float = SIMILAR_SECTION_GAP_MM,
) -> float:
    if not blocks:
        return 0.0
    total = 0.0
    for i, (_, text) in enumerate(blocks):
        total += estimate_multicell_height(text, content_w, line_h=line_h)
        if i < len(blocks) - 1:
            total += section_gap
    return total


def _estimate_similar_card_height(w: float, item: dict[str, Any]) -> float:
    pad = 3
    line_h = 6.0
    content_w = w - pad * 2
    blocks = _similar_question_blocks(item)
    header_h = line_h * 2 + 2
    body_h = _estimate_similar_blocks_height(blocks, content_w, line_h=line_h)
    return pad * 2 + header_h + body_h + 4


def _draw_similar_question_card(
    pdf,
    *,
    _font,
    body_font_family: str,
    x: float,
    y: float,
    w: float,
    item: dict[str, Any],
) -> float:
    """Draw one similar-question card; auto-height via multi_cell blocks."""
    pad = 3
    line_h = 6.0
    section_gap = SIMILAR_SECTION_GAP_MM
    content_w = w - pad * 2
    blocks = _similar_question_blocks(item)
    header_h = line_h * 2 + 2
    body_h = _estimate_similar_blocks_height(
        blocks, content_w, line_h=line_h, section_gap=section_gap
    )
    card_h = pad * 2 + header_h + body_h

    pdf.set_draw_color(*ACCENT_COLOR)
    pdf.set_fill_color(248, 250, 255)
    pdf.rect(x, y, w, card_h, style="DF")

    wrong_n = int(item.get("related_wrong_number") or 0)
    idx = int(item.get("index") or 1)
    topic = item.get("topic", "미분류")
    diff = item.get("difficulty", "Mid")

    pdf.set_xy(x + pad, y + pad)
    _font(11, color=ACCENT_COLOR)
    pdf.cell(w * 0.55, line_h, f"{wrong_n}번 유사문제 {idx}", align="L")
    _font(9, color=MUTED_COLOR)
    pdf.cell(w * 0.45 - pad * 2, line_h, f"{topic} · {diff}", align="R")

    y_cur = y + pad + header_h
    for i, (_kind, text) in enumerate(blocks):
        y_cur = draw_similar_multicell_block(
            pdf,
            x=x + pad,
            y=y_cur,
            w=content_w,
            text=text,
            line_h=line_h,
            _font=_font,
            body_color=BODY_COLOR,
            font_size=9,
            body_font_family=body_font_family,
        )
        if i < len(blocks) - 1:
            y_cur += section_gap
            pdf.set_xy(x + pad, y_cur)

    return y + card_h + 4


def _estimate_card_content_height(
    detail_lines: list[str],
    content_w: float,
    *,
    line_h: float = 6.5,
) -> float:
    body_h = sum(
        estimate_plain_text_height(
            prepare_pdf_math_text(line),
            content_w,
            line_h=line_h,
        )
        for line in detail_lines
    )
    return body_h + max(0, len(detail_lines) - 1) * 2


def _estimate_wrong_note_card_height(w: float, detail_lines: list[str]) -> float:
    pad = 3
    line_h = 6.5
    content_w = w - pad * 2
    header_h = line_h * 2 + 1
    card_h = (
        pad * 2
        + header_h
        + _estimate_card_content_height(detail_lines, content_w, line_h=line_h)
    )
    return card_h + 4


def add_similar_questions_to_pdf(
    pdf,
    *,
    _font,
    _section,
    safe_text,
    body_font_family: str,
    similar_questions: list[dict[str, Any]],
    start_y: float | None = None,
) -> None:
    """Append similar-question section (2-column cards) below wrong-answer cards."""
    items = [it for it in (similar_questions or []) if (it.get("stem") or "").strip()]
    print(
        f"[wrong-note-pdf] add_similar_questions_to_pdf: "
        f"input={len(similar_questions or [])} render={len(items)} cards",
        flush=True,
    )
    if not items:
        return

    if start_y is not None:
        if start_y + 16 > pdf.h - pdf.b_margin:
            pdf.add_page()
            start_y = pdf.t_margin
        pdf.set_y(start_y)
    else:
        pdf.ln(6)

    _section("유사문제 (문제은행)")

    page_w = pdf.w - pdf.l_margin - pdf.r_margin
    gutter = 6
    col_w = (page_w - gutter) / 2
    y_left = pdf.get_y()
    y_right = y_left

    for i, item in enumerate(items):
        if i % 2 == 0:
            x = pdf.l_margin
            y_start = y_left
        else:
            x = pdf.l_margin + col_w + gutter
            y_start = y_right

        if y_start + _estimate_similar_card_height(col_w, item) > pdf.h - pdf.b_margin:
            pdf.add_page()
            y_left = y_right = pdf.t_margin
            y_start = y_left if i % 2 == 0 else y_right

        bottom = _draw_similar_question_card(
            pdf,
            _font=_font,
            body_font_family=body_font_family,
            x=x,
            y=y_start,
            w=col_w,
            item=item,
        )
        if i % 2 == 0:
            y_left = bottom
        else:
            y_right = bottom
            y_left = y_right = max(y_left, y_right)

    pdf.set_y(max(y_left, y_right))


def generate_wrong_answer_note_pdf(
    *,
    student_name: str,
    test_name: str,
    test_date: str,
    wrong_numbers: list[int],
    score: float,
    total_questions: int,
    grade_label: str = "",
    class_name: str = "",
    topic_by_number: dict[int, dict[str, str]] | None = None,
    analysis_report: dict[str, Any] | None = None,
    similar_questions: list[dict[str, Any]] | None = None,  # 이 줄이 있는지 확인하세요
    **kwargs,  # <--- 이것을 추가하세요 (나머지 인자를 모두 받아줍니다)
) -> tuple[bytes, str]:
    """오답노트 PDF — 2단 카드 레이아웃, 강조 번호 + 본문 + 유사문제."""
    similar_questions = prepare_similar_items_list(similar_questions)
    print(
        f"[wrong-note-pdf] generate_wrong_answer_note_pdf: "
        f"similar_questions={len(similar_questions)} items (after clean)",
        flush=True,
    )
    grade_label = grade_label or infer_grade_label(class_name)
    filename = build_student_report_pdf_filename(
        test_name, test_date, grade_label, student_name, suffix="오답노트"
    )
    report = analysis_report or {}
    wrong_rows = _normalize_wrong_analysis_rows(report)
    topic_by_number = topic_by_number or {}
    row_by_num: dict[int, dict] = {}
    for row in wrong_rows:
        for n in row.get("wrong_numbers") or []:
            row_by_num[int(n)] = row

    pdf, font_path, _st, _font, _section = _make_pdf_document("오답노트")
    body_font = PDF_FONT_FAMILY if font_path else "Helvetica"
    nums = sorted({int(n) for n in wrong_numbers if int(n) > 0})

    _font(16, color=ACCENT_COLOR)
    pdf.cell(0, 10, "오답노트", align="C", new_x="LMARGIN", new_y="NEXT")
    _font(10, color=MUTED_COLOR)
    pdf.multi_cell(
        0,
        7,
        f"{student_name}  ·  {test_name}  ·  {test_date}  ·  {float(score):.1f}점",
        align="C",
        wrapmode="CHAR",
    )
    pdf.ln(6)

    if not nums:
        _font(10)
        pdf.multi_cell(0, 7, "기록된 오답 문항이 없습니다.", wrapmode="CHAR")
        if similar_questions:
            add_similar_questions_to_pdf(
                pdf,
                _font=_font,
                _section=_section,
                safe_text=_st,
                body_font_family=body_font,
                similar_questions=similar_questions,
            )
        return bytes(pdf.output()), filename

    page_w = pdf.w - pdf.l_margin - pdf.r_margin
    gutter = 6
    col_w = (page_w - gutter) / 2
    y_left = pdf.get_y()
    y_right = y_left

    for i, n in enumerate(nums):
        meta = topic_by_number.get(n, {})
        topic = meta.get("topic", "미분류")
        diff = meta.get("difficulty", "Mid")
        row = row_by_num.get(n)
        if row:
            detail = [
                f"틀린 이유: {row.get('wrong_reason', '—')}",
                f"보완: {row.get('concept_to_review', '—')}",
            ]
        else:
            detail = ["오답 — 유사문제로 복습하세요."]

        if i % 2 == 0:
            x = pdf.l_margin
            y_start = y_left
        else:
            x = pdf.l_margin + col_w + gutter
            y_start = y_right

        if (
            y_start + _estimate_wrong_note_card_height(col_w, detail)
            > pdf.h - pdf.b_margin
        ):
            pdf.add_page()
            y_left = y_right = pdf.t_margin
            y_start = y_left if i % 2 == 0 else y_right

        bottom = _draw_wrong_note_card(
            pdf,
            _font=_font,
            safe_text=_st,
            body_font_family=body_font,
            x=x,
            y=y_start,
            w=col_w,
            question_number=n,
            topic=topic,
            difficulty=diff,
            detail_lines=detail,
        )
        if i % 2 == 0:
            y_left = bottom
        else:
            y_right = bottom
            row_bottom = max(y_left, y_right)
            y_left = y_right = row_bottom

    if similar_questions:
        content_bottom = max(y_left, y_right)
        add_similar_questions_to_pdf(
            pdf,
            _font=_font,
            _section=_section,
            safe_text=_st,
            body_font_family=body_font,
            similar_questions=similar_questions,
            start_y=content_bottom + 6,
        )

    return bytes(pdf.output()), filename


def generate_parent_report_pdf_from_db(
    student_id: int,
    test_id: int,
    *,
    include_average: bool = True,
    include_cumulative_chart: bool = True,
    teacher_message: str = "",
) -> tuple[bytes, str]:
    """DB ``student_results`` 기준 학부모용 리포트 PDF."""
    from database import get_student_test_score_history, get_test_average_score

    ctx = _load_db_report_context(student_id, test_id)
    record = ctx["record"]
    profile = ctx["profile"]
    test_avg = get_test_average_score(int(test_id)) if include_average else None
    history = (
        get_student_test_score_history(student_id) if include_cumulative_chart else []
    )
    return generate_parent_report_pdf(
        student_name=profile["student_name"],
        test_name=record["test_name"],
        test_date=record["date"],
        wrong_numbers=record["wrong_numbers"],
        score=float(record["score"]),
        total_questions=int(record["total_questions"]),
        grade_label=ctx["grade_label"],
        class_name=profile.get("class_name", ""),
        analysis_report=ctx["analysis"],
        include_average=include_average,
        include_cumulative_chart=include_cumulative_chart,
        test_average=test_avg,
        score_history=history,
        teacher_message=teacher_message,
    )


def generate_wrong_answer_note_pdf_from_db_fpdf(
    student_id: int,
    test_id: int,
    *,
    similar_questions: list[dict[str, Any]] | None = None,
) -> tuple[bytes, str]:
    """DB 기준 오답노트 PDF (FPDF 레거시)."""
    similar_questions = similar_questions or []
    print(
        f"[wrong-note-pdf] generate_wrong_answer_note_pdf_from_db: "
        f"student_id={student_id}, test_id={test_id}, "
        f"similar_questions={len(similar_questions)}",
        flush=True,
    )
    ctx = _load_db_report_context(student_id, test_id)
    record = ctx["record"]
    profile = ctx["profile"]
    return generate_wrong_answer_note_pdf(
        student_name=profile["student_name"],
        test_name=record["test_name"],
        test_date=record["date"],
        wrong_numbers=record["wrong_numbers"],
        score=float(record["score"]),
        total_questions=int(record["total_questions"]),
        grade_label=ctx["grade_label"],
        class_name=profile.get("class_name", ""),
        topic_by_number=ctx["topic_by_number"],
        analysis_report=ctx["analysis"],
        similar_questions=similar_questions,
    )


# ---------------------------------------------------------------------------
# WeasyPrint engine (오답노트 — Jinja2 + MathJax template + SVG math)
# ---------------------------------------------------------------------------

PDF_ENGINE_FPDF = "fpdf"
PDF_ENGINE_WEASYPRINT = "weasyprint"

_TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"
_WRONG_NOTE_TEMPLATE = "wrong_note.html"


def weasyprint_available() -> bool:
    """Return True if WeasyPrint can be imported."""
    try:
        import weasyprint  # noqa: F401

        return True
    except Exception:
        return False


def _weasyprint_install_help() -> str:
    return (
        "WeasyPrint 오류 해결:\n"
        "  1) pip install weasyprint jinja2\n"
        "  2) Windows: GTK3 런타임 필요\n"
        "     https://github.com/tschoonj/GTK-for-Windows-Runtime-Environment-Installer\n"
        "     또는: winget install GTK3Runtime\n"
        "  3) Linux: sudo apt install libpango-1.0-0 libpangoft2-1.0-0 libgdk-pixbuf2.0-0\n"
        "  4) macOS: brew install pango gdk-pixbuf libffi\n"
        '  5) 설치 후 터미널에서 python -c "from weasyprint import HTML"로 확인'
    )


def _weasy_font_face_css() -> str:
    ensure_font, _ = _pdf_helpers()
    font_path = ensure_font()
    if font_path and Path(font_path).is_file():
        uri = Path(font_path).resolve().as_uri()
        return (
            "@font-face {\n"
            f"  font-family: 'NanumGothic';\n"
            f"  src: url('{uri}') format('truetype');\n"
            "}\n"
        )
    return ""


def _get_jinja_env():
    from jinja2 import Environment, FileSystemLoader, select_autoescape

    return Environment(
        loader=FileSystemLoader(str(_TEMPLATES_DIR)),
        autoescape=select_autoescape(["html", "xml"]),
    )


def _similar_items_html_context(
    similar_questions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    from pdf_weasy_math import text_with_latex_to_html

    out: list[dict[str, Any]] = []
    for it in similar_questions or []:
        if not str(it.get("stem") or "").strip():
            continue
        out.append(
            {
                "related_wrong_number": int(it.get("related_wrong_number") or 0),
                "index": int(it.get("index") or 1),
                "topic": str(it.get("topic") or "미분류"),
                "difficulty": str(it.get("difficulty") or "Mid"),
                "stem_html": text_with_latex_to_html(str(it.get("stem") or "")),
                "answer_html": (
                    text_with_latex_to_html(str(it.get("answer") or ""))
                    if str(it.get("answer") or "").strip()
                    else ""
                ),
                "explanation_html": (
                    text_with_latex_to_html(str(it.get("explanation") or ""))
                    if str(it.get("explanation") or "").strip()
                    else ""
                ),
            }
        )
    return out


def _render_wrong_note_html(
    *,
    title: str,
    subtitle: str,
    wrong_cards: list[dict[str, Any]],
    similar_questions: list[dict[str, Any]],
    empty_wrong_message: str = "",
) -> str:
    env = _get_jinja_env()
    template = env.get_template(_WRONG_NOTE_TEMPLATE)
    return template.render(
        title=title,
        subtitle=subtitle,
        wrong_cards=wrong_cards,
        similar_questions=_similar_items_html_context(similar_questions),
        empty_wrong_message=empty_wrong_message,
        font_face_css=_weasy_font_face_css(),
        accent_color=f"{ACCENT_COLOR[0]}, {ACCENT_COLOR[1]}, {ACCENT_COLOR[2]}",
        body_color=f"{BODY_COLOR[0]}, {BODY_COLOR[1]}, {BODY_COLOR[2]}",
        muted_color=f"{MUTED_COLOR[0]}, {MUTED_COLOR[1]}, {MUTED_COLOR[2]}",
        border_color=f"{BORDER_COLOR[0]}, {BORDER_COLOR[1]}, {BORDER_COLOR[2]}",
        section_gap_mm=SIMILAR_SECTION_GAP_MM,
    )


def _weasyprint_render_html(html: str) -> bytes:
    if not weasyprint_available():
        help_msg = _weasyprint_install_help()
        print(help_msg, flush=True)
        raise RuntimeError("WeasyPrint가 설치되지 않았습니다.\n"+ help_msg)
    try:
        from weasyprint import HTML

        base_url = Path(__file__).resolve().parent.as_uri()
        return HTML(string=html, base_url=base_url).write_pdf()
    except OSError as exc:
        help_msg = _weasyprint_install_help()
        print(f"[weasyprint] OSError: {exc}\n{help_msg}", flush=True)
        raise RuntimeError(f"WeasyPrint 시스템 의존성 오류: {exc}\n{help_msg}") from exc
    except Exception as exc:
        help_msg = _weasyprint_install_help()
        print(f"[weasyprint] {type(exc).__name__}: {exc}\n{help_msg}", flush=True)
        raise RuntimeError(f"WeasyPrint PDF 변환 실패: {exc}\n{help_msg}") from exc


def generate_wrong_answer_note_pdf_weasyprint(
    *,
    student_name: str,
    test_name: str,
    test_date: str,
    wrong_numbers: list[int],
    score: float,
    total_questions: int,
    grade_label: str = "",
    class_name: str = "",
    topic_by_number: dict[int, dict[str, str]] | None = None,
    analysis_report: dict[str, Any] | None = None,
    similar_questions: list[dict[str, Any]] | None = None,
) -> tuple[bytes, str]:
    """오답노트 PDF (WeasyPrint + Jinja2 + LaTeX SVG)."""
    from pdf_weasy_math import text_with_latex_to_html

    similar_questions = similar_questions or []
    grade_label = grade_label or infer_grade_label(class_name)
    filename = build_student_report_pdf_filename(
        test_name, test_date, grade_label, student_name, suffix="오답노트"
    )
    report = analysis_report or {}
    wrong_rows = _normalize_wrong_analysis_rows(report)
    topic_by_number = topic_by_number or {}
    row_by_num: dict[int, dict] = {}
    for row in wrong_rows:
        for n in row.get("wrong_numbers") or []:
            row_by_num[int(n)] = row

    nums = sorted({int(n) for n in wrong_numbers if int(n) > 0})
    subtitle = (
        f"{student_name}  ·  {test_name}  ·  {test_date}  ·  {float(score):.1f}점"
    )

    wrong_cards: list[dict[str, Any]] = []
    empty_msg = ""
    if not nums:
        empty_msg = "기록된 오답 문항이 없습니다."
    else:
        for n in nums:
            meta = topic_by_number.get(n, {})
            row = row_by_num.get(n)
            if row:
                detail = [
                    f"틀린 이유: {row.get('wrong_reason', '—')}",
                    f"보완: {row.get('concept_to_review', '—')}",
                ]
            else:
                detail = ["오답 — 유사문제로 복습하세요."]
            wrong_cards.append(
                {
                    "number": n,
                    "topic": meta.get("topic", "미분류"),
                    "difficulty": meta.get("difficulty", "Mid"),
                    "detail_lines_html": [
                        text_with_latex_to_html(line) for line in detail
                    ],
                }
            )

    html = _render_wrong_note_html(
        title="오답노트",
        subtitle=subtitle,
        wrong_cards=wrong_cards,
        similar_questions=similar_questions,
        empty_wrong_message=empty_msg,
    )
    print(
        f"[wrong-note-pdf/weasy] similar_questions={len(similar_questions)}",
        flush=True,
    )
    return _weasyprint_render_html(html), filename


def generate_wrong_answer_note_pdf_from_db_weasyprint(
    student_id: int,
    test_id: int,
    similar_questions: list | None = None,
) -> tuple[bytes, str]:
    """DB 기준 오답노트 PDF (WeasyPrint). 앱 기본 진입점."""
    similar_questions = similar_questions or []
    print(
        f"[wrong-note-pdf/weasy] from_db: student_id={student_id}, test_id={test_id}, "
        f"similar={len(similar_questions)}",
        flush=True,
    )
    ctx = _load_db_report_context(student_id, test_id)
    record = ctx["record"]
    profile = ctx["profile"]
    return generate_wrong_answer_note_pdf_weasyprint(
        student_name=profile["student_name"],
        test_name=record["test_name"],
        test_date=record["date"],
        wrong_numbers=record["wrong_numbers"],
        score=float(record["score"]),
        total_questions=int(record["total_questions"]),
        grade_label=ctx["grade_label"],
        class_name=profile.get("class_name", ""),
        topic_by_number=ctx["topic_by_number"],
        analysis_report=ctx["analysis"],
        similar_questions=similar_questions,
    )


def generate_wrong_answer_note_pdf_from_db(
    student_id: int,
    test_id: int,
    *,
    similar_questions: list[dict[str, Any]] | None = None,
) -> tuple[bytes, str]:
    """DB 기준 오답노트 PDF — WeasyPrint 기본 (FPDF는 ``…_fpdf`` 별칭)."""
    return generate_wrong_answer_note_pdf_from_db_weasyprint(
        student_id,
        test_id,
        similar_questions=similar_questions,
    )


def generate_student_wrong_answer_report_pdf(
    *,
    student_name: str,
    test_name: str,
    test_date: str,
    wrong_numbers: list[int],
    score: float,
    grade_label: str = "",
    class_name: str = "",
    analysis_report: dict[str, Any] | None = None,
) -> tuple[bytes, str]:
    """Build a PDF with wrong-question list and analysis. Returns ``(bytes, filename)``."""
    from fpdf import FPDF

    ensure_font, safe_text = _pdf_helpers()
    font_path = ensure_font()
    grade_label = grade_label or infer_grade_label(class_name)
    filename = build_student_report_pdf_filename(
        test_name, test_date, grade_label, student_name
    )

    report = analysis_report or {}
    wrong_rows = _normalize_wrong_analysis_rows(report)
    overview = report.get("section_1_overview") or {}
    prescription = (
        report.get("section_3_prescription")
        or report.get("learning_prescription")
        or {}
    )

    class _PDF(FPDF):
        def header(self):
            fam = PDF_FONT_FAMILY if font_path else "Helvetica"
            self.set_font(fam, size=8)
            self.set_text_color(140, 140, 140)
            self.cell(
                0, 6, safe_text("Math Management — 학생 오답 분석 보고서"), align="C"
            )
            self.ln(3)

        def footer(self):
            self.set_y(-12)
            fam = PDF_FONT_FAMILY if font_path else "Helvetica"
            self.set_font(fam, size=8)
            self.set_text_color(150, 150, 150)
            self.cell(0, 6, f"- {self.page_no()} -", align="C")

        def multi_cell(self, w, h=None, text="", *args, **kwargs):
            kwargs.setdefault("new_x", "LMARGIN")
            kwargs.setdefault("new_y", "NEXT")
            return super().multi_cell(w, h, safe_text(text), *args, **kwargs)

    pdf = _PDF()
    pdf.set_auto_page_break(auto=True, margin=16)
    if font_path:
        pdf.add_font(PDF_FONT_FAMILY, fname=font_path)
    pdf.add_page()

    def _font(size: int = 10):
        pdf.set_font(PDF_FONT_FAMILY if font_path else "Helvetica", size=size)
        pdf.set_text_color(30, 30, 30)

    def _section(title: str):
        _font(12)
        pdf.set_fill_color(234, 240, 255)
        pdf.cell(0, 8, title, fill=True, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1)
        _font(10)

    _font(17)
    pdf.cell(0, 11, "학생 오답 분석 보고서", align="C", new_x="LMARGIN", new_y="NEXT")
    _font(10)
    meta_lines = [
        f"학생명: {student_name}",
        f"시험명: {test_name or '—'}",
        f"시험일: {test_date or '—'}",
        f"학년/반: {grade_label or class_name or '—'}",
        f"점수: {float(score):.1f}점",
        f"보고서 작성일: {date.today().isoformat()}",
    ]
    pdf.multi_cell(0, 7, "    ".join(meta_lines), align="C", wrapmode="CHAR")
    pdf.ln(5)

    nums = sorted({int(n) for n in wrong_numbers if int(n) > 0})
    _section("1. 틀린 문항 목록")
    if nums:
        pdf.multi_cell(
            0,
            7,
            f"총 {len(nums)}문항 오답 — "+ ", ".join(f"{n}번" for n in nums),
            wrapmode="CHAR",
        )
    else:
        pdf.multi_cell(0, 7, "기록된 오답 문항이 없습니다.", wrapmode="CHAR")
    pdf.ln(4)

    _section("2. 오답 상세 분석")
    if wrong_rows:
        for idx, row in enumerate(wrong_rows, 1):
            row_nums = row.get("wrong_numbers") or []
            num_str = ", ".join(f"{n}번" for n in row_nums) if row_nums else "—"
            _font(11)
            pdf.set_fill_color(228, 238, 255)
            pdf.multi_cell(
                0,
                8,
                f"[{idx}] {row.get('topic', '—')} — {num_str}",
                fill=True,
                wrapmode="CHAR",
            )
            _font(10)
            pdf.multi_cell(
                0,
                6,
                f"틀린 이유: {row.get('wrong_reason', '—')}",
                wrapmode="CHAR",
            )
            pdf.multi_cell(
                0,
                6,
                f"보완할 개념: {row.get('concept_to_review', '—')}",
                wrapmode="CHAR",
            )
            pdf.ln(3)
    elif nums:
        for n in nums:
            pdf.multi_cell(
                0,
                6,
                f"문항 {n}번 — 오답 (AI 상세 분석 데이터 없음. OCR 보고서 작성 후 다시 생성하세요.)",
                wrapmode="CHAR",
            )
            pdf.ln(1)
    else:
        pdf.multi_cell(0, 6, "분석할 오답 데이터가 없습니다.", wrapmode="CHAR")
    pdf.ln(3)

    summary = overview.get("summary") or report.get("summary") or ""
    if summary:
        _section("3. 종합 총평")
        headline = overview.get("headline") or "종합 총평"
        pdf.multi_cell(0, 7, headline, wrapmode="CHAR")
        pdf.ln(1)
        pdf.multi_cell(0, 6, summary, wrapmode="CHAR")
        strengths = overview.get("strengths") or []
        if strengths:
            pdf.ln(2)
            pdf.multi_cell(0, 6, "강점:", wrapmode="CHAR")
            for s in strengths:
                pdf.multi_cell(0, 5, f"  • {s}", wrapmode="CHAR")
        weaknesses = overview.get("weaknesses") or []
        if weaknesses:
            pdf.ln(2)
            pdf.multi_cell(0, 6, "취약점:", wrapmode="CHAR")
            for w in weaknesses:
                pdf.multi_cell(0, 5, f"  • {w}", wrapmode="CHAR")
        pdf.ln(3)

    intro = prescription.get("intro") or ""
    rules = prescription.get("parent_action_rules") or []
    weekly = prescription.get("weekly_focus") or ""
    if intro or rules or weekly:
        _section("4. 학습 처방")
        if intro:
            pdf.multi_cell(0, 6, intro, wrapmode="CHAR")
            pdf.ln(2)
        if rules:
            pdf.multi_cell(0, 6, "학부모 행동 가이드:", wrapmode="CHAR")
            for rule in rules[:5]:
                pdf.multi_cell(0, 5, f"  • {rule}", wrapmode="CHAR")
            pdf.ln(2)
        if weekly:
            pdf.multi_cell(0, 6, f"이번 주 집중: {weekly}", wrapmode="CHAR")

    return bytes(pdf.output()), filename


def generate_student_wrong_answer_report_pdf_from_db(
    student_id: int,
    test_name: str,
    test_date: str,
    *,
    test_id: int | None = None,
    grade_label: str | None = None,
) -> tuple[bytes, str]:
    """Load test record + AI analysis from DB and build the PDF."""
    from database import get_student_result_record

    if test_id is not None:
        ctx = _load_db_report_context(student_id, int(test_id))
        record = ctx["record"]
        profile = ctx["profile"]
        return generate_student_wrong_answer_report_pdf(
            student_name=profile["student_name"],
            test_name=record["test_name"],
            test_date=record["date"],
            wrong_numbers=record["wrong_numbers"],
            score=float(record["score"]),
            grade_label=grade_label or ctx["grade_label"],
            class_name=profile.get("class_name", ""),
            analysis_report=ctx["analysis"],
        )

    record = get_student_result_record(
        student_id=student_id,
        test_name=test_name,
        test_date=test_date,
    )
    if record:
        return generate_student_wrong_answer_report_pdf_from_db(
            student_id,
            record["test_name"],
            record["date"],
            test_id=record["test_id"],
            grade_label=grade_label,
        )

    from database import (
        get_grade_report_for_exam,
        get_student_profile,
        get_student_test_entry,
    )

    profile = get_student_profile(student_id)
    if not profile:
        raise ValueError(f"학생 ID {student_id}를 찾을 수 없습니다.")

    entry = get_student_test_entry(student_id, test_name, test_date)
    if not entry:
        raise ValueError(
            f"{profile['student_name']} 학생의 '{test_name}'({test_date}) 시험 기록이 없습니다."
        )

    analysis = get_grade_report_for_exam(student_id, test_name, test_date)
    grade = grade_label or infer_grade_label(
        profile.get("class_name", ""),
        profile.get("class_description", ""),
    )
    wrong_numbers = entry.get("wrong_numbers") or []
    if isinstance(wrong_numbers, str):
        import json

        try:
            wrong_numbers = json.loads(wrong_numbers)
        except json.JSONDecodeError:
            wrong_numbers = []

    return generate_student_wrong_answer_report_pdf(
        student_name=profile["student_name"],
        test_name=test_name,
        test_date=test_date,
        wrong_numbers=[int(n) for n in wrong_numbers],
        score=float(entry.get("score") or 0),
        grade_label=grade,
        class_name=profile.get("class_name", ""),
        analysis_report=analysis,
    )

