"""Question Bank UI — OCR workbook import, ``st.data_editor`` review, DB save."""

from __future__ import annotations

import os
import re
from collections.abc import Callable
from typing import Any

import pandas as pd
import streamlit as st

from database import (
    bulk_insert_question_bank,
    delete_question_bank_ids,
    get_question_bank_stats,
    list_question_bank,
)
from ocr_extract import (
    GoogleVisionAuthError,
    GOOGLE_VISION_AUTH_USER_MESSAGE,
    OpenAIAuthError,
    OPENAI_AUTH_USER_MESSAGE,
    WORKBOOK_MAX_PAGES,
    assemble_exam_extraction,
    extract_text_google_vision,
    has_google_vision_credentials,
    has_openai_api_key,
    parse_workbook_questions_from_extraction,
    refine_ocr_pages_with_gpt,
)

_MODULE_DIR = os.path.dirname(os.path.abspath(__file__))
WORKBOOKS_DIR = os.path.join(_MODULE_DIR, "data", "workbooks")

QB_LEVELS = ["High", "Mid", "Low"]
EDITOR_COLUMNS = ["문항번호", "단원", "난이도", "문제내용", "정답", "해설"]

DEFAULT_TOPICS = [
    "Algebra", "Geometry", "Arithmetic", "Fractions & Decimals",
    "Word Problems", "Statistics", "Probability", "Calculus",
    "Number Theory", "Functions & Graphs", "Equations", "Other",
    "미분류",
]

_QB_SESSION_DEFAULTS: dict[str, Any] = {
    "qb_workbook_name": "",
    "qb_active_workbook_title": "",
    "qb_parsed_rows": None,
    "qb_page_numbers": None,
    "qb_extract_error": None,
}


def _init_question_bank_session() -> None:
    """Initialize question-bank session keys before any widgets render."""
    for key, default in _QB_SESSION_DEFAULTS.items():
        if key not in st.session_state:
            st.session_state[key] = default

    pending_name = st.session_state.pop("_qb_pending_workbook_name", None)
    if pending_name is not None:
        st.session_state["qb_workbook_name"] = str(pending_name)
        st.session_state["qb_active_workbook_title"] = str(pending_name)


def _resolve_workbook_title(*, fallback_upload_name: str = "") -> str:
    """Title for DB save — widget value, then active title, then upload filename."""
    widget_name = (st.session_state.get("qb_workbook_name") or "").strip()
    if widget_name:
        return widget_name
    active = (st.session_state.get("qb_active_workbook_title") or "").strip()
    if active:
        return active
    if fallback_upload_name:
        return os.path.splitext(fallback_upload_name)[0]
    return "문제집"


def _sanitize_workbook_name(text: str, *, max_len: int = 64) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\n\r\t]', "", (text or "").strip())
    cleaned = re.sub(r"\s+ ", "_", cleaned)
    cleaned = re.sub(r"_+ ", "_", cleaned).strip("._")
    return (cleaned[:max_len] if cleaned else "workbook")


def rows_to_editor_df(rows: list[dict[str, Any]]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame(columns=EDITOR_COLUMNS)
    return pd.DataFrame([
        {
            "문항번호": int(r.get("question_number") or 0),
            "단원": str(r.get("topic") or "미분류"),
            "난이도": str(r.get("difficulty") or "Mid"),
            "문제내용": str(r.get("question") or ""),
            "정답": str(r.get("answer") or ""),
            "해설": str(r.get("explanation") or ""),
        }
        for r in rows
    ])


def editor_df_to_rows(
    edited: pd.DataFrame,
    *,
    source_workbook: str,
    page_numbers: list[int] | None = None,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for i, (_, row) in enumerate(edited.iterrows()):
        question = str(row.get("문제내용") or "").strip()
        if not question:
            continue
        diff = str(row.get("난이도") or "Mid").strip()
        if diff not in QB_LEVELS:
            diff = "Mid"
        page_num = int(page_numbers[i]) if page_numbers and i < len(page_numbers) else 0
        rows.append({
            "question_number": int(row.get("문항번호") or 0),
            "topic": str(row.get("단원") or "미분류").strip() or "미분류",
            "difficulty": diff,
            "question": question,
            "answer": str(row.get("정답") or "").strip(),
            "explanation": str(row.get("해설") or "").strip(),
            "page_number": page_num,
            "source_workbook": source_workbook,
        })
    return rows


def db_df_to_editor_df(q_df: pd.DataFrame) -> pd.DataFrame:
    if q_df.empty:
        return pd.DataFrame(columns=["id", *EDITOR_COLUMNS, "문제집"])
    return pd.DataFrame({
        "id": q_df["id"],
        "문항번호": q_df["question_number"],
        "단원": q_df["topic"],
        "난이도": q_df["level"],
        "문제내용": q_df["question"],
        "정답": q_df.apply(
            lambda r: (r.get("answer") or r.get("answer_hint") or ""),
            axis=1,
        ),
        "해설": q_df["explanation"].fillna(""),
        "문제집": q_df["source_workbook"].fillna(""),
    })


def editor_column_config() -> dict[str, Any]:
    return {
        "문항번호": st.column_config.NumberColumn("문항번호", min_value=0, step=1),
        "단원": st.column_config.TextColumn("단원", width="medium"),
        "난이도": st.column_config.SelectboxColumn(
            "난이도",
            options=QB_LEVELS,
            required=True,
        ),
        "문제내용": st.column_config.TextColumn("문제내용", width="large"),
        "정답": st.column_config.TextColumn("정답", width="medium"),
        "해설": st.column_config.TextColumn("해설", width="large"),
    }


def ocr_workbook_uploads(uploads: list[Any]) -> dict[str, Any]:
    """Vision OCR across multiple images/PDFs; returns merged page extraction."""
    all_raw_pages: list[dict[str, Any]] = []
    page_counter = 1
    for upload in uploads:
        file_bytes = upload.getvalue()
        fname = upload.name
        raw = extract_text_google_vision(
            file_bytes,
            filename=fname,
            max_pages=WORKBOOK_MAX_PAGES,
        )
        for pg in raw.get("pages") or []:
            all_raw_pages.append({
                "page": page_counter,
                "text": pg.get("text", ""),
                "source_file": fname,
                "method": pg.get("method", "google_vision"),
            })
            page_counter += 1
    status = "ok" if any(str(p.get("text") or "").strip() for p in all_raw_pages) else "empty"
    refined = refine_ocr_pages_with_gpt(all_raw_pages)
    return assemble_exam_extraction(
        {"source": "workbook", "pages": all_raw_pages, "status": status},
        refined,
    )


def save_workbook_uploads(uploads: list[Any], workbook_name: str) -> None:
    os.makedirs(WORKBOOKS_DIR, exist_ok=True)
    safe = _sanitize_workbook_name(workbook_name)
    dest_dir = os.path.join(WORKBOOKS_DIR, safe)
    os.makedirs(dest_dir, exist_ok=True)
    for upload in uploads:
        dest = os.path.join(dest_dir, os.path.basename(upload.name))
        with open(dest, "wb") as fh:
            fh.write(upload.getvalue())


def _distinct_topics() -> list[str]:
    df = list_question_bank(limit=5000)
    if df.empty:
        return []
    return sorted(df["topic"].dropna().unique().tolist())


def _render_ocr_import_section(*, sync_csvs: Callable[[], None] | None) -> None:
    _init_question_bank_session()

    with st.container(border=True):
        st.markdown("##### Upload · 문제집 일괄 등록")
        wb_name = st.text_input(
            "문제집 이름",
            placeholder="예: 중2-함수-워크북",
            key="qb_workbook_name",
        )
        uploads = st.file_uploader(
            "Upload",
            type=["jpg", "jpeg", "png", "webp", "pdf"],
            accept_multiple_files=True,
            key="qb_workbook_upload",
            help="문제집 사진·PDF를 여러 장 선택해 한 번에 업로드",
        )
        if uploads:
            st.caption(f"선택됨: **{len(uploads)}**개 파일")
        ocr_btn = st.button(
            "OCR 추출",
            type="primary",
            disabled=not uploads,
            key="qb_ocr_run_btn",
        )

    if ocr_btn and uploads:
        if not has_google_vision_credentials():
            st.session_state["qb_extract_error"] = GOOGLE_VISION_AUTH_USER_MESSAGE
        elif not has_openai_api_key():
            st.session_state["qb_extract_error"] = OPENAI_AUTH_USER_MESSAGE
        else:
            try:
                title = _resolve_workbook_title(
                    fallback_upload_name=uploads[0].name,
                )
                st.session_state["_qb_pending_workbook_name"] = title
                st.session_state["qb_active_workbook_title"] = title
                with st.spinner("OCR 분석 중 (전체 페이지)…"):
                    extraction = ocr_workbook_uploads(uploads)
                with st.spinner("AI 문항 분리 중 (페이지별)…"):
                    parsed_rows = parse_workbook_questions_from_extraction(
                        extraction,
                        source_workbook=title,
                        use_gpt_structure=True,
                    )
                try:
                    save_workbook_uploads(uploads, title)
                except Exception as file_exc:
                    st.warning(f"원본 파일 저장 실패 (DB 등록은 가능): {file_exc}")
                st.session_state["qb_parsed_rows"] = parsed_rows
                st.session_state["qb_page_numbers"] = [
                    int(r.get("page_number") or 0) for r in parsed_rows
                ]
                st.session_state.pop("qb_extract_error", None)
                st.success(
                    f"추출 완료 — **{len(parsed_rows)}**문항 "
                    f"({len(extraction.get('pages') or [])}페이지). 아래 표에서 검수해 주세요.",
                )
                st.rerun()
            except GoogleVisionAuthError as exc:
                st.session_state["qb_extract_error"] = str(exc)
            except OpenAIAuthError:
                st.session_state["qb_extract_error"] = OPENAI_AUTH_USER_MESSAGE
            except Exception as exc:
                st.session_state["qb_extract_error"] = str(exc)

    if st.session_state.get("qb_extract_error"):
        st.error(st.session_state["qb_extract_error"])

    parsed_rows = st.session_state.get("qb_parsed_rows") or []
    if not parsed_rows:
        return

    workbook_title = (
        st.session_state.get("qb_active_workbook_title")
        or st.session_state.get("qb_workbook_name")
        or "문제집"
    )
    page_numbers = st.session_state.get("qb_page_numbers") or []

    with st.container(border=True):
        st.markdown("##### 추출 결과 검수")
        st.caption(
            f"**{workbook_title}** · {len(parsed_rows)}문항 — "
            "수정 후 **데이터 저장**을 눌러 DB에 반영합니다."
        )
        editor_df = rows_to_editor_df(parsed_rows)
        edited = st.data_editor(
            editor_df,
            num_rows="dynamic",
            hide_index=True,
            width="stretch",
            key="qb_questions_editor",
            column_config=editor_column_config(),
        )
        save_col, clear_col = st.columns([1, 1])
        with save_col:
            if st.button("데이터 저장", type="primary", key="qb_save_btn"):
                rows = editor_df_to_rows(
                    edited,
                    source_workbook=workbook_title,
                    page_numbers=page_numbers,
                )
                if not rows:
                    st.error("저장할 문항이 없습니다. **문제내용**을 입력해 주세요.")
                else:
                    try:
                        count = bulk_insert_question_bank(rows)
                        if sync_csvs:
                            sync_csvs()
                        verify = get_question_bank_stats()
                        st.session_state.pop("qb_parsed_rows", None)
                        st.session_state.pop("qb_page_numbers", None)
                        st.success(
                            f"**{count}**개 문항 저장 · DB 총 **{verify['total']}**건 "
                            f"(단원 {len(verify['topics'])}종)",
                        )
                        st.rerun()
                    except Exception as exc:
                        st.error(f"저장 실패: {exc}")
        with clear_col:
            if st.button("추출 결과 지우기", key="qb_clear_btn"):
                st.session_state.pop("qb_parsed_rows", None)
                st.session_state.pop("qb_page_numbers", None)
                st.rerun()


def _render_bank_integrity_panel() -> None:
    """Show DB topic/level distribution for data-integrity verification."""
    stats = get_question_bank_stats()
    with st.expander("DB 데이터 무결성 확인", expanded=stats["total"] == 0):
        st.caption(f"DB 경로: `{stats['db_path']}`")
        c1, c2, c3 = st.columns(3)
        c1.metric("총 문항", stats["total"])
        c2.metric("단원 종류", len(stats["topics"]))
        c3.metric("무효 난이도", stats["invalid_level_count"])
        if stats["empty_topic_count"]:
            st.warning(f"단원 미입력 문항: **{stats['empty_topic_count']}**건")
        if stats["levels"]:
            st.markdown("**난이도 분포:** "+ ", ".join(
                f"{k} {v}건" for k, v in stats["levels"].items()
            ))
        if stats["topics"]:
            top_topics = list(stats["topics"].items())[:12]
            st.markdown("**단원 분포 (상위):** "+ ", ".join(
                f"{k}({v})" for k, v in top_topics
            ))
        if stats["recent_samples"]:
            st.markdown("**최근 저장 샘플**")
            st.dataframe(
                pd.DataFrame(stats["recent_samples"]),
                hide_index=True,
                width="stretch",
            )


def _render_browse_section(*, sync_csvs: Callable[[], None] | None) -> None:
    _render_bank_integrity_panel()

    fc1, fc2, fc3 = st.columns([1.5, 1.5, 1])
    with fc1:
        topic_opts = sorted(set(DEFAULT_TOPICS + _distinct_topics()))
        sel_topics = st.multiselect(
            "단원 필터",
            options=topic_opts,
            placeholder="전체",
            key="qb_browse_topic_filter",
        )
    with fc2:
        sel_levels = st.multiselect(
            "난이도 필터",
            options=QB_LEVELS,
            placeholder="전체",
            key="qb_browse_level_filter",
        )
    with fc3:
        st.markdown("&nbsp;")
        if st.button("필터 초기화", key="qb_browse_clear_filter"):
            st.session_state.pop("qb_browse_topic_filter", None)
            st.session_state.pop("qb_browse_level_filter", None)
            st.rerun()

    q_df = list_question_bank(
        topics=sel_topics if sel_topics else None,
        levels=sel_levels if sel_levels else None,
    )

    if q_df.empty:
        st.info("등록된 문제가 없습니다. **Upload**로 문제집을 등록해 주세요.")
        return

    st.caption(f"총 **{len(q_df)}**문항")
    browse_df = db_df_to_editor_df(q_df)
    st.data_editor(
        browse_df,
        hide_index=True,
        width="stretch",
        key="qb_browse_editor",
        disabled=["id", "문제집"],
        column_config={
            **editor_column_config(),
            "id": st.column_config.NumberColumn("ID", disabled=True),
            "문제집": st.column_config.TextColumn("문제집", disabled=True),
        },
    )

    del_ids = st.multiselect(
        "삭제할 ID",
        options=sorted(browse_df["id"].astype(int).tolist()),
        key="qb_delete_ids",
    )
    if st.button("선택 삭제", key="qb_delete_btn", disabled=not del_ids):
        delete_question_bank_ids([int(i) for i in del_ids])
        if sync_csvs:
            sync_csvs()
        st.success(f"**{len(del_ids)}**개 문항 삭제됨")
        st.rerun()


def render_question_bank_page(*, sync_csvs: Callable[[], None] | None = None) -> None:
    """Main Question Bank page — OCR import + data editor + DB save."""
    _init_question_bank_session()

    st.markdown("### 문제 은행 (Question Bank)")
    st.caption(
        "문제집을 Upload하면 OCR·AI가 문항을 추출합니다. "
        "검수 후 **데이터 저장**하면 유사문제 추출에서 사용됩니다."
    )

    tab_register, tab_browse = st.tabs(["문제집 등록", "등록된 문제"])

    with tab_register:
        _render_ocr_import_section(sync_csvs=sync_csvs)

        st.divider()
        st.markdown("##### 수동 문항 추가")
        with st.form("qb_manual_add_form", clear_on_submit=True):
            mc1, mc2, mc3 = st.columns([2, 1, 1])
            m_topic = mc1.text_input("단원", value="미분류")
            m_level = mc2.selectbox("난이도", QB_LEVELS)
            m_num = mc3.number_input("문항번호", min_value=0, step=1, value=0)
            m_q = st.text_area("문제내용", height=80)
            m_a = st.text_input("정답")
            m_e = st.text_area("해설", height=60)
            m_wb = st.text_input(
                "문제집 이름 (선택)",
                value=(
                    st.session_state.get("qb_active_workbook_title")
                    or st.session_state.get("qb_workbook_name")
                    or ""
                ),
            )
            if st.form_submit_button("추가", type="primary"):
                if not m_q.strip():
                    st.error("문제내용을 입력해 주세요.")
                else:
                    bulk_insert_question_bank([{
                        "question_number": int(m_num),
                        "question": m_q.strip(),
                        "answer": m_a.strip(),
                        "explanation": m_e.strip(),
                        "topic": m_topic.strip() or "미분류",
                        "difficulty": m_level,
                        "source_workbook": m_wb.strip(),
                        "page_number": 0,
                    }])
                    if sync_csvs:
                        sync_csvs()
                    st.success("문항이 추가되었습니다.")
                    st.rerun()

    with tab_browse:
        _render_browse_section(sync_csvs=sync_csvs)
