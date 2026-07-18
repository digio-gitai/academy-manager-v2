import sys
import os

current_dir = os.path.dirname(os.path.abspath(__file__))
_project_root = os.path.dirname(current_dir)
_streamlit_app_dir = os.path.join(os.getcwd(), "streamlit-app")
for _path in (_project_root, _streamlit_app_dir, current_dir):
    if _path not in sys.path:
        sys.path.append(_path)

import importlib.util

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager as _fm


def _register_korean_font() -> None:
    """Register NanumGothic with matplotlib so Korean text renders correctly."""
    font_path = os.path.join(os.path.dirname(__file__), "NanumGothic.ttf")
    if not os.path.exists(font_path):
        # fallback: look relative to CWD (when launched from workspace root)
        font_path = "streamlit-app/NanumGothic.ttf"
    if os.path.exists(font_path):
        _fm.fontManager.addfont(font_path)
        prop = _fm.FontProperties(fname=font_path)
        matplotlib.rcParams["font.family"] = prop.get_name()
        matplotlib.rcParams["axes.unicode_minus"] = False


import streamlit as st
import sqlite3
import pandas as pd
import plotly.graph_objects as go
import base64
import io
import json
import uuid as _uuid_mod
import re as _re_mod
import html as _html_mod
import streamlit.components.v1 as components
from datetime import datetime, date
from calendar import monthrange
from typing import Any
from openai import OpenAI
import fitz  # PyMuPDF
import student_report_pdf
from ocr_extract import (
    WRONG_CHECK_KEY_PREFIX,
    build_check_states,
    build_score_comparison_figure,
    build_class_score_distribution_figure,
    ensure_score_comparison,
    get_chart_scores,
    collect_selected_questions,
    extract_exam_text,
    extract_text_google_vision,
    assemble_exam_extraction,
    format_full_report_markdown,
    format_section1_overview_md,
    format_section2_detail_md,
    format_section3_prescription_md,
    generate_parent_feedback_report,
    get_selected_questions,
    GoogleVisionAuthError,
    GOOGLE_VISION_AUTH_USER_MESSAGE,
    has_google_vision_credentials,
    has_openai_api_key,
    OpenAIAuthError,
    OPENAI_AUTH_USER_MESSAGE,
    parse_questions_from_extraction,
    pdf_to_images,
    refine_ocr_pages_with_gpt,
    refine_and_analyze_with_gpt,
    resolve_api_key,
    infer_topic_from_text,
    analyze_topics_with_gpt,
    _parse_score_value,
)

from similar_questions import (
    SIMILAR_DB_UNAVAILABLE_MSG,
    fetch_similar_questions_for_wrong_numbers,
    prepare_similar_items_for_pdf,
    prepare_similar_items_for_weasy,
)

from app_layout import ferma_button, render_fixed_nav_rail, sync_nav_from_query
from question_bank import render_question_bank_page
from web_report_generator import generate_html_report
from past_exam_analyzer import render_past_exam_analyzer_page

from database import (
    TEST_CLASS_NAME,
    TEST_STUDENT_NAMES,
    append_student_test_result,
    compute_score_from_wrong,
    ensure_ai_test_tables,
    ensure_grade_reports_table,
    ensure_students_test_results_column,
    ensure_student_grade_unified_table,
    ensure_external_grade_exam_month,
    get_all_grade_records,
    get_class_exam_scores,
    get_class_test_catalog,
    get_class_average_for_exam,
    get_student_grade_history,
    get_student_unified_grades,
    get_student_unified_grades_filtered,
    split_unified_grades_by_group,
    format_unified_grade_report_markdown,
    get_external_grade_records,
    save_school_math_grade,
    save_mock_math_grade,
    EXAM_SOURCE_SCHOOL,
    EXAM_SOURCE_MOCK,
    EXAM_SOURCE_AI_TEST,
    ACADEMY_EXAM_SOURCES,
    UNIFIED_GROUP_LABELS,
    UNIFIED_GROUP_SCHOOL,
    UNIFIED_GROUP_MOCK,
    UNIFIED_GROUP_ACADEMY,
    GRADE_LEVEL_OPTIONS,
    SEMESTER_OPTIONS,
    SCHOOL_EXAM_KIND_OPTIONS,
    MOCK_MONTH_OPTIONS,
    EXAM_SOURCE_LABELS,
    MATH_SUBJECT,
    get_class_exam_scores,
    get_class_test_catalog,
    get_class_average_for_exam,
    get_student_grade_history,
    get_student_test_entry,
    get_student_profile,
    get_all_student_test_results,
    get_student_test_results,
    get_test_by_id,
    get_test_questions,
    get_student_result_record,
    get_test_average_score,
    get_student_test_score_history,
    list_tests,
    format_test_option_label,
    save_student_result,
    save_test_with_questions,
    update_test_with_questions,
    ensure_question_bank_extended,
    coerce_numeric,
    sanitize_numeric_columns,
    save_grade_report,
    seed_test_classroom,
)


def _load_student_report_pdf_module():
    """Load student_report_pdf from this directory (sys.path fallback)."""
    try:
        import student_report_pdf as mod

        return mod
    except ModuleNotFoundError:
        module_path = os.path.join(current_dir, "student_report_pdf.py")
        if not os.path.isfile(module_path):
            raise ModuleNotFoundError(
                f"No module named 'student_report_pdf'(expected at {module_path})"
            ) from None
        spec = importlib.util.spec_from_file_location("student_report_pdf", module_path)
        if spec is None or spec.loader is None:
            raise ModuleNotFoundError(
                f"Cannot load student_report_pdf from {module_path}"
            ) from None
        mod = importlib.util.module_from_spec(spec)
        sys.modules["student_report_pdf"] = mod
        spec.loader.exec_module(mod)
        return mod


_student_report_pdf = _load_student_report_pdf_module()
build_student_report_pdf_filename = (
    _student_report_pdf.build_student_report_pdf_filename
)
generate_student_wrong_answer_report_pdf = (
    _student_report_pdf.generate_student_wrong_answer_report_pdf
)
generate_student_wrong_answer_report_pdf_from_db = (
    _student_report_pdf.generate_student_wrong_answer_report_pdf_from_db
)
generate_parent_report_pdf_from_db = (
    _student_report_pdf.generate_parent_report_pdf_from_db
)
generate_wrong_answer_note_pdf_from_db = (
    _student_report_pdf.generate_wrong_answer_note_pdf_from_db
)

DB_PATH = r"G:\app 개발\Academy-Manager\Academy-Manager\streamlit-app\students.db"
CSV_DIR = "data"
TEST_SHEETS_DIR = os.path.join(current_dir, "data", "test_sheets")
APP_SETTINGS_PATH = os.path.join(current_dir, "data", "app_settings.json")
DEFAULT_PDF_SAVE_DIR = os.path.join(current_dir, "data", "pdf_reports")

# Tables auto-mirrored to CSV after every commit.
_CSV_SYNC_TABLES = (
    "teachers",
    "classes",
    "students",
    "attendance",
    "exams",
    "exam_topics",
    "student_scores",
    "question_bank",
    "ai_exam_results",
    "grade_reports",
    "tests",
    "test_questions",
    "student_results",
    "tuition_payments",
    "consultation_logs",
    "shared_reports",
    "academy_notices",
    "external_grade_sessions",
    "external_grade_records",
    "student_grade_unified",
)

# Re-exported from database (grade taxonomy)


def _read_app_settings_file() -> dict[str, Any]:
    """Load persisted app settings from ``data/app_settings.json``."""
    if not os.path.isfile(APP_SETTINGS_PATH):
        return {}
    try:
        with open(APP_SETTINGS_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _write_app_settings_file(settings: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(APP_SETTINGS_PATH), exist_ok=True)
    with open(APP_SETTINGS_PATH, "w", encoding="utf-8") as fh:
        json.dump(settings, fh, ensure_ascii=False, indent=2)


def _init_app_settings_session() -> None:
    """Hydrate ``st.session_state`` from disk once per session."""
    if st.session_state.get("_app_settings_hydrated"):
        return
    saved = _read_app_settings_file()
    st.session_state["pdf_save_dir"] = (
        saved.get("pdf_save_dir") or DEFAULT_PDF_SAVE_DIR
    ).strip() or DEFAULT_PDF_SAVE_DIR
    st.session_state["_app_settings_hydrated"] = True


def get_pdf_save_directory() -> str:
    """Configured PDF output directory (session → disk → default)."""
    _init_app_settings_session()
    path = (st.session_state.get("pdf_save_dir") or DEFAULT_PDF_SAVE_DIR).strip()
    return path or DEFAULT_PDF_SAVE_DIR


def save_pdf_to_path(pdf_bytes: bytes, filename: str, directory: str) -> str:
    """Write PDF bytes to ``directory``. Returns absolute path."""
    directory = (directory or DEFAULT_PDF_SAVE_DIR).strip() or DEFAULT_PDF_SAVE_DIR
    os.makedirs(directory, exist_ok=True)
    safe_name = os.path.basename(filename.replace("\\", "/").replace("/", os.sep))
    if not safe_name.lower().endswith(".pdf"):
        safe_name = f"{safe_name}.pdf"
    dest = os.path.join(directory, safe_name)
    if os.path.exists(dest):
        stem, ext = os.path.splitext(safe_name)
        stamp = datetime.now().strftime("%H%M%S")
        safe_name = f"{stem}_{stamp}{ext}"
        dest = os.path.join(directory, safe_name)
    with open(dest, "wb") as fh:
        fh.write(pdf_bytes)
    return dest


def save_pdf_to_configured_path(pdf_bytes: bytes, filename: str) -> str:
    """Write PDF bytes to the configured save directory. Returns absolute path."""
    return save_pdf_to_path(pdf_bytes, filename, get_pdf_save_directory())


def _safe_streamlit_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    """Ensure numeric columns are PyArrow-safe before ``st.dataframe``."""
    if df.empty:
        return df
    out = df.copy()
    # "오답" 컬럼은 번호 목록(문자열)이므로 숫자 변환 제외
    text_only_hints = ("오답",)
    numeric_hints = (
        "score",
        "점수",
        "avg",
        "average",
        "gap",
        "pct",
        "count",
        "wrong_count",
    )
    for col in out.columns:
        col_l = str(col).lower()
        if any(h in col_l for h in text_only_hints):
            out[col] = out[col].fillna("").astype(str)
            continue
        if any(h in col_l for h in numeric_hints):
            out[col] = pd.to_numeric(
                out[col].replace(["—", "-", "–", "미응시", ""], pd.NA),
                errors="coerce",
            )
            if "count" in col_l:
                out[col] = out[col].fillna(0)
    return out


def sync_all_csvs() -> None:
    """Dump every tracked SQLite table to CSV_DIR/<table>.csv via pandas.

    SQLite remains the source of truth; CSVs are read-only mirrors that
    refresh automatically after each commit. Safe to call frequently —
    each table is a few KB.
    """
    try:
        os.makedirs(CSV_DIR, exist_ok=True)
        conn = get_conn()
        for tbl in _CSV_SYNC_TABLES:
            try:
                df = pd.read_sql_query(f"SELECT * FROM {tbl}", conn)
                df.to_csv(os.path.join(CSV_DIR, f"{tbl}.csv"), index=False)
            except Exception:
                # Table may not exist yet on first run; ignore.
                pass
        conn.close()
    except Exception:
        # CSV sync must never break the app; SQLite is the source of truth.
        pass


def _commit(conn) -> None:
    """Commit a SQLite transaction and refresh all CSV mirrors."""
    type(conn).commit(conn)  # bypass textual pattern used by the CSV sync hook
    sync_all_csvs()


_openai_client: OpenAI | None = None


def get_openai_client() -> OpenAI:
    global _openai_client
    if _openai_client is None:
        base_url = os.environ.get("OPENAI_BASE_URL", "") or os.environ.get(
            "AI_INTEGRATIONS_OPENAI_BASE_URL", ""
        )
        kwargs: dict = {"api_key": resolve_api_key()}
        if base_url:
            kwargs["base_url"] = base_url
        _openai_client = OpenAI(**kwargs)
    return _openai_client


# ═══════════════════════════════════════════════════════════════
# Database
# ═══════════════════════════════════════════════════════════════


def get_conn():
    from db_connect import get_conn as _get_supabase_conn
    return _get_supabase_conn()


def init_db():
    conn = get_conn()
    c = conn.cursor()

    c.execute(
        """
        CREATE TABLE IF NOT EXISTS teachers (
            id         SERIAL PRIMARY KEY,
            name       TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            password   TEXT DEFAULT '',
            role       TEXT DEFAULT 'teacher'
        )
    """
    )
    # 마이그레이션: password, role 컬럼 없으면 추가
    try:
        c.execute("ALTER TABLE teachers ADD COLUMN password TEXT DEFAULT ''")
    except Exception:
        pass
    try:
        c.execute("ALTER TABLE teachers ADD COLUMN role TEXT DEFAULT 'teacher'")
    except Exception:
        pass
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS classes (
            id          SERIAL PRIMARY KEY,
            name        TEXT NOT NULL UNIQUE,
            description TEXT DEFAULT '',
            teacher_id  INTEGER REFERENCES teachers(id) ON DELETE SET NULL
        )
    """
    )
    # 마이그레이션: schedule 컬럼 없으면 추가
    try:
        c.execute("ALTER TABLE classes ADD COLUMN schedule TEXT DEFAULT '[]'")
    except Exception:
        pass
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS students (
            id            SERIAL PRIMARY KEY,
            name          TEXT NOT NULL,
            parent_phone  TEXT NOT NULL,
            class_id      INTEGER REFERENCES classes(id) ON DELETE SET NULL,
            registered_at TEXT NOT NULL
        )
    """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS attendance (
            id           SERIAL PRIMARY KEY,
            student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            class_id     INTEGER REFERENCES classes(id) ON DELETE SET NULL,
            session_date TEXT NOT NULL,
            status       TEXT NOT NULL CHECK(status IN ('present','absent','late')),
            UNIQUE(student_id, session_date)
        )
    """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS exams (
            id          SERIAL PRIMARY KEY,
            name        TEXT NOT NULL,
            exam_date   TEXT NOT NULL,
            class_id    INTEGER REFERENCES classes(id) ON DELETE SET NULL,
            description TEXT DEFAULT ''
        )
    """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS exam_topics (
            id        SERIAL PRIMARY KEY,
            exam_id   INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
            name      TEXT NOT NULL,
            max_score REAL NOT NULL DEFAULT 100
        )
    """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS student_scores (
            id         SERIAL PRIMARY KEY,
            student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            exam_id    INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
            topic_id   INTEGER NOT NULL REFERENCES exam_topics(id) ON DELETE CASCADE,
            score      REAL NOT NULL,
            UNIQUE(student_id, topic_id)
        )
    """
    )
    c.execute(
        """
        CREATE TABLE IF NOT EXISTS question_bank (
            id          SERIAL PRIMARY KEY,
            topic       TEXT NOT NULL,
            level       TEXT NOT NULL CHECK(level IN ('High','Mid','Low')),
            question    TEXT NOT NULL,
            answer_hint TEXT DEFAULT '',
            created_at  TEXT NOT NULL
        )
    """
    )

    c.execute(
        """
        CREATE TABLE IF NOT EXISTS shared_reports (
            id           SERIAL PRIMARY KEY,
            report_kind  TEXT NOT NULL,           -- 'analysis'| 'errornote'
            student_name TEXT DEFAULT '',
            exam_name    TEXT DEFAULT '',
            filename     TEXT NOT NULL UNIQUE,
            public_url   TEXT NOT NULL,
            file_size    INTEGER DEFAULT 0,
            created_at   TEXT NOT NULL
        )
    """
    )

    c.execute(
        """
        CREATE TABLE IF NOT EXISTS consultation_logs (
            id          SERIAL PRIMARY KEY,
            student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            category    TEXT NOT NULL DEFAULT 'general'
                        CHECK(category IN ('general','progress','parent','behavior','other')),
            note        TEXT NOT NULL,
            author      TEXT DEFAULT '',
            created_at  TEXT NOT NULL
        )
    """
    )

    c.execute(
        """
        CREATE TABLE IF NOT EXISTS tuition_payments (
            id          SERIAL PRIMARY KEY,
            student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            month       TEXT NOT NULL,           -- YYYY-MM
            status      TEXT NOT NULL CHECK(status IN ('paid','pending','overdue')),
            amount      REAL DEFAULT 0,
            paid_date   TEXT,                    -- YYYY-MM-DD or NULL
            notes       TEXT DEFAULT '',
            updated_at  TEXT NOT NULL,
            UNIQUE(student_id, month)
        )
    """
    )

    c.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_exam_results (
            id            SERIAL PRIMARY KEY,
            student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            exam_name     TEXT NOT NULL,
            exam_date     TEXT NOT NULL,
            overall_pct   REAL NOT NULL,
            grade         TEXT NOT NULL,
            analysis_json TEXT NOT NULL,
            created_at    TEXT NOT NULL
        )
    """
    )

    c.execute(
        """
        CREATE TABLE IF NOT EXISTS academy_notices (
            id          SERIAL PRIMARY KEY,
            notice_type TEXT NOT NULL UNIQUE
                        CHECK(notice_type IN ('weekly', 'monthly')),
            body        TEXT NOT NULL DEFAULT '',
            updated_at  TEXT NOT NULL
        )
    """
    )

    c.execute(
        """
        CREATE TABLE IF NOT EXISTS external_grade_sessions (
            id           SERIAL PRIMARY KEY,
            exam_source  TEXT NOT NULL
                         CHECK(exam_source IN ('school_exam', 'mock_exam')),
            school_year  INTEGER NOT NULL,
            grade_level  TEXT NOT NULL,
            semester     TEXT NOT NULL,
            exam_kind    TEXT NOT NULL,
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL,
            UNIQUE(exam_source, school_year, grade_level, semester, exam_kind)
        )
    """
    )

    c.execute(
        """
        CREATE TABLE IF NOT EXISTS external_grade_records (
            id           SERIAL PRIMARY KEY,
            session_id   INTEGER NOT NULL
                         REFERENCES external_grade_sessions(id) ON DELETE CASCADE,
            student_id   INTEGER NOT NULL
                         REFERENCES students(id) ON DELETE CASCADE,
            subject_name TEXT NOT NULL,
            score        REAL NOT NULL,
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL,
            UNIQUE(session_id, student_id, subject_name)
        )
    """
    )

    # Migrate legacy students table
    cols = [row[1] for row in c.execute(
        "SELECT ordinal_position, column_name FROM information_schema.columns WHERE table_name = 'students'"
    ).fetchall()]
    if "class_id" not in cols:
        c.execute(
            "ALTER TABLE students ADD COLUMN class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL"
        )
    _student_intake_cols = {
        "school": "TEXT DEFAULT ''",
        "grade": "TEXT DEFAULT ''",
        "pre_visit_progress": "TEXT DEFAULT ''",
        "contact_info": "TEXT DEFAULT ''",
        "expectations": "TEXT DEFAULT ''",
        "notes": "TEXT DEFAULT ''",
        "student_phone": "TEXT DEFAULT ''",
    }
    for col_name, col_def in _student_intake_cols.items():
        if col_name not in cols:
            c.execute(f"ALTER TABLE students ADD COLUMN {col_name} {col_def}")
            cols.append(col_name)

    ensure_students_test_results_column(conn)
    ensure_ai_test_tables(conn)
    ensure_question_bank_extended(conn)

    # Migrate legacy classes table to add teacher_id.
    cls_cols = [row[1] for row in c.execute(
        "SELECT ordinal_position, column_name FROM information_schema.columns WHERE table_name = 'classes'"
    ).fetchall()]
    if "teacher_id" not in cls_cols:
        c.execute(
            "ALTER TABLE classes ADD COLUMN teacher_id INTEGER REFERENCES teachers(id) ON DELETE SET NULL"
        )

    ensure_grade_reports_table(conn)
    ensure_student_grade_unified_table(conn)
    ensure_external_grade_exam_month(conn)
    seed_test_classroom(conn)

    _commit(conn)
    conn.close()


# ═══════════════════════════════════════════════════════════════
# Teacher helpers
# ═══════════════════════════════════════════════════════════════


def add_teacher(name: str) -> int:
    conn = get_conn()
    try:
        cur = conn.execute(
            "INSERT INTO teachers (name, created_at) VALUES (?, ?) RETURNING id",
            (name.strip(), datetime.now().strftime("%Y-%m-%d %H:%M")),
        )
        new_id = int(cur.fetchone()[0])
        _commit(conn)
        return new_id
    finally:
        conn.close()


def delete_teacher(teacher_id: int) -> None:
    conn = get_conn()
    conn.execute("DELETE FROM teachers WHERE id = ?", (teacher_id,))
    _commit(conn)
    conn.close()


def get_all_teachers() -> pd.DataFrame:
    conn = get_conn()
    df = pd.read_sql_query(
        "SELECT id, name, created_at FROM teachers ORDER BY name",
        conn,
    )
    conn.close()
    return df


def assign_teacher_to_class(class_id: int, teacher_id: int | None) -> None:
    conn = get_conn()
    conn.execute(
        "UPDATE classes SET teacher_id = ? WHERE id = ?", (teacher_id, class_id)
    )
    _commit(conn)
    conn.close()


# ═══════════════════════════════════════════════════════════════
# Class helpers
# ═══════════════════════════════════════════════════════════════


def add_class(name: str, description: str, teacher_id: int | None = None, schedule: str = "[]"):
    conn = get_conn()
    try:
        conn.execute(
            "INSERT INTO classes (name, description, teacher_id, schedule) VALUES (?, ?, ?, ?)",
            (name.strip(), description.strip(), teacher_id, schedule),
        )
        _commit(conn)
    finally:
        conn.close()


def delete_class(class_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM classes WHERE id = ?", (class_id,))
    _commit(conn)
    conn.close()


def get_all_classes(teacher_id: int | None = None) -> pd.DataFrame:
    """Return classes with teacher info; optionally filter to one teacher."""
    conn = get_conn()
    if teacher_id is None:
        df = pd.read_sql_query(
            """
            SELECT  c.id, c.name, c.description, c.teacher_id,
                    COALESCE(t.name, '—') AS teacher_name,
                    COALESCE(c.schedule, '[]') AS schedule
            FROM    classes c
            LEFT JOIN teachers t ON t.id = c.teacher_id
            ORDER BY c.name
            """,
            conn,
        )
    else:
        df = pd.read_sql_query(
            """
            SELECT  c.id, c.name, c.description, c.teacher_id,
                    COALESCE(t.name, '—') AS teacher_name,
                    COALESCE(c.schedule, '[]') AS schedule
            FROM    classes c
            LEFT JOIN teachers t ON t.id = c.teacher_id
            WHERE   c.teacher_id = ?
            ORDER BY c.name
            """,
            conn,
            params=(teacher_id,),
        )
    conn.close()
    return df


# ═══════════════════════════════════════════════════════════════
# Student helpers
# ═══════════════════════════════════════════════════════════════


def add_student(name: str, parent_phone: str, class_id: int | None):
    conn = get_conn()
    conn.execute(
        "INSERT INTO students (name, parent_phone, class_id, registered_at) VALUES (?, ?, ?, ?)",
        (
            name.strip(),
            parent_phone.strip(),
            class_id,
            datetime.now().strftime("%Y-%m-%d %H:%M"),
        ),
    )
    _commit(conn)
    conn.close()


def add_student_intake(
    *,
    name: str,
    registered_at: str,
    school: str,
    grade: str,
    pre_visit_progress: str,
    contact_info: str,
    student_phone: str = "",
    expectations: str,
    notes: str,
    class_id: int | None,
) -> None:
    """Register a new student from the dashboard intake form."""
    phone = contact_info.strip() or "—"
    reg_ts = (
        f"{registered_at.strip()} 00:00"
        if registered_at.strip()
        else datetime.now().strftime("%Y-%m-%d %H:%M")
    )
    conn = get_conn()
    conn.execute(
        """
        INSERT INTO students (
            name, parent_phone, class_id, registered_at,
            school, grade, pre_visit_progress, contact_info,
            expectations, notes, student_phone
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            name.strip(),
            phone,
            class_id,
            reg_ts,
            school.strip(),
            grade.strip(),
            pre_visit_progress.strip(),
            contact_info.strip(),
            expectations.strip(),
            notes.strip(),
            student_phone.strip(),
        ),
    )
    _commit(conn)
    conn.close()


def delete_student(student_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM students WHERE id = ?", (student_id,))
    _commit(conn)
    conn.close()


def assign_class(student_id: int, class_id: int | None):
    conn = get_conn()
    conn.execute(
        "UPDATE students SET class_id = ? WHERE id = ?", (class_id, student_id)
    )
    _commit(conn)
    conn.close()


def get_all_students(teacher_id: int | None = None) -> pd.DataFrame:
    """Return students with class info; if teacher_id is given, only
    students whose class is taught by that teacher."""
    conn = get_conn()
    if teacher_id is None:
        df = pd.read_sql_query(
            """
            SELECT s.id, s.name, s.parent_phone,
                   COALESCE(c.name, '—') AS class_name,
                   s.class_id, c.teacher_id,
                   COALESCE(t.name, '—') AS teacher_name,
                   s.registered_at
            FROM   students s
            LEFT JOIN classes  c ON c.id = s.class_id
            LEFT JOIN teachers t ON t.id = c.teacher_id
            ORDER  BY s.registered_at DESC
            """,
            conn,
        )
    else:
        df = pd.read_sql_query(
            """
            SELECT s.id, s.name, s.parent_phone,
                   COALESCE(c.name, '—') AS class_name,
                   s.class_id, c.teacher_id,
                   COALESCE(t.name, '—') AS teacher_name,
                   s.registered_at
            FROM   students s
            LEFT JOIN classes  c ON c.id = s.class_id
            LEFT JOIN teachers t ON t.id = c.teacher_id
            WHERE  c.teacher_id = ?
            ORDER  BY s.registered_at DESC
            """,
            conn,
            params=(teacher_id,),
        )
    conn.close()
    return df


def get_students_by_class(class_id: int) -> pd.DataFrame:
    conn = get_conn()
    df = pd.read_sql_query(
        "SELECT id, name, grade, school, parent_phone, COALESCE(student_phone,'') AS student_phone FROM students WHERE class_id = ? ORDER BY name",
        conn,
        params=(class_id,),
    )
    conn.close()
    return df


# ═══════════════════════════════════════════════════════════════
# Attendance helpers
# ═══════════════════════════════════════════════════════════════


def save_attendance(records: list[dict]):
    conn = get_conn()
    conn.executemany(
        """
        INSERT INTO attendance (student_id, class_id, session_date, status)
        VALUES (:student_id, :class_id, :session_date, :status)
        ON CONFLICT(student_id, session_date) DO UPDATE SET status=excluded.status
        """,
        records,
    )
    _commit(conn)
    conn.close()


def get_attendance_for_session(class_id: int, session_date: str) -> pd.DataFrame:
    conn = get_conn()
    df = pd.read_sql_query(
        """
        SELECT s.id AS student_id, s.name,
               COALESCE(a.status, 'absent') AS status
        FROM   students s
        LEFT JOIN attendance a ON a.student_id = s.id AND a.session_date = ?
        WHERE  s.class_id = ?
        ORDER  BY s.name
        """,
        conn,
        params=(session_date, class_id),
    )
    conn.close()
    return df


def get_attendance_history(
    class_id: int | None, from_date: str, to_date: str, teacher_id: int | None = None
) -> pd.DataFrame:
    conn = get_conn()
    q = """
        SELECT a.session_date, a.student_id, s.name AS student_name,
               COALESCE(c.name, '—') AS class_name, a.status
        FROM   attendance a
        JOIN   students s ON s.id = a.student_id
        LEFT JOIN classes c ON c.id = a.class_id
        WHERE  a.session_date BETWEEN ? AND ?
    """
    params: list = [from_date, to_date]
    if class_id is not None:
        q += " AND a.class_id = ?"
        params.append(class_id)
    if teacher_id is not None:
        q += " AND c.teacher_id = ?"
        params.append(teacher_id)
    q += " ORDER BY a.session_date DESC, s.name"
    df = pd.read_sql_query(q, conn, params=params)
    conn.close()
    return df


def get_attendance_summary(
    class_id: int | None, from_date: str, to_date: str, teacher_id: int | None = None
) -> pd.DataFrame:
    conn = get_conn()
    q = """
        SELECT s.name AS student_name,
               COALESCE(c.name, '—') AS class_name,
               COUNT(*) AS total_sessions,
               SUM(CASE WHEN a.status='present'THEN 1 ELSE 0 END) AS present,
               SUM(CASE WHEN a.status='late'    THEN 1 ELSE 0 END) AS late,
               SUM(CASE WHEN a.status='absent'  THEN 1 ELSE 0 END) AS absent
        FROM   attendance a
        JOIN   students s ON s.id = a.student_id
        LEFT JOIN classes c ON c.id = a.class_id
        WHERE  a.session_date BETWEEN ? AND ?
    """
    params: list = [from_date, to_date]
    if class_id is not None:
        q += " AND a.class_id = ?"
        params.append(class_id)
    if teacher_id is not None:
        q += " AND c.teacher_id = ?"
        params.append(teacher_id)
    q += " GROUP BY a.student_id ORDER BY student_name"
    df = pd.read_sql_query(q, conn, params=params)
    conn.close()
    if not df.empty:
        df["attendance_rate"] = (
            (df["present"] + df["late"]) / df["total_sessions"] * 100
        ).round(1).astype(str) + "%"
    return df


def _month_date_range(picked: date) -> tuple[str, str, str]:
    """Return (from_date, to_date, label) for the month containing ``picked``."""
    y, m = picked.year, picked.month
    last_day = monthrange(y, m)[1]
    from_str = f"{y:04d}-{m:02d}-01"
    to_str = f"{y:04d}-{m:02d}-{last_day:02d}"
    label = f"{y}년 {m}월"
    return from_str, to_str, label


def get_academy_notice(notice_type: str) -> tuple[str, str]:
    """Load weekly/monthly notice body and last-updated timestamp."""
    if notice_type not in ("weekly", "monthly"):
        raise ValueError(f"invalid notice_type: {notice_type!r}")
    conn = get_conn()
    row = conn.execute(
        "SELECT body, updated_at FROM academy_notices WHERE notice_type = ?",
        (notice_type,),
    ).fetchone()
    conn.close()
    if row is None:
        return "", ""
    return str(row[0] or ""), str(row[1] or "")


def save_academy_notice(notice_type: str, body: str) -> None:
    """Upsert weekly/monthly academy notice."""
    if notice_type not in ("weekly", "monthly"):
        raise ValueError(f"invalid notice_type: {notice_type!r}")
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    conn = get_conn()
    conn.execute(
        """
        INSERT INTO academy_notices (notice_type, body, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(notice_type) DO UPDATE SET
            body = excluded.body,
            updated_at = excluded.updated_at
        """,
        (notice_type, body or "", now),
    )
    _commit(conn)
    conn.close()


def generate_attendance_pdf_bytes(
    *,
    month_label: str,
    class_label: str,
    summary_df: pd.DataFrame,
    history_df: pd.DataFrame,
) -> tuple[bytes, str]:
    """Draft attendance ledger PDF (fpdf2 + NanumGothic)."""
    from fpdf import FPDF

    font_path = _ensure_korean_font()

    class _AttPDF(FPDF):
        def header(self):
            fam = "NanumGothic" if font_path else "Helvetica"
            self.set_font(fam, size=9)
            self.set_text_color(120, 120, 120)
            self.cell(
                0,
                6,
                _safe_pdf_text("압구정 페르마 수학 — 출석부"),
                align="C",
            )
            self.ln(4)

        def footer(self):
            self.set_y(-12)
            fam = "NanumGothic" if font_path else "Helvetica"
            self.set_font(fam, size=8)
            self.set_text_color(150, 150, 150)
            self.cell(0, 6, f"- {self.page_no()} -", align="C")

    pdf = _AttPDF()
    pdf.set_auto_page_break(auto=True, margin=16)
    if font_path:
        pdf.add_font("NanumGothic", fname=font_path)
    fam = "NanumGothic" if font_path else "Helvetica"
    pdf.add_page()
    pdf.set_font(fam, size=14)
    pdf.cell(
        0, 10, _safe_pdf_text(f"출석부 · {month_label}"), new_x="LMARGIN", new_y="NEXT"
    )
    pdf.set_font(fam, size=10)
    pdf.cell(
        0,
        8,
        _safe_pdf_text(f"수업 필터: {class_label}"),
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(4)

    pdf.set_font(fam, size=11)
    pdf.cell(0, 8, _safe_pdf_text("학생별 출석 통계"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(fam, size=9)
    if summary_df.empty:
        pdf.multi_cell(0, 6, _safe_pdf_text("해당 기간 출석 기록이 없습니다."))
    else:
        for _, row in summary_df.iterrows():
            line = (
                f"{row.get('student_name', '—')} | {row.get('class_name', '—')} | "
                f"출석 {row.get('present', 0)} · 지각 {row.get('late', 0)} · "
                f"결석 {row.get('absent', 0)} · {row.get('attendance_rate', '—')}"
            )
            pdf.multi_cell(0, 6, _safe_pdf_text(line))

    pdf.ln(4)
    pdf.set_font(fam, size=11)
    pdf.cell(0, 8, _safe_pdf_text("세션별 출석 로그"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(fam, size=9)
    if history_df.empty:
        pdf.multi_cell(0, 6, _safe_pdf_text("세션 로그가 없습니다."))
    else:
        for _, row in history_df.iterrows():
            line = (
                f"{row.get('session_date', '—')} | {row.get('student_name', '—')} | "
                f"{row.get('class_name', '—')} | {row.get('status', '—')}"
            )
            pdf.multi_cell(0, 6, _safe_pdf_text(line))

    fname = f"출석부_{month_label.replace(' ', '')}_{class_label.replace(' ', '_')}.pdf"
    return bytes(pdf.output()), fname


def save_tuition_status(
    student_id: int,
    month: str,
    status: str,
    amount: float = 0.0,
    paid_date: str | None = None,
    notes: str = "",
) -> None:
    """Upsert a tuition record for (student_id, month).

    month format: 'YYYY-MM'. status: 'paid'| 'pending'| 'overdue'.
    """
    if status not in ("paid", "pending", "overdue"):
        raise ValueError(f"invalid tuition status: {status!r}")
    conn = get_conn()
    conn.execute(
        """
        INSERT INTO tuition_payments
            (student_id, month, status, amount, paid_date, notes, updated_at)
        VALUES (:student_id, :month, :status, :amount, :paid_date, :notes, :updated_at)
        ON CONFLICT(student_id, month) DO UPDATE SET
            status     = excluded.status,
            amount     = excluded.amount,
            paid_date  = excluded.paid_date,
            notes      = excluded.notes,
            updated_at = excluded.updated_at
        """,
        {
            "student_id": student_id,
            "month": month,
            "status": status,
            "amount": float(amount or 0),
            "paid_date": paid_date,
            "notes": notes or "",
            "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        },
    )
    _commit(conn)
    conn.close()


def get_tuition_for_month(
    month: str, class_id: int | None = None, teacher_id: int | None = None
) -> pd.DataFrame:
    """Return one row per student for the given month (YYYY-MM).

    Students with no tuition record yet appear with status='pending'and amount=0.
    Optionally scope to a single class or to all classes taught by `teacher_id`.
    """
    conn = get_conn()
    q = """
        SELECT s.id AS student_id, s.name,
               COALESCE(c.name, '—') AS class_name,
               COALESCE(t.status, 'pending') AS status,
               COALESCE(t.amount, 0)         AS amount,
               t.paid_date,
               COALESCE(t.notes, '')         AS notes,
               t.updated_at
        FROM   students s
        LEFT   JOIN classes c ON c.id = s.class_id
        LEFT   JOIN tuition_payments t
               ON t.student_id = s.id AND t.month = ?
    """
    params: list = [month]
    conds: list[str] = []
    if class_id is not None:
        conds.append("s.class_id = ?")
        params.append(class_id)
    if teacher_id is not None:
        conds.append("c.teacher_id = ?")
        params.append(teacher_id)
    if conds:
        q += " WHERE " + " AND ".join(conds)
    q += " ORDER BY s.name"
    df = pd.read_sql_query(q, conn, params=params)
    conn.close()
    return df


def get_tuition_summary(month: str, teacher_id: int | None = None) -> dict:
    """Counts per status for a month, optionally scoped to a single teacher."""
    df = get_tuition_for_month(month, teacher_id=teacher_id)
    if df.empty:
        return {"paid": 0, "pending": 0, "overdue": 0, "total_amount": 0.0}
    return {
        "paid": int((df["status"] == "paid").sum()),
        "pending": int((df["status"] == "pending").sum()),
        "overdue": int((df["status"] == "overdue").sum()),
        "total_amount": float(df.loc[df["status"] == "paid", "amount"].sum()),
    }


def add_consultation_log(
    student_id: int, note: str, category: str = "general", author: str = ""
) -> None:
    """Insert a new consultation log entry for a student."""
    if category not in ("general", "progress", "parent", "behavior", "other"):
        raise ValueError(f"invalid consultation category: {category!r}")
    note = (note or "").strip()
    if not note:
        raise ValueError("note must not be empty")
    conn = get_conn()
    conn.execute(
        """INSERT INTO consultation_logs
           (student_id, category, note, author, created_at)
           VALUES (?, ?, ?, ?, ?)""",
        (
            student_id,
            category,
            note,
            (author or "").strip(),
            datetime.now().strftime("%Y-%m-%d %H:%M"),
        ),
    )
    _commit(conn)
    conn.close()


def get_consultation_logs_for_student(
    student_id: int,
    teacher_id: int | None = None,
) -> pd.DataFrame:
    """Return consultation logs for a student, newest first.

    When ``teacher_id`` is set, only returns rows if the student belongs to
    one of that teacher's classes (JOIN via ``students`` → ``classes``).
    """
    conn = get_conn()
    if teacher_id is None:
        sql = """
            SELECT id, category, note, author, created_at
            FROM consultation_logs
            WHERE student_id = ?
            ORDER BY created_at DESC, id DESC
        """
        params: tuple = (student_id,)
    else:
        sql = """
            SELECT cl.id, cl.category, cl.note, cl.author, cl.created_at
            FROM consultation_logs cl
            INNER JOIN students s ON s.id = cl.student_id
            INNER JOIN classes c ON c.id = s.class_id
            WHERE cl.student_id = ? AND c.teacher_id = ?
            ORDER BY cl.created_at DESC, cl.id DESC
        """
        params = (student_id, teacher_id)
    df = pd.read_sql_query(sql, conn, params=params)
    conn.close()
    return df


def delete_consultation_log(log_id: int) -> None:
    conn = get_conn()
    conn.execute("DELETE FROM consultation_logs WHERE id = ?", (log_id,))
    _commit(conn)
    conn.close()


# ═══════════════════════════════════════════════════════════════
# Shared Reports (persistent PDF hosting + KakaoTalk share)
# ═══════════════════════════════════════════════════════════════

# PDF reports live under data/reports/ (per the CSV-data convention).
# Streamlit can only serve real files from streamlit-app/static/ (it rejects
# symlinks with HTTP 400 for security), so we hardlink each generated PDF into
# STATIC_REPORTS_DIR — single inode, zero disk duplication, served correctly.
REPORTS_DIR = os.path.join(CSV_DIR, "reports")
STATIC_REPORTS_DIR = os.path.join(os.path.dirname(__file__), "static", "reports")
DEFAULT_KAKAO_MESSAGE = (
    "안녕하세요 압구정 페르마 수학입니다. "
    "학생의 오답 노트 리포트입니다. 확인 부탁드립니다."
)


def _public_base_url() -> str:
    """Return the externally-reachable base URL of this Streamlit app.

    - Deployed (`REPLIT_DEPLOYMENT=1`): use `https://<REPLIT_DOMAINS>` (port 443).
    - Dev workspace: Streamlit's port is exposed publicly at that port, so use
      `https://<REPLIT_DEV_DOMAIN>:<PORT>` (default 5000).
    """
    is_deployed = bool(os.environ.get("REPLIT_DEPLOYMENT"))
    if is_deployed:
        domains = os.environ.get("REPLIT_DOMAINS", "")
        if domains:
            host = domains.split(",")[0].strip().lstrip("https://").lstrip("http://")
            return f"https://{host}"
    dev = os.environ.get("REPLIT_DEV_DOMAIN", "").strip()
    if dev:
        port = os.environ.get("PORT", "5000").strip() or "5000"
        return f"https://{dev}:{port}"
    return ""


def _safe_slug(s: str, n: int = 24) -> str:
    s = _re_mod.sub(r"[^\w가-힣\-]+ ", "_", (s or "").strip(), flags=_re_mod.UNICODE)
    s = s.strip("_")
    return s[:n] or "report"


def _get_kakao_js_key() -> str:
    k = os.environ.get("KAKAO_JS_KEY", "")
    if k:
        return k
    try:
        return st.secrets.get("KAKAO_JS_KEY", "")  # type: ignore[union-attr]
    except Exception:
        return ""


def save_pdf_and_log(
    pdf_bytes: bytes, report_kind: str, student_name: str = "", exam_name: str = ""
) -> dict:
    """Persist a generated PDF to static/reports/ and log it in shared_reports.

    Returns: {id, filename, public_url, file_size}.

    The PDF is served via Streamlit's built-in static file route at
    `<base_url>/app/static/reports/<filename>`, giving a stable shareable URL
    while the app is running (and a permanent `.replit.app` URL once deployed).
    """
    if report_kind not in ("analysis", "errornote"):
        raise ValueError(f"invalid report_kind: {report_kind!r}")
    os.makedirs(REPORTS_DIR, exist_ok=True)
    os.makedirs(STATIC_REPORTS_DIR, exist_ok=True)
    token = _uuid_mod.uuid4().hex[:16]
    slug = _safe_slug(f"{report_kind}_{student_name or 'student'}")
    filename = f"{slug}_{token}.pdf"
    data_path = os.path.join(REPORTS_DIR, filename)
    static_path = os.path.join(STATIC_REPORTS_DIR, filename)
    with open(data_path, "wb") as fh:
        fh.write(pdf_bytes)
    # Hardlink into the static/ tree so Streamlit can serve the file directly.
    # Falls back to a copy if hardlinks aren't supported (e.g. cross-FS).
    try:
        if os.path.exists(static_path):
            os.remove(static_path)
        os.link(data_path, static_path)
    except OSError:
        import shutil as _shutil

        _shutil.copy2(data_path, static_path)

    base = _public_base_url()
    public_url = (
        f"{base}/app/static/reports/{filename}"
        if base
        else f"/app/static/reports/{filename}"
    )

    conn = get_conn()
    cur = conn.execute(
        """INSERT INTO shared_reports
           (report_kind, student_name, exam_name, filename, public_url, file_size, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id""",
        (
            report_kind,
            student_name or "",
            exam_name or "",
            filename,
            public_url,
            len(pdf_bytes),
            datetime.now().strftime("%Y-%m-%d %H:%M"),
        ),
    )
    rid = cur.fetchone()[0]
    _commit(conn)
    conn.close()
    return {
        "id": rid,
        "filename": filename,
        "public_url": public_url,
        "file_size": len(pdf_bytes),
    }


def render_share_panel(
    public_url: str,
    student_name: str = "",
    report_label: str = "리포트",
    message: str = DEFAULT_KAKAO_MESSAGE,
    key_suffix: str = "default",
) -> None:
    """Render an inline panel with: link box, copy button, KakaoTalk share button.

    The Kakao Share button uses the official Kakao JavaScript SDK
    (`Kakao.Share.sendDefault`, web-based flow that works on PC + Mobile).
    If `KAKAO_JS_KEY` is not configured, the button shows a clear setup notice
    instead of failing silently.
    """
    kakao_key = _get_kakao_js_key()
    full_message = f"{message}\n\n{public_url}"
    sfx = _re_mod.sub(r"\W+ ", "_", key_suffix) or "panel"

    # HTML-escape anything that gets interpolated into raw HTML below.
    # Student name (and therefore message/label) is user-controlled.
    esc_url = _html_mod.escape(public_url, quote=True)
    esc_msg = _html_mod.escape(full_message, quote=True)

    js_url = json.dumps(public_url)
    js_msg = json.dumps(full_message)
    js_stud = json.dumps(student_name or "학생")
    js_label = json.dumps(report_label)
    js_key = json.dumps(kakao_key)

    if kakao_key:
        kakao_status_html = (
            '<div style="font-size:12px;color:#16a34a;margin-top:6px;">'
            "카카오톡 공유 사용 가능</div>"
        )
    else:
        kakao_status_html = (
            '<div style="font-size:12px;color:#d97706;margin-top:6px;">'
            "<code>KAKAO_JS_KEY</code> 환경변수가 설정되어 있지 않습니다. "
            "Kakao Developers(developers.kakao.com)에서 발급받은 "
            "JavaScript 키를 환경변수로 추가하면 카카오톡 공유가 활성화됩니다.</div>"
        )

    html = f"""
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">공유 가능한 영구 링크</div>
  <div id="urlbox_{sfx}" style="background:#f3f4f6;padding:10px 12px;border-radius:6px;
       font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;
       word-break:break-all;border:1px solid #e5e7eb;color:#111827;">{esc_url}</div>

  <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
    <button id="copy_{sfx}" type="button"
      style="background:#2563eb;color:#fff;border:none;padding:8px 14px;
             border-radius:6px;font-weight:600;font-size:13px;cursor:pointer;">
      링크 복사
    </button>
    <button id="kakao_{sfx}" type="button"
      style="background:#FEE500;color:#3C1E1E;border:none;padding:8px 14px;
             border-radius:6px;font-weight:600;font-size:13px;cursor:pointer;
             display:inline-flex;align-items:center;gap:6px;">
      카카오톡으로 공유
    </button>
    <a href="{esc_url}" rel="noopener"
       style="background:#fff;color:#111827;border:1px solid #d1d5db;padding:8px 14px;
              border-radius:6px;font-weight:600;font-size:13px;text-decoration:none;
              display:inline-flex;align-items:center;">
      새 탭에서 PDF 열기
    </a>
  </div>

  <div id="status_{sfx}" style="margin-top:8px;font-size:13px;min-height:18px;"></div>
  {kakao_status_html}

  <details style="margin-top:8px;">
    <summary style="cursor:pointer;font-size:12px;color:#6b7280;">미리 작성된 메시지 보기</summary>
    <pre id="msg_{sfx}" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;
        padding:10px;font-size:12.5px;white-space:pre-wrap;word-break:break-all;
        margin-top:6px;">{esc_msg}</pre>
    <button id="copymsg_{sfx}" type="button"
      style="background:#fff;color:#111827;border:1px solid #d1d5db;padding:6px 10px;
             border-radius:6px;font-size:12px;cursor:pointer;margin-top:6px;">
      메시지 + 링크 복사
    </button>
  </details>
</div>

<script src="https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js"
  integrity="sha384-TiCUE00h649CAMonG018J2ujOgDKW/kVWlChEuu4jK2vxfAAD0eZxzCKakxg55G4"
  crossorigin="anonymous"></script>
<script>
(function() {{
  const URL_ = {js_url};
  const MSG  = {js_msg};
  const STUD = {js_stud};
  const LBL  = {js_label};
  const KEY  = {js_key};
  const STATUS = document.getElementById('status_{sfx}');

  function flash(msg, color) {{
    STATUS.textContent = msg;
    STATUS.style.color = color || '#16a34a';
    setTimeout(() => {{ STATUS.textContent = ''; }}, 3000);
  }}

  async function copyText(text) {{
    try {{
      await navigator.clipboard.writeText(text);
      return true;
    }} catch (e) {{
      try {{
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta);
        ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
        return true;
      }} catch (_) {{ return false; }}
    }}
  }}

  document.getElementById('copy_{sfx}').addEventListener('click', async () => {{
    const ok = await copyText(URL_);
    flash(ok ? '링크가 복사되었습니다.': '복사 실패. 직접 선택해서 복사해 주세요.',
          ok ? '#16a34a': '#dc2626');
  }});

  document.getElementById('copymsg_{sfx}').addEventListener('click', async () => {{
    const ok = await copyText(MSG);
    flash(ok ? '메시지가 복사되었습니다.': '복사 실패.',
          ok ? '#16a34a': '#dc2626');
  }});

  document.getElementById('kakao_{sfx}').addEventListener('click', () => {{
    if (!KEY) {{
      flash('KAKAO_JS_KEY가 설정되어 있지 않아 공유를 시작할 수 없습니다. 위의 안내를 참고해 주세요.', '#d97706');
      return;
    }}
    if (typeof Kakao === 'undefined') {{
      flash('카카오 SDK 로드 실패. 네트워크를 확인해 주세요.', '#dc2626');
      return;
    }}
    try {{
      if (!Kakao.isInitialized()) Kakao.init(KEY);
      Kakao.Share.sendDefault({{
        objectType: 'feed',
        content: {{
          title: '압구정 페르마 수학 — '+ STUD + ' '+ LBL,
          description: MSG,
          imageUrl: 'https://placehold.co/600x400/2563eb/ffffff?text='+ encodeURIComponent('압구정 페르마 수학'),
          link: {{ mobileWebUrl: URL_, webUrl: URL_ }}
        }},
        buttons: [{{
          title: '리포트 PDF 열기',
          link: {{ mobileWebUrl: URL_, webUrl: URL_ }}
        }}]
      }});
    }} catch (err) {{
      flash('공유 오류: '+ (err && err.message ? err.message : err), '#dc2626');
    }}
  }});
}})();
</script>
"""
    components.html(html, height=360, scrolling=False)


def get_session_dates_for_class(class_id: int) -> list[str]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT DISTINCT session_date FROM attendance WHERE class_id = ? ORDER BY session_date DESC",
        (class_id,),
    ).fetchall()
    conn.close()
    return [r[0] for r in rows]


# ═══════════════════════════════════════════════════════════════
# Exam helpers
# ═══════════════════════════════════════════════════════════════


def create_exam(
    name: str, exam_date: str, class_id: int | None, description: str
) -> int:
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO exams (name, exam_date, class_id, description) VALUES (?, ?, ?, ?) RETURNING id",
        (name.strip(), exam_date, class_id, description.strip()),
    )
    exam_id = cur.fetchone()[0]
    _commit(conn)
    conn.close()
    return exam_id


def delete_exam(exam_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM exams WHERE id = ?", (exam_id,))
    _commit(conn)
    conn.close()


def add_topic(exam_id: int, name: str, max_score: float):
    conn = get_conn()
    conn.execute(
        "INSERT INTO exam_topics (exam_id, name, max_score) VALUES (?, ?, ?)",
        (exam_id, name.strip(), max_score),
    )
    _commit(conn)
    conn.close()


def delete_topic(topic_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM exam_topics WHERE id = ?", (topic_id,))
    _commit(conn)
    conn.close()


def get_all_exams(teacher_id: int | None = None) -> pd.DataFrame:
    conn = get_conn()
    sql = """
        SELECT e.id, e.name, e.exam_date, e.description,
               COALESCE(c.name, '— All —') AS class_name,
               e.class_id
        FROM   exams e
        LEFT JOIN classes c ON c.id = e.class_id
    """
    params: tuple = ()
    if teacher_id is not None:
        sql += " WHERE c.teacher_id = ?"
        params = (teacher_id,)
    sql += " ORDER BY e.exam_date DESC"
    df = pd.read_sql_query(sql, conn, params=params or None)
    conn.close()
    return df


def get_topics_for_exam(exam_id: int) -> pd.DataFrame:
    conn = get_conn()
    df = pd.read_sql_query(
        "SELECT id, name, max_score FROM exam_topics WHERE exam_id = ? ORDER BY id",
        conn,
        params=(exam_id,),
    )
    conn.close()
    return df


def save_scores(records: list[dict]):
    """records: [{student_id, exam_id, topic_id, score}]"""
    conn = get_conn()
    conn.executemany(
        """
        INSERT INTO student_scores (student_id, exam_id, topic_id, score)
        VALUES (:student_id, :exam_id, :topic_id, :score)
        ON CONFLICT(student_id, topic_id) DO UPDATE SET score=excluded.score
        """,
        records,
    )
    _commit(conn)
    conn.close()


def get_scores_for_exam(exam_id: int) -> pd.DataFrame:
    """Returns a flat table: student_name, topic_name, max_score, score, pct."""
    conn = get_conn()
    df = pd.read_sql_query(
        """
        SELECT s.id AS student_id, s.name AS student_name,
               t.id AS topic_id, t.name AS topic_name, t.max_score,
               COALESCE(sc.score, NULL) AS score
        FROM   students s
        JOIN   exams e ON e.id = ?
        JOIN   exam_topics t ON t.exam_id = e.id
        LEFT JOIN student_scores sc
               ON sc.student_id = s.id AND sc.topic_id = t.id
        WHERE  (e.class_id IS NULL OR s.class_id = e.class_id)
        ORDER  BY s.name, t.id
        """,
        conn,
        params=(exam_id,),
    )
    conn.close()
    if not df.empty and "score" in df.columns:
        df["pct"] = (df["score"] / df["max_score"] * 100).round(1)
    return df


def score_label(pct: float | None) -> str:
    if pct is None:
        return "—"
    if pct >= 80:
        return "Excellent"
    if pct >= 60:
        return "Good"
    return "Needs Work"


# ═══════════════════════════════════════════════════════════════
# Student performance persistence & grading
# ═══════════════════════════════════════════════════════════════


def compute_grade(pct: float) -> str:
    """Map a percentage score to an A–E letter grade."""
    if pct >= 90:
        return "A"
    if pct >= 80:
        return "B"
    if pct >= 70:
        return "C"
    if pct >= 60:
        return "D"
    return "E"


GRADE_EMOJI = {"A": "", "B": "", "C": "", "D": "", "E": ""}
GRADE_LABEL = {
    "A": "매우 우수",
    "B": "우수",
    "C": "보통",
    "D": "미흡",
    "E": "노력 필요",
}


def save_ai_result(
    student_id: int, exam_name: str, overall_pct: float, grade: str, analysis_json: str
) -> None:
    conn = get_conn()
    conn.execute(
        """INSERT INTO ai_exam_results
           (student_id, exam_name, exam_date, overall_pct, grade, analysis_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            student_id,
            exam_name,
            date.today().strftime("%Y-%m-%d"),
            overall_pct,
            grade,
            analysis_json,
            datetime.now().strftime("%Y-%m-%d %H:%M"),
        ),
    )
    _commit(conn)
    conn.close()


def get_student_ai_history(student_id: int) -> pd.DataFrame:
    conn = get_conn()
    df = pd.read_sql_query(
        """SELECT id, exam_name, exam_date, overall_pct, grade, analysis_json, created_at
           FROM ai_exam_results
           WHERE student_id = ?
           ORDER BY exam_date ASC, created_at ASC""",
        conn,
        params=(student_id,),
    )
    conn.close()
    return df


def get_all_ai_history(teacher_id: int | None = None) -> pd.DataFrame:
    conn = get_conn()
    sql = """SELECT r.id, s.name AS student_name, r.exam_name, r.exam_date,
                  r.overall_pct, r.grade, r.created_at
           FROM ai_exam_results r
           JOIN students s ON s.id = r.student_id
           LEFT JOIN classes c ON c.id = s.class_id
           WHERE 1 = 1"""
    params: list = []
    if teacher_id is not None:
        sql += " AND c.teacher_id = ?"
        params.append(teacher_id)
    sql += " ORDER BY r.exam_date DESC, r.created_at DESC"
    df = pd.read_sql_query(sql, conn, params=params or None)
    conn.close()
    return df


def delete_ai_result(result_id: int) -> None:
    conn = get_conn()
    conn.execute("DELETE FROM ai_exam_results WHERE id = ?", (result_id,))
    _commit(conn)
    conn.close()


def compute_student_topic_mastery(student_id: int) -> pd.DataFrame:
    """Aggregate a student's mastery per topic across all AI exam results.

    Reads every analysis_json in ai_exam_results for the given student,
    pulls each entry's `estimated_scores[].{topic, estimated_pct}`, and
    returns a DataFrame with one row per topic:
        topic | avg_pct | latest_pct | exam_count | latest_date
    Sorted by avg_pct ascending so the weakest topics appear first.
    Returns an empty DataFrame if the student has no AI history.
    """
    hist = get_student_ai_history(student_id)
    if hist.empty:
        return pd.DataFrame(
            columns=["topic", "avg_pct", "latest_pct", "exam_count", "latest_date"]
        )

    # Build flat records: each (exam_date, topic, pct)
    records: list[dict] = []
    for _, row in hist.iterrows():
        try:
            data = json.loads(row["analysis_json"])
        except Exception:
            continue
        for ts in data.get("estimated_scores", []) or []:
            topic = str(ts.get("topic", "")).strip()
            if not topic:
                continue
            try:
                pct = float(ts.get("estimated_pct", 0))
            except (TypeError, ValueError):
                continue
            records.append(
                {
                    "topic": topic,
                    "pct": pct,
                    "exam_date": row["exam_date"],
                }
            )

    if not records:
        return pd.DataFrame(
            columns=["topic", "avg_pct", "latest_pct", "exam_count", "latest_date"]
        )

    df = pd.DataFrame(records)
    # Latest entry per topic: sort by date desc, drop duplicates keeping first
    latest = (
        df.sort_values("exam_date", ascending=False)
        .drop_duplicates(subset=["topic"], keep="first")
        .rename(columns={"pct": "latest_pct", "exam_date": "latest_date"})
    )
    agg = (
        df.groupby("topic")
        .agg(avg_pct=("pct", "mean"), exam_count=("pct", "count"))
        .reset_index()
    )
    out = agg.merge(
        latest[["topic", "latest_pct", "latest_date"]], on="topic", how="left"
    )
    out["avg_pct"] = out["avg_pct"].round(1)
    out = out.sort_values("avg_pct", ascending=True).reset_index(drop=True)
    return out


# ═══════════════════════════════════════════════════════════════
# Korean font & chart helpers for PDF generation
# ═══════════════════════════════════════════════════════════════

_FONT_CACHE: str | None = None


_ERROR_LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "error.log")


def _trace(tag: str, msg: str = "") -> None:
    line = f"[pdf-trace] {tag} {msg}".rstrip()
    print(line, flush=True)
    try:
        from datetime import datetime as _dt

        with open(_ERROR_LOG_PATH, "a", encoding="utf-8") as _fh:
            _fh.write(f"{_dt.now().isoformat(timespec='seconds')}  {line}\n")
    except Exception:
        pass


# Map math / typographic symbols that NanumGothic does not contain to
# ASCII equivalents so they render legibly instead of being dropped.
_SYMBOL_REPLACEMENTS = {
    "\u221a": "sqrt",  # √
    "\u221e": "inf",  # ∞
    "\u2264": "<=",  # ≤
    "\u2265": ">=",  # ≥
    "\u2260": "!=",  # ≠
    "\u2248": "~=",  # ≈
    "\u00b1": "+/-",  # ±
    "\u00d7": "x",  # ×
    "\u00f7": "/",  # ÷
    "\u03c0": "pi",  # π
    "\u00b0": "deg",  # °
    "\u00b2": "^2",  # ²
    "\u00b3": "^3",  # ³
    "\u2192": "->",  # →
    "\u2190": "<-",  # ←
    "\u2194": "<->",  # ↔
    "\u2206": "delta",  # ∆
    "\u0394": "Delta",  # Δ
    "\u03b1": "alpha",
    "\u03b2": "beta",
    "\u03b3": "gamma",
    "\u03b8": "theta",
    "\u03bb": "lambda",
    "\u03bc": "mu",
    "\u03c3": "sigma",
    "\u03c6": "phi",
    "\u03c9": "omega",
    "\u2211": "Sum",  # ∑
    "\u220f": "Prod",  # ∏
    "\u222b": "Int",  # ∫
    "\u2202": "d",  # ∂
    "\u2207": "grad",  # ∇
    "\u00b7": "*",  # ·
    "\u2022": "*",  # •
}

_FONT_CMAP_CACHE: set[int] | None = None


def _get_font_cmap() -> set[int]:
    """Return the set of Unicode codepoints supported by NanumGothic.

    Cached. Returns empty set on failure (sanitizer then becomes a no-op
    for cmap filtering and only the explicit replacement table applies).
    """
    global _FONT_CMAP_CACHE
    if _FONT_CMAP_CACHE is not None:
        return _FONT_CMAP_CACHE
    try:
        from fontTools.ttLib import TTFont  # fpdf2 already depends on this

        font_path = _ensure_korean_font()
        if not font_path:
            _FONT_CMAP_CACHE = set()
            return _FONT_CMAP_CACHE
        tt = TTFont(font_path, lazy=True)
        cps: set[int] = set()
        for table in tt["cmap"].tables:
            cps.update(table.cmap.keys())
        tt.close()
        _FONT_CMAP_CACHE = cps
        _trace("font", f"cmap loaded, {len(cps)} codepoints")
        return cps
    except Exception as e:
        _trace("font", f"cmap load FAILED: {e!r}")
        _FONT_CMAP_CACHE = set()
        return _FONT_CMAP_CACHE


def _safe_pdf_text(s: object, max_len: int = 1500) -> str:
    """Defensive sanitizer for any string written to fpdf2 multi_cell/cell.

    Steps:
      1. NFC normalize.
      2. Strip control/format/separator chars that can lock fpdf2's wrapper.
      3. Replace known math/typographic symbols missing from NanumGothic
         with ASCII equivalents (sqrt, <=, etc).
      4. Drop any remaining codepoint not present in the font's cmap
         (replaced with '?'). This is THE critical step that prevents the
         multi_cell infinite-loop on chars like U+221A (√).
      5. Collapse whitespace, force-break long unbroken runs.
    """
    import unicodedata

    if s is None:
        return "—"
    txt = unicodedata.normalize("NFC", str(s))
    # 1. strip control / format / surrogate / private / unassigned / separators
    txt = "".join(
        ch
        for ch in txt
        if unicodedata.category(ch)[0] != "C"
        and unicodedata.category(ch) not in ("Zl", "Zp")
    )
    # 2. explicit symbol substitution
    txt = "".join(_SYMBOL_REPLACEMENTS.get(ch, ch) for ch in txt)
    # 3. drop codepoints not in NanumGothic's cmap (the real fix for U+221A et al)
    cmap = _get_font_cmap()
    if cmap:
        txt = "".join(
            ch if (ord(ch) in cmap or ch in (" ", "\n", "\t")) else "?" for ch in txt
        )
    # 4. normalize whitespace per line
    out_parts = []
    for line in txt.split("\n"):
        out_parts.append(" ".join(line.split()))
    txt = "\n".join(out_parts).strip()
    if not txt:
        return "—"
    if len(txt) > max_len:
        txt = txt[:max_len] + "..."
    # 5. force a break every 40 chars on lines with no spaces
    safe_lines = []
    for line in txt.split("\n"):
        if " " not in line and len(line) > 40:
            chunked = " ".join(line[i : i + 40] for i in range(0, len(line), 40))
            safe_lines.append(chunked)
        else:
            safe_lines.append(line)
    return "\n".join(safe_lines)


def _ensure_korean_font() -> str | None:
    global _FONT_CACHE
    if _FONT_CACHE and os.path.exists(_FONT_CACHE):
        _trace("font", f"cache hit -> {_FONT_CACHE}")
        return _FONT_CACHE
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(here, "NanumGothic.ttf"),
        os.path.abspath("streamlit-app/NanumGothic.ttf"),
        os.path.abspath("NanumGothic.ttf"),
    ]
    for fp in candidates:
        if os.path.exists(fp):
            _FONT_CACHE = fp
            _trace("font", f"resolved on disk -> {fp}")
            return fp
    target = os.path.join(here, "NanumGothic.ttf")
    try:
        import urllib.request

        url = "https://github.com/google/fonts/raw/main/ofl/nanumgothic/NanumGothic-Regular.ttf"
        _trace("font", f"downloading from {url} -> {target}")
        urllib.request.urlretrieve(url, target)
        _FONT_CACHE = target
        _trace("font", f"download ok -> {target}")
        return target
    except Exception as e:
        _trace("font", f"download FAILED: {e!r}")
        return None


def _history_chart_png(history_df: pd.DataFrame, student_name: str) -> bytes:
    """Render a historical score line chart as PNG bytes (for embedding in PDF)."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    labels = [f"{r['exam_name']}\n{r['exam_date']}" for _, r in history_df.iterrows()]
    scores = history_df["overall_pct"].tolist()
    grades = history_df["grade"].tolist()

    fig, ax = plt.subplots(figsize=(7, 3.2))
    ax.plot(
        range(len(scores)),
        scores,
        marker="o",
        linewidth=2.2,
        color="#3498db",
        markersize=9,
        markerfacecolor="white",
        markeredgewidth=2,
    )
    for i, (sc, gr) in enumerate(zip(scores, grades)):
        ax.annotate(
            f"{sc:.0f}%\n({gr})",
            (i, sc),
            textcoords="offset points",
            xytext=(0, 12),
            ha="center",
            fontsize=9,
            color="#2c3e50",
        )
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, fontsize=8, ha="center")
    ax.set_ylim(0, 115)
    ax.set_ylabel("점수 (%)", fontsize=9)
    ax.set_title(f"{student_name} — 누적 성취도 추이", fontsize=11, pad=10)
    ax.axhline(90, color="#2ecc71", linestyle="--", alpha=0.5, linewidth=1)
    ax.axhline(60, color="#e74c3c", linestyle="--", alpha=0.5, linewidth=1)
    ax.fill_between(range(len(scores)), scores, alpha=0.08, color="#3498db")
    ax.grid(axis="y", alpha=0.3)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.tight_layout()

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130)
    plt.close(fig)
    buf.seek(0)
    return buf.read()


def _topic_bar_chart_png(est_scores: list[dict], student_name: str) -> bytes:
    """Render a per-topic horizontal bar chart as PNG bytes."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    topics = [ts.get("topic", "—") for ts in est_scores]
    pcts = [ts.get("estimated_pct", 0) for ts in est_scores]
    colors = [
        "#2ecc71" if p >= 80 else ("#f1c40f" if p >= 60 else "#e74c3c") for p in pcts
    ]

    fig, ax = plt.subplots(figsize=(6, max(2.5, len(topics) * 0.55)))
    bars = ax.barh(topics, pcts, color=colors, height=0.6)
    for bar, pct in zip(bars, pcts):
        ax.text(
            pct + 1,
            bar.get_y() + bar.get_height() / 2,
            f"{pct:.0f}%",
            va="center",
            fontsize=9,
        )
    ax.set_xlim(0, 115)
    ax.set_xlabel("성취도 (%)", fontsize=9)
    ax.set_title(f"{student_name} — 단원별 성취도", fontsize=10)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="x", alpha=0.3)
    fig.tight_layout()

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130)
    plt.close(fig)
    buf.seek(0)
    return buf.read()


# ═══════════════════════════════════════════════════════════════
# PDF report generation
# ═══════════════════════════════════════════════════════════════


def generate_report_pdf(
    result: dict,
    student_name: str,
    exam_name: str = "",
    include_history: bool = False,
    history_df: "pd.DataFrame | None" = None,
) -> bytes:
    _trace(
        "report",
        f"ENTER student={student_name!r} exam={exam_name!r} "
        f"include_history={include_history} "
        f"history_rows={(0 if history_df is None else len(history_df))}",
    )
    from fpdf import FPDF

    _trace("report", "fpdf imported")

    font_path = _ensure_korean_font()
    _trace("report", f"font_path={font_path!r}")
    overall = result.get("overall_estimated_pct", 0)
    grade = compute_grade(overall)
    _trace("report", f"overall={overall} grade={grade}")

    class _PDF(FPDF):
        def header(self):
            fam = "NanumGothic" if font_path else "Helvetica"
            self.set_font(fam, size=8)
            self.set_text_color(140, 140, 140)
            self.cell(0, 6, "압구정 페르마 수학 — 수학 성적 분석 리포트", align="C")
            self.ln(3)

        def footer(self):
            self.set_y(-12)
            fam = "NanumGothic" if font_path else "Helvetica"
            self.set_font(fam, size=8)
            self.set_text_color(150, 150, 150)
            self.cell(0, 6, f"- {self.page_no()} -", align="C")

        def multi_cell(self, w, h=None, text="", *args, **kwargs):
            # Force safe cursor reset so a subsequent call always has full width.
            kwargs.setdefault("new_x", "LMARGIN")
            kwargs.setdefault("new_y", "NEXT")
            return super().multi_cell(w, h, _safe_pdf_text(text), *args, **kwargs)

    _trace("report", "instantiating _PDF")
    pdf = _PDF()
    pdf.set_auto_page_break(auto=True, margin=16)
    if font_path:
        _trace("report", "adding NanumGothic font")
        pdf.add_font("NanumGothic", fname=font_path)
    pdf.add_page()
    _trace("report", "first page added")

    def _f(size: int = 10):
        pdf.set_font("NanumGothic" if font_path else "Helvetica", size=size)
        pdf.set_text_color(30, 30, 30)

    def _section(title: str):
        _f(12)
        pdf.set_fill_color(234, 240, 255)
        pdf.cell(0, 8, title, fill=True, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1)
        _f(10)

    # ── Title ──
    _f(17)
    pdf.cell(0, 11, "수학 성적 분석 리포트", align="C", new_x="LMARGIN", new_y="NEXT")
    _f(10)
    pdf.multi_cell(
        0,
        7,
        f"학생명: {student_name}    시험명: {exam_name or '—'}    분석일: {date.today()}",
        align="C",
        wrapmode="CHAR",
    )
    pdf.ln(5)

    # ── Grade banner ──
    pdf.set_fill_color(240, 248, 255)
    pdf.set_draw_color(170, 190, 220)
    _f(14)
    g_label = GRADE_LABEL.get(grade, "")
    pdf.cell(
        0,
        13,
        f"예상 점수: {overall}%    등급: {grade} ({g_label})",
        border=1,
        align="C",
        fill=True,
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(6)

    _trace("report", "wrote title + grade banner")
    detected = result.get("topics_detected", [])
    if detected:
        _f(9)
        pdf.set_text_color(100, 100, 100)
        pdf.multi_cell(0, 5, f"감지된 단원: {', '.join(detected)}", wrapmode="CHAR")
        pdf.set_text_color(30, 30, 30)
        pdf.ln(3)

    # ── Questions table ──
    questions = result.get("questions", [])
    _trace("report", f"questions count={len(questions)}")
    if questions:
        _section("문항별 채점 결과")
        RESULT_KO = {"Correct": "맞음", "Partial": "부분정답", "Incorrect": "틀림"}
        pdf.set_draw_color(210, 210, 210)
        for q in questions:
            r = q.get("result", "")
            symbol = "O" if r == "Correct" else ("△" if r == "Partial" else "X")
            r_ko = RESULT_KO.get(r, r)
            line = (
                f"문항 {q.get('number','?')}  [{q.get('topic','—')} / "
                f"{q.get('difficulty','?')}]  →  {symbol} {r_ko}  "
                f"   학생 답안: {q.get('student_answer','—')}"
            )
            pdf.multi_cell(0, 6, line, border="B", wrapmode="CHAR")
            if q.get("ai_comment"):
                pdf.set_text_color(70, 70, 120)
                pdf.multi_cell(0, 5, f"  ▶ {q['ai_comment']}", wrapmode="CHAR")
                pdf.set_text_color(30, 30, 30)
        pdf.ln(4)

    # ── Topic scores chart ──
    est_scores = result.get("estimated_scores", [])
    _trace("report", f"estimated_scores count={len(est_scores)}")
    if est_scores:
        _section("단원별 성취도")
        for ts in est_scores:
            pct = ts.get("estimated_pct", 0)
            obs = ts.get("observation", "")
            _f(9)
            pdf.multi_cell(
                0, 6, f"{ts.get('topic','—')}:  {pct}%  — {obs}", wrapmode="CHAR"
            )
        pdf.ln(2)
        # embed bar chart
        try:
            _trace("report", "rendering topic bar chart")
            bar_png = _topic_bar_chart_png(est_scores, student_name)
            with io.BytesIO(bar_png) as ibuf:
                pdf.image(ibuf, x=20, w=165)
            _trace("report", "topic bar chart embedded")
        except Exception as e:
            _trace("report", f"topic bar chart FAILED (suppressed): {e!r}")
        pdf.ln(3)

    # ── Topic-based analysis ──
    _trace("report", "writing per-topic analysis")
    _section("단원 유형별 분석")
    topic_map: dict[str, list] = {}
    for q in questions:
        topic_map.setdefault(q.get("topic", "기타"), []).append(q)
    for topic, qs in topic_map.items():
        c_cnt = sum(1 for q in qs if q.get("result") == "Correct")
        p_cnt = sum(1 for q in qs if q.get("result") == "Partial")
        i_cnt = sum(1 for q in qs if q.get("result") == "Incorrect")
        status = (
            "강점" if c_cnt >= len(qs) * 0.7 else ("집중 필요" if i_cnt > 0 else "보통")
        )
        _f(9)
        pdf.multi_cell(
            0,
            6,
            f"{topic}: 정답 {c_cnt}개 / 부분 {p_cnt}개 / 오답 {i_cnt}개  → [{status}]",
            wrapmode="CHAR",
        )
    pdf.ln(3)

    # ── Strengths & improvements ──
    strengths = result.get("strengths", [])
    improvements = result.get("improvement_areas", [])
    _trace("report", f"strengths={len(strengths)} improvements={len(improvements)}")
    if strengths or improvements:
        _section("잘한 점 / 보완 필요 사항")
        if strengths:
            _f(9)
            pdf.cell(0, 6, "잘한 점:", new_x="LMARGIN", new_y="NEXT")
            for s in strengths:
                pdf.multi_cell(0, 5, f"  • {s}", wrapmode="CHAR")
        if improvements:
            pdf.ln(2)
            _f(9)
            pdf.cell(0, 6, "보완이 필요한 점:", new_x="LMARGIN", new_y="NEXT")
            for a in improvements:
                pdf.multi_cell(0, 5, f"  • {a}", wrapmode="CHAR")
        pdf.ln(3)

    # ── Teacher notes ──
    notes = result.get("teacher_notes", "")
    _trace("report", f"teacher_notes len={len(notes)}")
    if notes:
        _section("교사 총평")
        _f(9)
        pdf.set_fill_color(248, 249, 255)
        pdf.multi_cell(0, 6, notes, fill=True, wrapmode="CHAR")
        pdf.ln(3)

    # ── Suggested practice ──
    practice = result.get("suggested_practice", [])
    _trace("report", f"suggested_practice count={len(practice)}")
    if practice:
        _section("추천 연습 문제")
        _f(9)
        for i, p in enumerate(practice, 1):
            pdf.multi_cell(0, 6, f"{i}. {p}", wrapmode="CHAR")
        pdf.ln(3)

    # ── History chart ──
    if include_history and history_df is not None and not history_df.empty:
        _trace("report", f"adding history page (rows={len(history_df)})")
        pdf.add_page()
        _section("누적 성취도 그래프")
        try:
            hist_png = _history_chart_png(history_df, student_name)
            with io.BytesIO(hist_png) as ibuf:
                pdf.image(ibuf, x=15, w=178)
            _trace("report", "history chart embedded")
        except Exception as e:
            _trace("report", f"history chart FAILED (suppressed): {e!r}")
            _f(9)
            pdf.multi_cell(0, 6, "차트 생성 중 오류가 발생했습니다.", wrapmode="CHAR")
        pdf.ln(5)
        _section("시험 이력 요약")
        _f(9)
        for _, row in history_df.iterrows():
            pdf.multi_cell(
                0,
                6,
                f"{row['exam_date']}  {row['exam_name']}:  "
                f"{row['overall_pct']:.0f}%  ({row['grade']})",
                wrapmode="CHAR",
            )

    _trace("report", "calling pdf.output()")
    out = bytes(pdf.output())
    _trace("report", f"DONE, size={len(out)} bytes")
    return out


# ═══════════════════════════════════════════════════════════════
# Similar questions & Error Note PDF
# ═══════════════════════════════════════════════════════════════

_SIMILAR_QS_PROMPT = """\
당신은 수학 선생님입니다. 아래는 학생이 틀린 수학 문제 목록입니다.
각 문제에 대해 유사한 연습문제를 {count}개씩 생성하세요.
아래 JSON 형식으로만 반환하세요 (순수 JSON, 마크다운 금지):

[
  {{
    "original_topic": "단원명",
    "original_info": "문제 설명 또는 학생 오답 내용 요약",
    "similar_problems": [
      {{"problem": "유사문제 전체 내용 (수학 기호 포함)", "answer": "정답 또는 핵심 풀이 힌트"}}
    ]
  }}
]

틀린 문항 목록:
{wrong_list}"""


def generate_similar_questions(
    wrong_qs: list[dict], count: int, api_key: str
) -> list[dict]:
    resolved_key = resolve_api_key(api_key)
    if not resolved_key:
        return [
            {
                "original_topic": q.get("topic", "—"),
                "original_info": (
                    f"문항 {q.get('number','?')}: "
                    f"학생 답안 = {q.get('student_answer','—')}, "
                    f"피드백 = {q.get('ai_comment','—')}"
                ),
                "similar_problems": [
                    {
                        "problem": f"유사문제 {i+1}: API 키 설정 후 생성됩니다.",
                        "answer": "—",
                    }
                    for i in range(count)
                ],
            }
            for q in wrong_qs
        ]

    wrong_list_text = "\n".join(
        f"- 문항 {q.get('number','?')} [{q.get('topic','—')} / {q.get('difficulty','?')}]: "
        f"학생답 = {q.get('student_answer','—')}, 피드백 = {q.get('ai_comment','—')}"
        for q in wrong_qs
    )
    prompt = _SIMILAR_QS_PROMPT.format(count=count, wrong_list=wrong_list_text)
    client = _build_openai_client(resolved_key)
    response = client.chat.completions.create(
        model="gpt-4o",
        max_tokens=3000,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.choices[0].message.content or "[]"
    return json.loads(_strip_fences(raw))


def generate_error_note_pdf(similar_data: list[dict], student_name: str) -> bytes:
    _trace("errornote", f"ENTER student={student_name!r} entries={len(similar_data)}")
    from fpdf import FPDF

    _trace("errornote", "fpdf imported")

    font_path = _ensure_korean_font()
    _trace("errornote", f"font_path={font_path!r}")

    class _PDF(FPDF):
        def header(self):
            fam = "NanumGothic" if font_path else "Helvetica"
            self.set_font(fam, size=8)
            self.set_text_color(140, 140, 140)
            self.cell(0, 6, "압구정 페르마 수학 — 오답 노트", align="C")
            self.ln(3)

        def footer(self):
            self.set_y(-12)
            fam = "NanumGothic" if font_path else "Helvetica"
            self.set_font(fam, size=8)
            self.set_text_color(150, 150, 150)
            self.cell(0, 6, f"- {self.page_no()} -", align="C")

        def multi_cell(self, w, h=None, text="", *args, **kwargs):
            # Force safe cursor reset so a subsequent call always has full width.
            kwargs.setdefault("new_x", "LMARGIN")
            kwargs.setdefault("new_y", "NEXT")
            return super().multi_cell(w, h, _safe_pdf_text(text), *args, **kwargs)

    _trace("errornote", "instantiating _PDF")
    pdf = _PDF()
    pdf.set_auto_page_break(auto=True, margin=16)
    if font_path:
        _trace("errornote", "adding NanumGothic font")
        pdf.add_font("NanumGothic", fname=font_path)
    pdf.add_page()
    _trace("errornote", "first page added")

    def _f(size: int = 10):
        pdf.set_font("NanumGothic" if font_path else "Helvetica", size=size)
        pdf.set_text_color(30, 30, 30)

    _f(17)
    pdf.cell(0, 11, "오답 노트", align="C", new_x="LMARGIN", new_y="NEXT")
    _f(10)
    pdf.multi_cell(
        0,
        7,
        f"학생명: {_safe_pdf_text(student_name, 80)}    작성일: {date.today()}",
        align="C",
        wrapmode="CHAR",
    )
    pdf.ln(7)

    for idx, entry in enumerate(similar_data, 1):
        _orig_info = _safe_pdf_text(entry.get("original_info", "—"))
        _topic_str = _safe_pdf_text(entry.get("original_topic", "—"), max_len=80)
        _trace(
            "errornote",
            f"entry {idx}/{len(similar_data)} topic={_topic_str!r} "
            f"problems={len(entry.get('similar_problems', []))} "
            f"orig_info_len={len(_orig_info)} orig_info_repr={_orig_info!r}",
        )
        # ── Original wrong question ──
        _f(11)
        pdf.set_fill_color(228, 238, 255)
        _trace("errornote", f"  step A: header multi_cell for entry {idx}")
        pdf.multi_cell(
            0, 8, f"[{idx}]  {_topic_str} — 틀린 문항", fill=True, wrapmode="CHAR"
        )
        _f(9)
        pdf.set_fill_color(245, 248, 255)
        _trace(
            "errornote", f"  step B: original_info multi_cell (len={len(_orig_info)})"
        )
        pdf.multi_cell(0, 6, _orig_info, fill=True, wrapmode="CHAR")
        _trace("errornote", f"  step C: original_info OK, ln(3)")
        pdf.ln(3)

        # ── Similar problems ──
        probs = entry.get("similar_problems", [])
        _f(10)
        _trace(
            "errornote",
            f"  step D: 'similar problems'header cell ({len(probs)} probs)",
        )
        pdf.cell(0, 7, f"유사 연습문제 ({len(probs)}개)", new_x="LMARGIN", new_y="NEXT")
        _f(9)
        for pi, prob in enumerate(probs, 1):
            _prob_str = _safe_pdf_text(prob.get("problem", "—"))
            _ans_str = _safe_pdf_text(prob.get("answer", "—"))
            _trace(
                "errornote",
                f"    prob {pi}/{len(probs)} problem_len={len(_prob_str)} "
                f"answer_len={len(_ans_str)}",
            )
            pdf.set_fill_color(255, 255, 248)
            pdf.multi_cell(0, 6, f"문제 {pi}.  {_prob_str}", fill=True, wrapmode="CHAR")
            _trace("errornote", f"    prob {pi} problem written, now answer")
            pdf.set_text_color(80, 80, 100)
            pdf.multi_cell(0, 5, f"   → 정답 / 힌트:  {_ans_str}", wrapmode="CHAR")
            _trace("errornote", f"    prob {pi} answer written")
            pdf.set_text_color(30, 30, 30)
            pdf.ln(2)

        _trace("errornote", f"  step E: divider line for entry {idx}")
        pdf.ln(3)
        pdf.set_draw_color(200, 205, 215)
        pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
        pdf.ln(5)
        _trace("errornote", f"  step F: entry {idx} complete")

    _trace("errornote", "calling pdf.output()")
    out = bytes(pdf.output())
    _trace("errornote", f"DONE, size={len(out)} bytes")
    return out


# ═══════════════════════════════════════════════════════════════
# AI OCR & Analysis
# ═══════════════════════════════════════════════════════════════

OCR_PROMPT = """당신은 학생의 수학 시험지를 채점하는 전문 수학 교사입니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
단계 1 — 학생 필기 감지 (가장 먼저 수행)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
이미지에서 학생이 직접 작성한 필기, 표시, 답안이 실제로 존재하는지 확인하세요.
"학생 필기"란 인쇄된 문항 텍스트가 아닌, 손으로 쓴 숫자·기호·풀이 과정·O/X 표시 등을 의미합니다.

▶ 학생 필기가 전혀 없는 경우 (백지 시험지, 문항만 인쇄된 경우 등):
  다음 JSON만 반환하고 분석을 즉시 중단하세요:
  {"mode": "no_answers", "message": "학생의 답안이 확인되지 않습니다. 학생이 작성한 답안지 사진을 함께 업로드해주세요."}

▶ 학생 필기가 하나라도 감지된 경우:
  단계 2로 진행하세요.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
단계 2 — 문항별 채점 (필기가 있을 때만)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
각 문항에 대해:
  a) 해당 수학 문제의 표준 정답(올바른 풀이 방법 및 최종 답)을 먼저 도출하세요.
  b) 학생이 실제로 적은 필기를 읽어 학생의 풀이 과정과 최종 답을 파악하세요.
  c) 학생의 답과 표준 정답을 비교하여 채점하세요:
     - 풀이와 최종 답이 모두 정확하면 → "Correct"
     - 풀이 과정은 맞으나 계산 실수로 최종 답이 틀리면 → "Partial"
     - 접근법이나 최종 답이 틀리면 → "Incorrect"
     - 학생이 해당 문항을 비워둔 경우 → "Incorrect"(student_answer: "미응답")

아래 JSON 형식으로만 반환하세요 (순수 JSON, 마크다운 펜스 금지):

{
  "mode": "ai",
  "topics_detected": ["시험에서 발견된 수학 단원명 목록 (한국어)"],
  "questions": [
    {
      "number": 1,
      "topic": "예: 이차방정식 (한국어 단원명)",
      "difficulty": "High | Mid | Low",
      "result": "Correct | Incorrect | Partial",
      "student_answer": "학생이 실제로 적은 답 (필기에서 읽은 내용 그대로)",
      "ai_comment": "표준 정답과 비교한 구체적인 한 문장 피드백 (반드시 한국어)"
    }
  ],
  "estimated_scores": [
    {"topic": "단원명 (한국어)", "estimated_pct": 75, "observation": "한국어 짧은 메모"}
  ],
  "overall_estimated_pct": 72,
  "strengths": ["잘한 점 (한국어)"],
  "improvement_areas": ["보완이 필요한 점 (한국어)"],
  "teacher_notes": "교사를 위한 2~3문장 종합 평가 — 필기 품질, 오류 패턴 포함 (한국어)",
  "suggested_practice": ["추천 연습 항목 (한국어)"]
}

추가 규칙:
- 학생 필기에서 직접 읽은 내용만 student_answer에 기록하세요. 추측하지 마세요.
- 인쇄된 문항 텍스트를 student_answer로 착각하지 마세요.
- "result"값은 반드시 "Correct", "Incorrect", "Partial"중 하나여야 합니다.
- "difficulty"값은 반드시 "High", "Mid", "Low"중 하나여야 합니다.
- 순수 JSON만 반환하세요 — 마크다운, 추가 설명 절대 금지."""


def _mock_analysis() -> dict:
    """한국어 시뮬레이션 결과 — AI를 사용할 수 없을 때 표시됩니다."""
    return {
        "mode": "mock",
        "topics_detected": ["이차방정식", "일차방정식", "도형(기하)", "응용문제"],
        "questions": [
            {
                "number": 1,
                "topic": "이차방정식",
                "difficulty": "Mid",
                "result": "Correct",
                "student_answer": "x = 3, x = −2",
                "ai_comment": "인수분해를 정확하게 적용하여 부호 처리까지 올바르게 완료했습니다.",
            },
            {
                "number": 2,
                "topic": "일차방정식",
                "difficulty": "Low",
                "result": "Correct",
                "student_answer": "x = 7",
                "ai_comment": "풀이 과정이 명확하고 최종 답도 정확합니다.",
            },
            {
                "number": 3,
                "topic": "도형(기하)",
                "difficulty": "Mid",
                "result": "Partial",
                "student_answer": "넓이 = 48 cm²",
                "ai_comment": "공식은 올바르게 사용했으나 마지막 계산 단계에서 산술 오류가 발생했습니다.",
            },
            {
                "number": 4,
                "topic": "응용문제",
                "difficulty": "High",
                "result": "Incorrect",
                "student_answer": "120 km/h",
                "ai_comment": "방정식 설정은 맞았으나 속력과 시간 값을 서로 바꿔 대입했습니다.",
            },
            {
                "number": 5,
                "topic": "이차방정식",
                "difficulty": "High",
                "result": "Correct",
                "student_answer": "x = (−b ± √(b²−4ac)) / 2a → x ≈ 1.56, x ≈ −3.56",
                "ai_comment": "근의 공식을 정확히 적용하고 소수점 반올림도 올바릅니다.",
            },
        ],
        "estimated_scores": [
            {
                "topic": "이차방정식",
                "estimated_pct": 90,
                "observation": "인수분해 및 공식 활용 능력 우수",
            },
            {
                "topic": "일차방정식",
                "estimated_pct": 95,
                "observation": "전반적으로 정확하고 안정적",
            },
            {
                "topic": "도형(기하)",
                "estimated_pct": 65,
                "observation": "개념 이해는 되어 있으나 계산 오류 있음",
            },
            {
                "topic": "응용문제",
                "estimated_pct": 40,
                "observation": "방정식 설정 능력은 있으나 변수 배정 오류",
            },
        ],
        "overall_estimated_pct": 74,
        "strengths": [
            "이차방정식 인수분해 능력 탄탄함",
            "모든 문제에서 풀이 과정이 명확하게 작성됨",
            "시험 상황에서도 공식을 정확히 기억하여 적용함",
        ],
        "improvement_areas": [
            "응용문제에서 변수 배정 오류 (속력 × 시간)",
            "도형 문제의 다단계 계산 정확도 향상 필요",
        ],
        "teacher_notes": (
            "이 학생은 대수 기법, 특히 이차방정식에 대한 탄탄한 기초 이해를 보여줍니다. "
            "주요 보완 영역은 응용문제로, 풀이 방법 자체는 이해하고 있으나 변수 배정 시 "
            "반복적인 오류가 발생합니다. 문장을 방정식으로 변환하는 집중 연습을 권장합니다."
        ),
        "suggested_practice": [
            "속력·시간·거리 관계에 집중한 응용문제 10문제 풀기",
            "도형 문제에서 각 단계마다 계산을 검토한 후 다음으로 넘어가기",
            "판별식 분석을 통해 풀기 전에 근의 성질 예측 연습",
            "짝과 설명하기 활동으로 변수 배정 논리 강화",
            "과거 시험 이차방정식 문제 세트로 속도와 자신감 키우기",
        ],
    }


def _strip_fences(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
    if raw.endswith("```"):
        raw = raw.rsplit("```", 1)[0]
    return raw.strip()


def _build_openai_client(api_key: str) -> "openai.OpenAI":  # type: ignore[name-defined]
    import openai as _openai

    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL", "")
    kwargs: dict = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    return _openai.OpenAI(**kwargs)


def analyze_exam_pages(
    pages: list[tuple[bytes, str]],
    user_api_key: str = "",
    pdf_text: str = "",
) -> dict:
    """Send page images (+ optional extracted text) to GPT-4o.

    Fallback rules:
      • api_key is EMPTY  → return Korean mock immediately (no error shown)
      • api_key is set but API call fails → raise the original exception so the
        UI can display the real error message to the user
    """
    api_key = resolve_api_key(user_api_key)

    # ── No key at all → silent Korean mock ───────────────────────
    if not api_key:
        return _mock_analysis()

    # ── Key is set → call the real API (errors propagate to caller) ──
    client = _build_openai_client(api_key)

    # Build the message content:
    #  1. System prompt
    #  2. (Optional) extracted text block for typed PDFs
    #  3. One image block per rendered page
    content: list[dict] = [{"type": "text", "text": OCR_PROMPT}]

    if pdf_text.strip():
        content.append(
            {
                "type": "text",
                "text": (
                    "\n\n아래는 PDF에서 추출한 텍스트입니다. "
                    "이미지와 함께 참고하여 분석하세요:\n\n" + pdf_text
                ),
            }
        )

    for img_bytes, mime in pages:
        b64 = base64.b64encode(img_bytes).decode()
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{b64}"},
            }
        )

    response = client.chat.completions.create(
        model="gpt-4o",
        max_tokens=2048,
        messages=[{"role": "user", "content": content}],
    )

    choices = getattr(response, "choices", None)
    if not choices:
        raise RuntimeError(
            "OpenAI 응답에 choices 필드가 없습니다. 잠시 후 다시 시도해 주세요."
        )

    raw = choices[0].message.content or "{}"
    result = json.loads(_strip_fences(raw))
    result.setdefault("mode", "ai")
    return result


def analyze_exam_image(image_bytes: bytes, mime: str, user_api_key: str = "") -> dict:
    """Convenience wrapper for a single image file."""
    return analyze_exam_pages([(image_bytes, mime)], user_api_key=user_api_key)


# ═══════════════════════════════════════════════════════════════
# Page: Dashboard
# ═══════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════
# Shared UI helpers (page header, teacher filter, theme)
# ═══════════════════════════════════════════════════════════════

CATEGORY_LABELS = {
    "general": "일반",
    "progress": "학습 진도",
    "parent": "학부모 상담",
    "behavior": "태도 / 행동",
    "other": "기타",
}


def _current_teacher_id() -> int | None:
    """Currently logged-in teacher id (None = 미로그인)."""
    v = st.session_state.get("logged_in_teacher_id") or st.session_state.get("current_teacher_id")
    return int(v) if v not in (None, "", 0) else None


_ROLE_KR = {"teacher": "강사", "admin": "관리자", "vice": "부원장", "director": "원장"}


def _current_role() -> str:
    return st.session_state.get("logged_in_teacher_role", "")


def _is_manager() -> bool:
    """관리자/부원장/원장이면 True. 테스트 중: 미로그인도 True (나중에 False로 변경)."""
    role = _current_role()
    if not role:  # 미로그인 → 테스트 중이므로 True (추후 False로 변경)
        return True
    return role in ("admin", "vice", "director")


def _current_student_id() -> int | None:
    """Currently selected student for report generation."""
    v = st.session_state.get("current_student_id")
    return int(v) if v not in (None, "", 0) else None


def _student_select_options(teacher_id: int | None = None) -> dict[str, int | None]:
    """Label → student_id map for selectboxes."""
    df = get_all_students(teacher_id)
    opts: dict[str, int | None] = {"— 학생 선택 —": None}
    for _, row in df.iterrows():
        label = f"{row['name']} · {row['class_name']}"
        opts[label] = int(row["id"])
    return opts


def _student_name_from_id(student_id: int | None) -> str:
    if student_id is None:
        return "학생"
    df = get_all_students()
    match = df[df["id"] == student_id]
    if match.empty:
        return "학생"
    return str(match.iloc[0]["name"])


def _current_student_name() -> str:
    """Selected student display name for reports and DB."""
    name = st.session_state.get("current_student_name")
    if name:
        return str(name).strip()
    return _student_name_from_id(_current_student_id())


def _bind_report_student(
    student_id: int,
    student_name: str,
    *,
    class_id: int | None = None,
) -> None:
    """Persist selected student context for report generation and DB save."""
    st.session_state["current_student_id"] = int(student_id)
    st.session_state["current_student_name"] = student_name.strip()
    st.session_state["feedback_student_name"] = student_name.strip()
    st.session_state["_grade_report_student_id"] = int(student_id)
    if class_id is not None:
        st.session_state["ocr_selected_class_id"] = int(class_id)


def _ocr_student_ready() -> bool:
    return _current_student_id() is not None


def _sanitize_test_filename_part(text: str, *, max_len: int = 48) -> str:
    """Remove characters unsafe for Windows filenames."""
    cleaned = _re_mod.sub(r'[<>:"/\\|?*\n\r\t]', "", (text or "").strip())
    cleaned = _re_mod.sub(r"\s+ ", "_", cleaned)
    cleaned = _re_mod.sub(r"_+ ", "_", cleaned).strip("._")
    return cleaned[:max_len] if cleaned else "테스트"


def _diff_to_grade(diff: str) -> str:
    """High/Mid/Low 또는 A~E 모두 A~E 5단계로 정규화."""
    _legacy = {"High": "A", "high": "A", "Mid": "C", "mid": "C", "Low": "E", "low": "E"}
    val = _legacy.get(diff, diff).upper()
    return val if val in ("A", "B", "C", "D", "E") else "C"


def _infer_dominant_topic(parsed: dict | None) -> str:
    """Pick the most frequent unit label inferred from OCR slots."""
    from collections import Counter

    counts: Counter[str] = Counter()
    for slot in (parsed or {}).get("slots") or []:
        n = int(slot.get("number") or 0)
        text = str(slot.get("text") or "")
        topic = str(slot.get("topic") or "").strip()
        if not topic or topic == "미분류":
            topic, _ = infer_topic_from_text(text, n)
        if topic and topic != "미분류":
            counts[topic] += 1
    if counts:
        return counts.most_common(1)[0][0]
    return "종합"


def _generate_test_file_title(
    parsed: dict | None,
    upload_filename: str | None = None,
    test_date: date | None = None,
) -> str:
    """Auto title: ``YYYY-MM-DD_단원명_테스트제목``."""
    dt = (test_date or date.today()).isoformat()
    topic = _sanitize_test_filename_part(_infer_dominant_topic(parsed), max_len=24)
    stem = "테스트"
    if upload_filename:
        stem = os.path.splitext(os.path.basename(upload_filename))[0]
    stem = _sanitize_test_filename_part(stem, max_len=32)
    return f"{dt}_{topic}_{stem}"


def _save_test_sheet_file(
    file_bytes: bytes,
    title: str,
    original_filename: str | None,
) -> tuple[str, str]:
    """Persist uploaded sheet under ``data/test_sheets/``. Returns (file_name, abs_path)."""
    os.makedirs(TEST_SHEETS_DIR, exist_ok=True)
    ext = "pdf"
    if original_filename and "." in original_filename:
        ext = original_filename.rsplit(".", 1)[-1].lower()
    base = _sanitize_test_filename_part(title, max_len=80)
    file_name = f"{base}.{ext}"
    dest = os.path.join(TEST_SHEETS_DIR, file_name)
    if os.path.exists(dest):
        stamp = datetime.now().strftime("%H%M%S")
        file_name = f"{base}_{stamp}.{ext}"
        dest = os.path.join(TEST_SHEETS_DIR, file_name)
    with open(dest, "wb") as fh:
        fh.write(file_bytes)
    return file_name, dest


def _test_sheet_abs_path(file_name: str) -> str:
    return os.path.join(TEST_SHEETS_DIR, file_name)


def _is_test_sheet_confirmed() -> bool:
    """Whether a test sheet is loaded/confirmed and student UI may proceed."""
    return bool(
        st.session_state.get("test_sheet_confirmed")
        and st.session_state.get("active_test_id")
    )


def _confirm_test_sheet(test_id: int, test_name: str | None = None) -> None:
    """Mark session as ready for student wrong-answer entry."""
    st.session_state["active_test_id"] = int(test_id)
    st.session_state["test_sheet_confirmed"] = True
    st.session_state["_loaded_test_id"] = int(test_id)
    if test_name:
        st.session_state["ocr_exam_name"] = test_name
    st.session_state.pop("ocr_reedit_test", None)


def _clear_test_sheet_session(*, keep_ocr: bool = False) -> None:
    """Reset loaded/confirmed test (optionally keep in-progress OCR)."""
    st.session_state.pop("active_test_id", None)
    st.session_state.pop("test_sheet_confirmed", None)
    st.session_state.pop("_loaded_test_id", None)
    st.session_state.pop("ocr_exam_name", None)
    st.session_state.pop("ocr_reedit_test", None)
    st.session_state.pop("ocr_reedit_test_id", None)
    if not keep_ocr:
        st.session_state.pop("ocr_extract_result", None)
        st.session_state.pop("ocr_parsed_questions", None)


def _sync_existing_test_selectbox_label(test_id: int) -> None:
    """Align selectbox widget with the active test row (call only before widget render)."""
    meta = get_test_by_id(int(test_id))
    if meta:
        st.session_state["existing_test_sel"] = format_test_option_label(meta)


_NEW_TEST_UPLOAD_LABEL = "— 새 시험지 업로드 —"


def _on_existing_test_sel_change() -> None:
    """Handle existing / new-upload mode switch via selectbox callback."""
    sel = st.session_state.get("existing_test_sel")
    if sel == _NEW_TEST_UPLOAD_LABEL:
        _clear_test_sheet_session(keep_ocr=True)
        st.session_state["_test_input_mode"] = "new"
        return
    st.session_state["_test_input_mode"] = "existing"
    tests_df = list_tests(limit=100, teacher_id=_current_teacher_id())
    if tests_df.empty:
        return
    for _, row in tests_df.iterrows():
        label = format_test_option_label(row)
        if label != sel:
            continue
        test_id = int(row["test_id"])
        meta = get_test_by_id(test_id)
        if meta:
            _confirm_test_sheet(test_id, meta["test_name"])
            st.session_state.pop("ocr_extract_result", None)
            st.session_state.pop("ocr_parsed_questions", None)
        break


def _prepare_existing_test_selectbox_state() -> None:
    """Set selectbox session value before widget render (never after)."""
    if st.session_state.get("_test_input_mode") == "new":
        st.session_state["existing_test_sel"] = _NEW_TEST_UPLOAD_LABEL
        return
    pending_sync = st.session_state.pop("_pending_sync_test_id", None)
    if pending_sync is not None:
        _sync_existing_test_selectbox_label(int(pending_sync))
        return
    if st.session_state.get("active_test_id") and st.session_state.get(
        "test_sheet_confirmed"
    ):
        _sync_existing_test_selectbox_label(int(st.session_state["active_test_id"]))


def _questions_df_from_db(test_id: int) -> pd.DataFrame:
    rows = get_test_questions(int(test_id))
    if not rows:
        return pd.DataFrame(columns=["문항번호", "단원", "풀이유형", "객관식/서술형", "난이도"])
    return pd.DataFrame(
        [
            {
                "문항번호": str(r["question_number"]),
                "단원": r["topic"],
                "풀이유형": str(r.get("question_method") or ""),
                "객관식/서술형": str(r.get("question_type") or "객관식"),
                "난이도": _diff_to_grade(str(r.get("difficulty") or "C")),
            }
            for r in rows
        ]
    )


def _render_existing_test_selector() -> int | None:
    """Dropdown to load a previously saved test sheet (skips OCR)."""
    with st.container(border=True):
        st.markdown("#### 기존 시험지 불러오기")
        tests_df = list_tests(limit=100, teacher_id=_current_teacher_id())
        options: list[str] = [_NEW_TEST_UPLOAD_LABEL]
        id_by_label: dict[str, int] = {}
        if not tests_df.empty:
            for _, row in tests_df.iterrows():
                label = format_test_option_label(row)
                options.append(label)
                id_by_label[label] = int(row["test_id"])

        _prepare_existing_test_selectbox_state()

        sel_label = st.selectbox(
            "저장된 시험지",
            options,
            key="existing_test_sel",
            on_change=_on_existing_test_sel_change,
        )

        if sel_label == _NEW_TEST_UPLOAD_LABEL:
            st.caption(
                "새 시험지를 업로드하거나, 아래 목록에서 기존 시험지를 선택하세요."
            )
            return None

        picked_id = id_by_label.get(sel_label)
        if picked_id:
            meta = get_test_by_id(picked_id)
            if meta:
                file_name = meta.get("file_name") or ""
                st.success(
                    f"**{meta['test_name']}** · {meta['date']} · "
                    f"{meta['total_questions']}문항"
                    + (f"· `{file_name}`" if file_name else ""),
                )
                qdf = _questions_df_from_db(picked_id)
                if not qdf.empty:
                    st.dataframe(qdf, hide_index=True, width="stretch")
                if file_name and os.path.isfile(_test_sheet_abs_path(file_name)):
                    fpath = _test_sheet_abs_path(file_name)
                    ext = file_name.rsplit(".", 1)[-1].lower()
                    if ext in ("jpg", "jpeg", "png", "webp"):
                        st.image(fpath, caption=file_name, width="stretch")
                    elif ext == "pdf":
                        st.caption(f"PDF 저장됨: `{file_name}`")
            return picked_id
    return None


def _init_auto_test_title(parsed: dict | None) -> None:
    """Set suggested title once after OCR (date + unit + upload name)."""
    if not parsed:
        return
    upload_name = st.session_state.get("ocr_upload_filename")
    test_date_val = st.session_state.get("ocr_confirm_test_date")
    if isinstance(test_date_val, date):
        td = test_date_val
    else:
        td = date.today()
    suggested = _generate_test_file_title(parsed, upload_name, td)
    st.session_state["ocr_suggested_test_name"] = suggested
    if not st.session_state.get("ocr_confirm_test_name"):
        st.session_state["ocr_confirm_test_name"] = suggested


def _parsed_found_question_slots(parsed: dict | None) -> list[dict[str, Any]]:
    """Return only OCR-detected questions (exclude empty 1..20 placeholder slots)."""
    if not parsed:
        return []

    # slots에 topic/solve_type이 반영돼 있으므로 slots 기준으로 topic 매핑 먼저 만들기
    slots_by_number: dict[int, dict] = {}
    for s in (parsed.get("slots") or []):
        n = int(s.get("number") or 0)
        if n:
            slots_by_number[n] = s

    questions = parsed.get("questions") or []
    if questions:
        result = []
        for q in questions:
            n = int(q["number"])
            slot = slots_by_number.get(n, {})
            result.append({
                "number": n,
                "text": str(q.get("text") or ""),
                "found": True,
                "topic": str(slot.get("topic") or q.get("topic") or ""),
                "question_method": str(slot.get("question_method") or slot.get("solve_type") or q.get("question_method") or q.get("method") or ""),
                "question_type": str(slot.get("question_type") or q.get("question_type") or "객관식"),
                "difficulty": str(slot.get("difficulty") or q.get("difficulty") or "C"),
            })
        return result

    return [
        s
        for s in (parsed.get("slots") or [])
        if s.get("found") or str(s.get("text") or "").strip()
    ]


def _ocr_wrong_question_numbers(parsed: dict | None = None) -> list[int]:
    """문항 번호 목록 — OCR 감지 문항 → 확정 TEST → fallback."""
    ocr_parsed = (
        parsed if parsed is not None else st.session_state.get("ocr_parsed_questions")
    )
    found_slots = _parsed_found_question_slots(ocr_parsed)
    if found_slots:
        return sorted(int(s["number"]) for s in found_slots)

    test_id = st.session_state.get("active_test_id")
    if test_id and _is_test_sheet_confirmed():
        qs = get_test_questions(int(test_id))
        if qs:
            return [int(q["question_number"]) for q in qs]

    detected = int((ocr_parsed or {}).get("detected_count") or 0)
    if detected > 0:
        return list(range(1, detected + 1))
    return list(range(1, 101))


def _build_questions_editor_df(parsed: dict | None) -> pd.DataFrame:
    """OCR 파싱 결과 → 문항 편집용 DataFrame."""
    rows: list[dict[str, Any]] = []
    for slot in _parsed_found_question_slots(parsed):
        n = slot["number"]  # 문자열 그대로 유지 (서술형1, 서술형2 등 가능)
        text = str(slot.get("text") or "")
        topic = str(slot.get("topic") or "").strip()
        if not topic:
            topic, _ = infer_topic_from_text(text, int(n) if str(n).isdigit() else 1)
        diff_raw = str(slot.get("difficulty") or "C").strip()
        diff = _diff_to_grade(diff_raw)
        method = str(slot.get("question_method") or "").strip()
        qtype = str(slot.get("question_type") or "객관식").strip()
        rows.append({
            "문항번호": str(n),
            "단원": topic,
            "풀이유형": method,
            "객관식/서술형": qtype,
            "난이도": diff,
        })
    if not rows:
        return pd.DataFrame(columns=["문항번호", "단원", "풀이유형", "객관식/서술형", "난이도"])
    return pd.DataFrame(rows).reset_index(drop=True)


def _active_test_meta() -> dict[str, Any] | None:
    test_id = st.session_state.get("active_test_id")
    if not test_id:
        return None
    return get_test_by_id(int(test_id))


def _preview_score_from_wrong(selected_wrong: list[int]) -> float | None:
    meta = _active_test_meta()
    if not meta:
        return None
    return compute_score_from_wrong(meta["total_questions"], selected_wrong)


def _render_test_question_editor(parsed: dict | None) -> bool:
    """분석 후 문항 편집 · 확정 → ``tests`` / ``test_questions`` 저장."""
    active = _active_test_meta()
    if (
        active
        and _is_test_sheet_confirmed()
        and not st.session_state.get("ocr_reedit_test")
    ):
        file_hint = active.get("file_name") or ""
        st.success(
            f"시험지 확정됨: **{active['test_name']}** · "
            f"{active['date']} · {active['total_questions']}문항 (ID {active['test_id']})"
            + (f"· `{file_hint}`" if file_hint else ""),
        )
        if st.button("TEST 다시 등록", key="ocr_reedit_test_btn", type="secondary"):
            st.session_state["ocr_reedit_test"] = True
            st.session_state["ocr_reedit_test_id"] = active["test_id"]
            st.session_state.pop("test_sheet_confirmed", None)
            st.session_state.pop("active_test_id", None)
            st.session_state.pop("_loaded_test_id", None)
            if parsed:
                _init_auto_test_title(parsed)
            st.rerun()
        return True

    if parsed:
        _init_auto_test_title(parsed)

    if not parsed or not (parsed.get("slots") or parsed.get("detected_count")):
        return _is_test_sheet_confirmed()

    with st.container(border=True):
        st.markdown("#### 문항 정보 확인 · 수정")
        detected = int(
            parsed.get("detected_count") or len(_parsed_found_question_slots(parsed))
        )
        dominant = _infer_dominant_topic(parsed)
        st.caption(
            f"OCR **{detected}개** 문항 감지 · 대표 단원 **{dominant}**. "
            "단원·난이도·문항번호를 확인·수정한 뒤 **확정**을 눌러 TEST를 등록하세요."
        )

        editor_df = _build_questions_editor_df(parsed)
        if editor_df.empty:
            st.warning("편집할 문항 데이터가 없습니다.")
            return _is_test_sheet_confirmed()

        edited = st.data_editor(
            editor_df,
            num_rows="dynamic",
            hide_index=True,
            width="stretch",
            key="ocr_questions_editor",
            column_config={
                "문항번호": st.column_config.TextColumn(
                    "문항번호",
                    help="숫자(1~20) 또는 서술형1, 서술형2 등 직접 입력 가능",
                    width="small",
                ),
                "단원": st.column_config.TextColumn(
                    "단원",
                    help="예) 이차방정식, 지수함수, 삼각함수",
                    width="medium",
                ),
                "풀이유형": st.column_config.TextColumn(
                    "풀이유형",
                    help="예) 근의공식, 인수분해 활용, 그래프 해석 — AI가 자동 분석, 직접 수정 가능",
                    width="large",
                ),
                "객관식/서술형": st.column_config.SelectboxColumn(
                    "객관식/서술형",
                    options=["객관식", "서술형"],
                    required=True,
                    width="small",
                ),
                "난이도": st.column_config.SelectboxColumn(
                    "난이도",
                    options=["A", "B", "C", "D", "E"],
                    help="A(킬러) B(준킬러) C(표준) D(기본) E(최하)",
                    required=True,
                    width="small",
                ),
            },
        )

        # 테스트 종류 선택
        st.markdown("**테스트 종류**")
        _test_type_options = ["일일테스트", "주간테스트", "월간테스트", "단원테스트", "기타"]
        _test_type_cols = st.columns(5)
        if "ocr_confirm_test_type" not in st.session_state:
            st.session_state["ocr_confirm_test_type"] = "일일테스트"
        for _i, _opt in enumerate(_test_type_options):
            with _test_type_cols[_i]:
                if st.button(
                    _opt,
                    key=f"test_type_btn_{_opt}",
                    type="primary" if st.session_state["ocr_confirm_test_type"] == _opt else "secondary",
                    use_container_width=True,
                ):
                    st.session_state["ocr_confirm_test_type"] = _opt
                    st.rerun()
        _selected_type = st.session_state["ocr_confirm_test_type"]
        if _selected_type == "기타":
            _custom_type = st.text_input(
                "테스트 종류 직접 입력",
                key="ocr_confirm_test_type_custom",
                placeholder="예: 2단원 연립방정식",
            )
            if _custom_type:
                _selected_type = _custom_type

        c_name, c_date, c_btn = st.columns([2, 1, 1])
        with c_date:
            test_date = st.date_input(
                "시험일",
                value=date.today(),
                key="ocr_confirm_test_date",
            )
        with c_name:
            suggested = _generate_test_file_title(
                parsed,
                st.session_state.get("ocr_upload_filename"),
                test_date,
            )
            st.session_state["ocr_suggested_test_name"] = suggested
            if st.session_state.get("ocr_confirm_test_name") in (None, ""):
                st.session_state["ocr_confirm_test_name"] = suggested
            test_name = st.text_input(
                "시험지 제목 (자동 생성 · 수정 가능)",
                help="형식 예: 2026-06-01_단원명_테스트제목",
                key="ocr_confirm_test_name",
            )
            st.caption(f"자동 제안: `{suggested}`")
        with c_btn:
            st.markdown("<div style='height:28px'></div>", unsafe_allow_html=True)
            confirm_btn = st.button(
                "확정 (TEST DB 저장)",
                type="primary",
                width="stretch",
                key="ocr_confirm_test_btn",
            )

        if confirm_btn:
            if edited.empty:
                st.error("저장할 문항이 없습니다.")
            elif edited["문항번호"].isna().any():
                st.error("모든 문항에 **문항번호**를 입력해 주세요.")
            else:
                questions: list[dict[str, Any]] = []
                for _, row in edited.iterrows():
                    qnum_raw = str(row.get("문항번호") or "").strip()
                    questions.append(
                        {
                            "question_number": qnum_raw or "미분류",
                            "topic": str(row.get("단원") or "미분류").strip() or "미분류",
                            "question_method": str(row.get("풀이유형") or "").strip(),
                            "question_type": str(row.get("객관식/서술형") or "객관식").strip() or "객관식",
                            "difficulty": str(row.get("난이도") or "C").strip() or "C",
                        }
                    )
                title = (test_name or suggested or "").strip() or suggested
                file_name = ""
                upload_bytes = st.session_state.get("ocr_upload_bytes")
                upload_orig = st.session_state.get("ocr_upload_filename")
                if upload_bytes:
                    try:
                        file_name, _ = _save_test_sheet_file(
                            upload_bytes,
                            title,
                            upload_orig,
                        )
                    except Exception as file_exc:
                        st.warning(
                            f"시험지 파일 저장 실패 (DB는 저장됩니다): {file_exc}"
                        )
                analysis = {
                    "detected_count": detected,
                    "dominant_topic": dominant,
                    "source": "ocr_vision_gpt",
                    "original_upload": upload_orig or "",
                }
                try:
                    reedit_id = st.session_state.get("ocr_reedit_test_id")
                    if reedit_id:
                        update_test_with_questions(
                            test_id=int(reedit_id),
                            test_name=title,
                            test_date=test_date.isoformat(),
                            questions=questions,
                            analysis_data=analysis,
                            file_name=file_name,
                            test_type=_selected_type,
                        )
                        test_id = int(reedit_id)
                    else:
                        test_id = save_test_with_questions(
                            test_name=title,
                            test_date=test_date.isoformat(),
                            questions=questions,
                            analysis_data=analysis,
                            file_name=file_name,
                            test_type=_selected_type,
                        )
                    _confirm_test_sheet(test_id, title)
                    st.session_state["_test_input_mode"] = "existing"
                    st.session_state["_pending_sync_test_id"] = test_id
                    st.session_state.pop("ocr_reedit_test_id", None)
                    st.session_state.pop("ocr_questions_editor", None)
                    sync_all_csvs()
                    st.success(
                        f"**{title}** TEST 확정 완료 "
                        f"(문항 {len(questions)}개 · ID {test_id}"
                        + (f"· `{file_name}`" if file_name else "")
                        + ")",
                    )
                    st.rerun()
                except Exception as exc:
                    st.error(f"TEST 저장 실패: {exc}")

    return _is_test_sheet_confirmed()


def _read_ocr_wrong_selection(parsed: dict | None = None) -> list[int]:
    """세션 체크박스 상태에서 선택된 오답 번호."""
    numbers = _ocr_wrong_question_numbers(parsed)
    check_states = build_check_states(
        {
            n: bool(st.session_state.get(f"{WRONG_CHECK_KEY_PREFIX}{n}", False))
            for n in numbers
        }
    )
    return get_selected_questions(check_states)


def _sync_ocr_selected_collected(parsed: dict | None, selected: list[int]) -> dict:
    """선택 오답을 session_state에 반영 (보고서 작성·DB 저장 공용)."""
    numbers = _ocr_wrong_question_numbers(parsed)
    check_states = build_check_states({n: n in selected for n in numbers})
    if parsed and selected:
        collected = collect_selected_questions(parsed, check_states)
    else:
        collected = {"selected_numbers": selected, "items": [], "parsed_filtered": None}
    st.session_state["ocr_selected_collected"] = collected
    return collected


def _render_ocr_wrong_checkboxes(parsed: dict | None = None) -> list[int]:
    """오답 번호 체크박스 그리드. 선택된 번호 리스트 반환."""
    numbers = _ocr_wrong_question_numbers(parsed)
    active = _active_test_meta()
    if active:
        st.caption(
            f"**{active['test_name']}** · {active['total_questions']}문항 · "
            "틀린 번호를 체크하세요."
        )
    elif (parsed or {}).get("detected_count"):
        st.caption(
            f"OCR **{parsed.get('detected_count')}개** 문항 감지 · 틀린 번호를 체크하세요."
        )
    else:
        st.caption("틀린 문항 번호를 체크하세요.")

    check_values: dict[int, bool] = {}
    cols = st.columns(5)
    for idx, num in enumerate(numbers):
        with cols[idx % 5]:
            check_values[num] = st.checkbox(
                f"{num}번",
                key=f"{WRONG_CHECK_KEY_PREFIX}{num}",
            )
    selected = get_selected_questions(build_check_states(check_values))
    if selected:
        st.info("선택된 오답: " + ", ".join(f"{n}번" for n in selected))
    return selected


def _handle_ocr_test_result_save(
    *,
    student_id: int,
    student_name: str,
    selected_wrong: list[int],
) -> None:
    """선택 학생·오답 → ``student_results`` 저장 (점수 자동 계산)."""
    test_id = st.session_state.get("active_test_id")
    if not test_id:
        st.warning(
            "먼저 **기존 시험지 불러오기**에서 시험지를 선택하거나 **확정**을 완료해 주세요."
        )
        return

    try:
        result = save_student_result(
            student_id=student_id,
            test_id=int(test_id),
            wrong_numbers=selected_wrong,
        )
        sync_all_csvs()
        st.success(
            f"**{student_name}** 학생 결과 저장 완료 — "
            f"{result['test_name']} · {result['date']} · "
            f"오답 {result['wrong_count']}개 · **{result['score']:.1f}점** "
            f"({result['total_questions']}문항 기준)",
        )
        history = get_student_test_results(student_id=student_id)
        if history:
            recent = history[-3:]
            rows = [
                {
                    "테스트명": h.get("test_name", ""),
                    "날짜": h.get("date", ""),
                    "오답": ", ".join(str(n) for n in (h.get("wrong_numbers") or [])),
                    "점수": coerce_numeric(h.get("score"), default=0),
                }
                for h in recent
            ]
            st.caption("최근 저장 기록")
            st.dataframe(
                _safe_streamlit_dataframe(pd.DataFrame(rows)),
                hide_index=True,
                width="stretch",
            )
    except Exception as exc:
        st.error(f"오답 DB 저장 실패: {exc}")


def _render_ocr_class_student_picker(
    *,
    parsed: dict | None = None,
) -> bool:
    """반 복수선택 → 학생 전원 expander 오답체크 → 일괄 DB 저장."""
    if not _is_test_sheet_confirmed():
        st.info(
            "**기존 시험지 불러오기**에서 시험지를 선택하거나, "
            "새 시험지 **업로드 → OCR → 확정** 후 학생별 오답을 입력할 수 있습니다.",
        )
        return False

    with st.container(border=True):
        st.markdown("#### 학생 · 오답 일괄 입력")
        active = _active_test_meta()
        if active:
            st.caption(
                f"확정 TEST: **{active['test_name']}** · "
                f"{active['total_questions']}문항 · {active['date']}"
            )

        ocr_classes = get_all_classes(_current_teacher_id())
        if ocr_classes.empty:
            st.warning("등록된 반이 없습니다. 앱을 재시작하면 **테스트 반**이 자동 생성됩니다.")
            return False

        class_map = {str(row["name"]): int(row["id"]) for _, row in ocr_classes.iterrows()}
        class_names = list(class_map.keys())

        st.markdown("**① 반 선택** (여러 반 동시 선택 가능)")
        selected_classes = []
        cols_cls = st.columns(min(len(class_names), 5))
        for i, cname in enumerate(class_names):
            with cols_cls[i % 5]:
                if st.checkbox(cname, key=f"batch_class_chk_{cname}", value=(i == 0)):
                    selected_classes.append(cname)

        if not selected_classes:
            st.warning("반을 하나 이상 선택해 주세요.")
            return False

        all_students: list[dict] = []
        for cname in selected_classes:
            cid = class_map[cname]
            df = get_students_by_class(cid)
            if df.empty:
                continue
            for _, row in df.iterrows():
                all_students.append({
                    "class_name": cname,
                    "class_id": cid,
                    "student_id": int(row["id"]),
                    "student_name": str(row["name"]),
                })

        if not all_students:
            st.warning("선택한 반에 등록된 학생이 없습니다.")
            return False

        st.markdown(f"**② 학생별 오답 체크** — 총 **{len(all_students)}명**")
        st.caption("시험을 보지 않은 학생은 expander 안에서 체크를 해제하면 저장 시 제외됩니다.")

        numbers = _ocr_wrong_question_numbers(parsed)

        for s in all_students:
            sid = s["student_id"]
            sname = s["student_name"]
            cname = s["class_name"]
            include_key = f"batch_include_{sid}"
            wrong_key_prefix = f"batch_wrong_{sid}_"

            with st.expander(f"📋 {cname} · {sname}", expanded=False):
                include = st.checkbox(
                    "이 학생 시험 봤음 (저장 포함)",
                    key=include_key,
                    value=st.session_state.get(include_key, True),
                )
                if include:
                    wrong_vals: dict[int, bool] = {}
                    cols_w = st.columns(5)
                    for idx, num in enumerate(numbers):
                        with cols_w[idx % 5]:
                            wrong_vals[num] = st.checkbox(
                                f"{num}번",
                                key=f"{wrong_key_prefix}{num}",
                            )
                    selected = [n for n, v in wrong_vals.items() if v]
                    preview = _preview_score_from_wrong(selected)
                    if preview is not None:
                        st.info(f"예상 점수: **{preview:.1f}점** · 오답 {len(selected)}개")
                    else:
                        st.caption("오답 선택 시 점수 자동 계산")
                else:
                    st.caption("⚠️ 저장에서 제외됩니다.")

        st.divider()

        save_all_btn = st.button(
            "💾 전원 오답 일괄 저장",
            type="primary",
            use_container_width=True,
            key="batch_save_all_btn",
        )

        if save_all_btn:
            success_count = 0
            fail_count = 0
            saved_students = []
            for s in all_students:
                sid = s["student_id"]
                sname = s["student_name"]
                include_key = f"batch_include_{sid}"
                wrong_key_prefix = f"batch_wrong_{sid}_"
                if not st.session_state.get(include_key, True):
                    continue
                selected_wrong = [
                    num for num in numbers
                    if st.session_state.get(f"{wrong_key_prefix}{num}", False)
                ]
                try:
                    save_student_result(
                        student_id=sid,
                        test_id=int(st.session_state["active_test_id"]),
                        wrong_numbers=selected_wrong,
                    )
                    saved_students.append(s)
                    success_count += 1
                except Exception as e:
                    st.error(f"{sname} 저장 실패: {e}")
                    fail_count += 1

            sync_all_csvs()
            if success_count:
                st.session_state["batch_saved_students"] = saved_students
                st.session_state["batch_saved_test_id"] = int(st.session_state["active_test_id"])
                st.success(f"✅ {success_count}명 저장 완료!" + (f" ({fail_count}명 실패)" if fail_count else ""))
            elif fail_count:
                st.error(f"❌ 전원 저장 실패 ({fail_count}명)")

        # ── AI 코멘트 일괄 생성 + 보고서 일괄 생성 ──
        saved_students = st.session_state.get("batch_saved_students", [])
        saved_test_id = st.session_state.get("batch_saved_test_id")

        # 저장된 학생 없으면 현재 시험지 DB에서 자동 불러오기
        if not saved_students and st.session_state.get("active_test_id"):
            from db_connect import get_conn as _get_conn0
            _tid0 = int(st.session_state["active_test_id"])
            _conn0 = _get_conn0()
            try:
                _srows = _conn0.execute(
                    """SELECT sr.student_id, s.name, c.name as class_name
                       FROM student_results sr
                       JOIN students s ON s.id = sr.student_id
                       JOIN classes c ON c.id = s.class_id
                       WHERE sr.test_id = ?""", (_tid0,)
                ).fetchall()
            finally:
                _conn0.close()
            if _srows:
                saved_students = [
                    {"student_id": r[0], "student_name": r[1], "class_name": r[2], "class_id": 0}
                    for r in _srows
                ]
                st.session_state["batch_saved_students"] = saved_students
                st.session_state["batch_saved_test_id"] = _tid0
                saved_test_id = _tid0

        if saved_students and saved_test_id:
            st.markdown("---")
            st.markdown(f"#### ⑤ AI 코멘트 일괄 생성 — {len(saved_students)}명")

            from db_connect import get_conn as _get_conn2
            _conn2 = _get_conn2()
            try:
                _rows2 = _conn2.execute(
                    "SELECT score FROM student_results WHERE test_id = ?", (saved_test_id,)
                ).fetchall()
            finally:
                _conn2.close()
            all_scores_batch = [float(r[0]) for r in _rows2]

            gen_comments_btn = st.button(
                "✨ 전원 AI 코멘트 생성",
                use_container_width=True,
                key="batch_gen_comments_btn",
            )

            if gen_comments_btn:
                from claude_report import generate_teacher_comment_draft
                from database import get_student_profile, get_student_test_score_history
                progress = st.progress(0, text="AI 코멘트 생성 중...")
                total = len(saved_students)
                for i, s in enumerate(saved_students):
                    sid = s["student_id"]
                    sname = s["student_name"]
                    history = get_student_test_score_history(sid)
                    history_scores = [h["score"] for h in history]
                    record = get_student_result_record(student_id=sid, test_id=saved_test_id)
                    if not record:
                        continue
                    try:
                        rank_val = sum(1 for sc in all_scores_batch if sc > record["score"]) + 1 if all_scores_batch else None
                        total_val = len(all_scores_batch) if all_scores_batch else None
                        draft = generate_teacher_comment_draft(
                            student_name=sname,
                            score=record["score"],
                            class_avg=round(sum(all_scores_batch)/len(all_scores_batch), 1) if all_scores_batch else None,
                            rank=rank_val,
                            total_students=total_val,
                            wrong_numbers=record.get("wrong_numbers") or [],
                            total_questions=record.get("total_questions", 20),
                            history_scores=history_scores,
                            test_name=record["test_name"],
                        )
                        st.session_state[f"batch_comment_{sid}"] = draft
                    except Exception as e:
                        st.session_state[f"batch_comment_{sid}"] = ""
                        st.warning(f"{sname} 코멘트 생성 실패: {e}")
                    progress.progress((i + 1) / total, text=f"AI 코멘트 생성 중... ({i+1}/{total}명)")
                progress.empty()
                st.success(f"✅ {total}명 AI 코멘트 생성 완료! 아래에서 확인·수정 후 보고서를 생성하세요.")

            st.markdown("---")
            st.markdown("#### ⑥ 학생별 코멘트 확인 · 수정")
            for s in saved_students:
                sid = s["student_id"]
                sname = s["student_name"]
                cname = s["class_name"]
                comment_key = f"batch_comment_{sid}"

                if comment_key not in st.session_state:
                    st.session_state[comment_key] = ""

                with st.expander(f"💬 {cname} · {sname}", expanded=False):
                    st.text_area(
                        "선생님 코멘트",
                        height=120,
                        key=comment_key,
                        placeholder="AI 코멘트 생성 후 여기에 표시됩니다. 직접 입력도 가능합니다.",
                    )

            st.markdown("---")
            st.markdown("#### ⑦ 보고서 일괄 생성")
            col_opt1, col_opt2, col_opt3 = st.columns(3)
            with col_opt1:
                batch_show_avg = st.checkbox("반 평균 포함", value=True, key="batch_show_avg")
            with col_opt2:
                batch_show_rank = st.checkbox("반 석차 포함", value=True, key="batch_show_rank")
            with col_opt3:
                batch_show_chart = st.checkbox("누적 그래프 포함", value=True, key="batch_show_chart")

            gen_reports_btn = st.button(
                "🎨 전원 보고서 일괄 생성",
                type="primary",
                use_container_width=True,
                key="batch_gen_reports_btn",
            )

            if gen_reports_btn:
                from claude_report import generate_parent_report_html
                from database import get_student_profile, get_student_test_score_history
                import pathlib
                report_dir = pathlib.Path(__file__).parent / "reports"
                report_dir.mkdir(exist_ok=True)
                progress2 = st.progress(0, text="보고서 생성 중...")
                total2 = len(saved_students)
                generated = []
                for i, s in enumerate(saved_students):
                    sid = s["student_id"]
                    sname = s["student_name"]
                    cname = s["class_name"]
                    profile = get_student_profile(sid) or {}
                    school = str(profile.get("school", "") or "")
                    grade = str(profile.get("grade", "") or "")
                    history = get_student_test_score_history(sid)
                    record = get_student_result_record(student_id=sid, test_id=saved_test_id)
                    comment = st.session_state.get(f"batch_comment_{sid}", "").strip() or "선생님 코멘트를 입력해 주세요."
                    if not record:
                        st.warning(f"{sname} — DB 기록 없음, 건너뜁니다.")
                        continue
                    try:
                        html_content = generate_parent_report_html(
                            student_name=sname,
                            school=school or "—",
                            grade=grade or "—",
                            class_name=cname,
                            test_name=record["test_name"],
                            test_date=record["date"],
                            score=record["score"],
                            total_questions=record.get("total_questions", 20),
                            wrong_numbers=record.get("wrong_numbers") or [],
                            all_scores=all_scores_batch,
                            history=history,
                            teacher_comment=comment,
                            show_class_avg=batch_show_avg,
                            show_class_rank=batch_show_rank,
                            show_history_chart=batch_show_chart,
                            test_type="일반",
                            question_details=get_test_questions(saved_test_id),
                        )
                        fname = f"{sname}_{record['date']}_{record['test_name'][:15]}.html"
                        fname = fname.replace(" ", "_").replace("/", "-")
                        fpath = report_dir / fname
                        fpath.write_text(html_content, encoding="utf-8")
                        generated.append({"name": sname, "fname": fname, "html": html_content})
                    except Exception as e:
                        st.error(f"{sname} 보고서 생성 실패: {e}")
                    progress2.progress((i + 1) / total2, text=f"보고서 생성 중... ({i+1}/{total2}명)")
                progress2.empty()
                st.session_state["batch_generated_reports"] = generated
                st.success(f"✅ {len(generated)}명 보고서 생성 완료!")

            if st.session_state.get("batch_generated_reports"):
                st.markdown("##### 📥 보고서 다운로드")
                for rep in st.session_state["batch_generated_reports"]:
                    st.download_button(
                        label=f"⬇️ {rep['name']} 보고서",
                        data=rep["html"].encode("utf-8"),
                        file_name=rep["fname"],
                        mime="text/html",
                        key=f"batch_dl_{rep['fname']}",
                    )

        return True



@st.dialog("학부모용 리포트 미리보기", width="large")
def _parent_report_preview_dialog(
    *, student_id: int, test_id: int, record: dict[str, Any]
) -> None:
    """Claude API 기반 학부모용 HTML 보고서 생성 다이얼로그."""
    from database import get_student_profile
    from claude_report import generate_teacher_comment_draft, generate_parent_report_html

    profile = get_student_profile(student_id) or {}
    student_name = profile.get("student_name", "학생")
    class_name = profile.get("class_name", "")
    school = str(profile.get("school", "") or "")
    grade = str(profile.get("grade", "") or "")
    history = get_student_test_score_history(student_id)
    history_scores = [h["score"] for h in history]

    # 반 전체 점수 (석차/평균 계산용)
    from db_connect import get_conn as _get_conn3
    from database import ensure_ai_test_tables
    ensure_ai_test_tables()
    _conn = _get_conn3()
    try:
        _rows = _conn.execute(
            "SELECT score FROM student_results WHERE test_id = ?", (int(test_id),)
        ).fetchall()
    finally:
        _conn.close()
    all_scores = [float(r[0]) for r in _rows]

    st.markdown(f"### {student_name} · {record['test_name']}")
    st.caption(
        f"시험일 {record['date']} · 점수 **{record['score']:.1f}점** · 오답 {record['wrong_count']}문항"
        + (f" · {school} {grade}" if school else "")
    )
    st.markdown("---")

    # 시험 유형 선택
    test_type = st.radio(
        "시험 유형",
        ["일반", "종합"],
        horizontal=True,
        key="rpt_test_type",
    )

    # 포함 항목 선택
    st.markdown("##### 보고서 포함 항목")
    col_c1, col_c2, col_c3 = st.columns(3)
    with col_c1:
        show_avg = st.checkbox("반 평균", value=True, key="rpt_show_avg")
    with col_c2:
        show_rank = st.checkbox("반 석차", value=True, key="rpt_show_rank")
    with col_c3:
        show_chart = st.checkbox("누적 그래프", value=True, key="rpt_show_chart")

    st.markdown("---")

    # 선생님 코멘트
    st.markdown("##### 선생님 코멘트")
    if st.button("✨ AI 초안 생성", key="rpt_ai_draft_btn"):
        with st.spinner("Claude가 코멘트 초안을 작성 중입니다..."):
            try:
                rank_val = None
                total_val = None
                if all_scores:
                    rank_val = sum(1 for s in all_scores if s > record["score"]) + 1
                    total_val = len(all_scores)
                draft = generate_teacher_comment_draft(
                    student_name=student_name,
                    score=record["score"],
                    class_avg=round(sum(all_scores) / len(all_scores), 1) if all_scores else None,
                    rank=rank_val,
                    total_students=total_val,
                    wrong_numbers=record.get("wrong_numbers") or [],
                    total_questions=record.get("total_questions", 20),
                    history_scores=history_scores,
                    test_name=record["test_name"],
                )
                st.session_state["rpt_comment_draft"] = draft
                st.success("✅ AI 초안이 생성됐습니다. 아래에서 수정 후 보고서를 생성하세요.")
            except Exception as e:
                st.error(f"AI 초안 생성 실패: {e}")

    teacher_comment = st.text_area(
        "코멘트 내용 (AI 초안 생성 후 직접 수정 가능)",
        value=st.session_state.get("rpt_comment_draft", ""),
        height=150,
        placeholder="'✨ AI 초안 생성' 버튼을 눌러 초안을 먼저 만들거나, 직접 입력하세요.",
    )

    st.markdown("---")

    col_b1, col_b2 = st.columns(2)
    with col_b1:
        gen_btn = st.button("🎨 보고서 생성", type="primary", key="rpt_gen_btn")
    with col_b2:
        if st.button("닫기", key="rpt_close_btn"):
            st.rerun()

    if gen_btn:
        with st.spinner("보고서를 생성 중입니다... 잠시만 기다려주세요."):
            try:
                html_content = generate_parent_report_html(
                    student_name=student_name,
                    school=school or "—",
                    grade=grade or "—",
                    class_name=class_name,
                    test_name=record["test_name"],
                    test_date=record["date"],
                    score=record["score"],
                    total_questions=record.get("total_questions", 20),
                    wrong_numbers=record.get("wrong_numbers") or [],
                    all_scores=all_scores,
                    history=history,
                    teacher_comment=teacher_comment.strip() or "선생님 코멘트를 입력해 주세요.",
                    show_class_avg=show_avg,
                    show_class_rank=show_rank,
                    show_history_chart=show_chart,
                    test_type=test_type,
                    question_details=get_test_questions(int(test_id)),
                )
                import pathlib
                report_dir = pathlib.Path(__file__).parent / "reports"
                report_dir.mkdir(exist_ok=True)
                fname = f"{student_name}_{record['date']}_{record['test_name'][:20]}.html"
                fname = fname.replace(" ", "_").replace("/", "-")
                fpath = report_dir / fname
                fpath.write_text(html_content, encoding="utf-8")
                st.session_state["claude_report_html"] = html_content
                st.session_state["claude_report_fname"] = fname
                st.success("보고서 생성 완료! 아래에서 다운로드하세요.")
                st.download_button(
                    label="⬇️ HTML 보고서 다운로드",
                    data=html_content.encode("utf-8"),
                    file_name=fname,
                    mime="text/html",
                    key="rpt_download_btn",
                )
                st.markdown("##### 미리보기")
                components.html(html_content, height=700, scrolling=True)
            except Exception as exc:
                st.error(f"보고서 생성 실패: {exc}")


def _render_db_pdf_report_buttons() -> None:
    """Generate parent / wrong-answer PDFs from ``student_results`` (no OCR required)."""
    with st.container(border=True):
        st.markdown("#### PDF 보고서 (DB 기준)")
        st.caption(
            "**오답 DB 저장**으로 기록된 `student_results` 데이터만 사용합니다. "
            "OCR 분석 여부와 관계없이 생성할 수 있습니다."
        )

        if not _is_test_sheet_confirmed():
            st.info(
                "시험지를 **확정**하거나 **기존 시험지 불러오기**에서 선택해 주세요."
            )
            return

        sid = _current_student_id()
        test_id = st.session_state.get("active_test_id")
        if not sid:
            st.warning("PDF 생성을 위해 **학생**을 선택해 주세요.")
            return
        if not test_id:
            st.warning("활성 시험지(TEST)가 없습니다.")
            return

        record = get_student_result_record(student_id=int(sid), test_id=int(test_id))
        if record:
            st.success(
                f"DB 기록 확인 — **{record['test_name']}** · "
                f"{record['date']} · {record['score']:.1f}점 · "
                f"오답 {record['wrong_count']}개",
            )
        else:
            st.warning(
                "이 학생·시험지 조합의 `student_results` 기록이 없습니다. "
                "먼저 **오답 DB 저장**을 완료해 주세요."
            )

        btn_parent, btn_note = st.columns(2)
        with btn_parent:
            gen_parent = st.button(
                "학부모용 리포트 생성",
                type="primary",
                width="stretch",
                key="gen_parent_report_btn",
                disabled=record is None,
            )
        with btn_note:
            gen_note = st.button(
                "오답노트 생성",
                type="primary",
                width="stretch",
                key="gen_wrong_note_btn",
                disabled=record is None,
            )

        if gen_parent and record:
            _parent_report_preview_dialog(
                student_id=int(sid),
                test_id=int(test_id),
                record=record,
            )

        if gen_note:
            st.session_state["wrong_note_panel_open"] = True

        if st.session_state.get("wrong_note_panel_open") and record:
            _render_similar_questions_wrong_note_panel(
                student_id=int(sid),
                test_id=int(test_id),
                record=record,
            )

        dl1, dl2 = st.columns(2)
        with dl1:
            if st.session_state.get("ocr_parent_pdf_bytes") and st.session_state.get(
                "ocr_parent_pdf_fname"
            ):
                st.download_button(
                    "학부모용 리포트 다운로드",
                    data=st.session_state["ocr_parent_pdf_bytes"],
                    file_name=st.session_state["ocr_parent_pdf_fname"],
                    mime="application/pdf",
                    width="stretch",
                    key="dl_parent_report_btn",
                )
        with dl2:
            if st.session_state.get(
                "ocr_wrong_note_pdf_bytes"
            ) and st.session_state.get("ocr_wrong_note_pdf_fname"):
                st.download_button(
                    "오답노트 다운로드",
                    data=st.session_state["ocr_wrong_note_pdf_bytes"],
                    file_name=st.session_state["ocr_wrong_note_pdf_fname"],
                    mime="application/pdf",
                    width="stretch",
                    key="dl_wrong_note_btn",
                )


def _render_similar_questions_wrong_note_panel(
    *,
    student_id: int,
    test_id: int,
    record: dict[str, Any],
) -> None:
    """유사문제 추출 UI + 오답노트 PDF 생성 (DB placeholder)."""
    wrong_nums = record.get("wrong_numbers") or []
    questions = get_test_questions(test_id)
    topic_by_number = {
        int(q["question_number"]): {
            "topic": q["topic"],
            "difficulty": q["difficulty"],
        }
        for q in questions
    }

    with st.container(border=True):
        st.markdown("##### 오답노트 · 유사문제")
        if wrong_nums:
            st.caption(
                "틀린 문항: "
                + ", ".join(
                    f"{n}번 ({topic_by_number.get(n, {}).get('topic', '미분류')})"
                    for n in wrong_nums
                )
            )
        else:
            st.caption("기록된 오답 문항이 없습니다 (만점).")

        count_per = st.slider(
            "틀린 문항당 유사문제 수",
            min_value=1,
            max_value=3,
            step=1,
            key="similar_q_count_per_wrong",
            help="각 오답 번호마다 추출할 유사문제 개수 (1~3)",
        )

        extract_btn = st.button(
            "유사문제 추출",
            type="secondary",
            key="similar_q_extract_btn",
        )

        if extract_btn:
            count_per = int(st.session_state.get("similar_q_count_per_wrong", 1))
            result = fetch_similar_questions_for_wrong_numbers(
                wrong_numbers=wrong_nums,
                topic_by_number=topic_by_number,
                count_per_question=count_per,
                test_id=test_id,
            )
            st.session_state["similar_q_extract_result"] = result

        extract_result = st.session_state.get("similar_q_extract_result")
        if extract_result:
            if extract_result.get("status") == "db_not_ready":
                st.info(extract_result.get("message", SIMILAR_DB_UNAVAILABLE_MSG))
                for item in extract_result.get("items") or []:
                    probs = item.get("similar_problems") or []
                    st.markdown(
                        f"**{item.get('question_number')}번** · "
                        f"검색 단원 `{item.get('topic')}` · "
                        f"난이도 `{item.get('difficulty')}` · "
                        f"유사문제 {len(probs)}개"
                    )
                    for idx, prob in enumerate(probs, start=1):
                        with st.expander(
                            f"유사문제 {idx}"
                            + (
                                f"(매칭: {prob.get('matched_topic')} / "
                                f"{prob.get('matched_difficulty')})"
                                if prob.get("matched_topic")
                                else ""
                            )
                        ):
                            st.markdown(prob.get("stem") or "(내용 없음)")
                            if prob.get("answer"):
                                st.caption(f"정답: {prob['answer']}")
                            if prob.get("explanation"):
                                st.caption(f"해설: {prob['explanation']}")
            else:

                st.info(extract_result.get("message", ""))

        pdf_note_btn = st.button(
            "오답노트 PDF 생성 및 저장",
            type="primary",
            key="wrong_note_pdf_save_btn",
        )
        if pdf_note_btn:
            try:
                similar_for_pdf = prepare_similar_items_for_weasy(
                    st.session_state.get("similar_q_extract_result"),
                )
                print(
                    f"[wrong-note-pdf] app: passing {len(similar_for_pdf)} similar items "
                    f"to WeasyPrint PDF generator",
                    flush=True,
                )
                with st.spinner("오답노트 PDF 생성 중 (WeasyPrint)…"):
                    pdf_bytes, pdf_fname = generate_wrong_answer_note_pdf_from_db(
                        student_id,
                        test_id,
                        similar_questions=similar_for_pdf,
                    )
                    saved_path = save_pdf_to_configured_path(pdf_bytes, pdf_fname)
                st.session_state["ocr_wrong_note_pdf_bytes"] = pdf_bytes
                st.session_state["ocr_wrong_note_pdf_fname"] = pdf_fname
                st.success(f"오답노트 저장 완료: `{saved_path}`")
            except Exception as exc:
                st.error(f"오답노트 생성 실패: {exc}")
                if "WeasyPrint" in str(exc) or "weasyprint" in str(exc).lower():
                    st.info(
                        "WeasyPrint 설치: `pip install weasyprint jinja2` · "
                        "Windows는 GTK3 런타임이 필요합니다. "
                        "터미널 로그에 상세 안내가 출력됩니다.",
                    )


def _current_teacher_name() -> str:
    tid = _current_teacher_id()
    if tid is None:
        return "전체 보기"
    df = get_all_teachers()
    row = df[df["id"] == tid]
    return str(row.iloc[0]["name"]) if not row.empty else "전체 보기"


def _page_header(title: str, subtitle: str = "") -> None:
    """Consistent page title + subtitle block, with current teacher tag."""
    teacher_tag = (
        f"<span class='ferma-tag'> {_html_mod.escape(_current_teacher_name())}</span>"
    )
    st.markdown(
        f"<div class='ferma-page-head'>"
        f"<h2 class='ferma-page-title'>{_html_mod.escape(title)}</h2>"
        f"{teacher_tag}"
        f"</div>",
        unsafe_allow_html=True,
    )
    if subtitle:
        st.caption(subtitle)
    st.markdown("")


def _inject_theme() -> None:
    """Load global ``style.css`` — Ferma professional dashboard theme."""
    css_path = os.path.join(os.path.dirname(__file__), "style.css")
    try:
        with open(css_path, encoding="utf-8") as f:
            css = f.read()
    except OSError:
        css = ""
    if css.strip():
        st.markdown(f"<style>{css}</style>", unsafe_allow_html=True)

    # ── 버튼 스타일 보정 ──────────────────────────────────────
    st.markdown("""
    <style>
    /* 삭제류 버튼 — 빨간색 (key 클래스 방식) */
    div[class*="del_class_confirm_btn"] button,
    div[class*="nav_t_del_btn"] button,
    div[class*="del_student_btn"] button,
    div[class*="del_cls_"] button,
    div[class*="consult_del_"] button {
        background-color: #e53e3e !important;
        border-color: #c53030 !important;
        color: white !important;
    }
    div[class*="del_class_confirm_btn"] button:hover,
    div[class*="nav_t_del_btn"] button:hover,
    div[class*="del_student_btn"] button:hover,
    div[class*="del_cls_"] button:hover,
    div[class*="consult_del_"] button:hover {
        background-color: #c53030 !important;
        border-color: #9b2c2c !important;
    }

    /* ＋ 시간대 추가 버튼 — 파란 테두리 강조 */
    div[class*="dash_add_slot_btn"] button,
    div[class*="edit_add_slot_btn"] button {
        border: 2px solid #1a56db !important;
        color: #1a56db !important;
        font-weight: 600 !important;
    }
    </style>
    """, unsafe_allow_html=True)


def _extract_wrong_numbers_for_save(rep: dict) -> list[int]:
    """Resolve wrong-question numbers from OCR session state or report payload."""
    collected = st.session_state.get("ocr_selected_collected") or {}
    nums = collected.get("selected_numbers") or []
    if nums:
        return [int(n) for n in nums]

    parsed_ref = st.session_state.get("ocr_parsed_filtered_for_report") or {}
    nums = parsed_ref.get("selected_numbers") or []
    if nums:
        return [int(n) for n in nums]

    rep_nums = rep.get("selected_numbers") or []
    return [int(n) for n in rep_nums]


def _ocr_exam_name(default: str = "학습 분석 테스트") -> str:
    active = _active_test_meta()
    if active:
        return active["test_name"]
    return (st.session_state.get("ocr_exam_name") or "").strip() or default


def _resolve_student_score_for_report(rep: dict) -> float | None:
    """Student score: active TEST auto-calc → DB → report payload → None."""
    test_id = st.session_state.get("active_test_id")
    if test_id:
        meta = get_test_by_id(int(test_id))
        if meta:
            parsed = st.session_state.get("ocr_parsed_questions")
            wrong = _read_ocr_wrong_selection(parsed)
            return compute_score_from_wrong(meta["total_questions"], wrong)

    sid = st.session_state.get("_grade_report_student_id") or _current_student_id()
    exam_name = _ocr_exam_name()
    exam_date = date.today().isoformat()
    active = _active_test_meta()
    if active:
        exam_name = active["test_name"]
        exam_date = active["date"]
    if sid:
        entry = get_student_test_entry(int(sid), exam_name, exam_date)
        if entry and entry.get("score") is not None:
            return float(entry["score"])

    sc = rep.get("score_comparison") or {}
    return _parse_score_value(sc.get("student_score"))


def _apply_db_score_comparison(rep: dict) -> dict:
    """Fill ``score_comparison`` with DB class average and current student score."""
    _parsed_ref = st.session_state.get("ocr_parsed_filtered_for_report")
    class_id = st.session_state.get("ocr_selected_class_id")
    sid = st.session_state.get("_grade_report_student_id") or _current_student_id()
    exam_name = _ocr_exam_name()
    exam_date = date.today().isoformat()
    active = _active_test_meta()
    if active:
        exam_name = active["test_name"]
        exam_date = active["date"]
    wrong_numbers = _extract_wrong_numbers_for_save(rep)

    student_score = _resolve_student_score_for_report(rep)

    extra_scores: dict[int, float] | None = None
    if sid is not None and student_score is not None:
        extra_scores = {int(sid): float(student_score)}

    class_avg: float | None = None
    test_id = st.session_state.get("active_test_id")
    if test_id is not None:
        class_avg = get_test_average_score(
            int(test_id),
            extra_scores=extra_scores,
        )
    elif class_id is not None:
        class_avg = get_class_average_for_exam(
            int(class_id),
            exam_name,
            exam_date,
            extra_scores=extra_scores,
        )

    rep = ensure_score_comparison(
        rep,
        parsed_filtered=_parsed_ref,
        class_average=class_avg,
    )

    sc = dict(rep.get("score_comparison") or {})
    if student_score is not None:
        sc["student_score"] = round(float(student_score), 1)
    if class_avg is not None:
        sc["class_average"] = round(float(class_avg), 1)
        if student_score is not None:
            gap = float(student_score) - float(class_avg)
            sc["gap_comment"] = (
                f"응시 전체 평균 {class_avg:.0f}점 대비 "
                f"학생 {student_score:.0f}점 ({gap:+.0f}점)"
            )
        sc["is_estimated"] = False
        sc["source"] = "db_test_average" if test_id else "db_class_average"
    elif student_score is not None:
        sc.pop("class_average", None)
        sc["gap_comment"] = (
            f"학생 {student_score:.0f}점 · " "응시 전체 평균 (아직 저장된 데이터 없음)"
        )
        sc["is_estimated"] = bool(wrong_numbers)
        sc["source"] = "student_only"
    else:
        sc["source"] = sc.get("source") or "no_data"

    rep["score_comparison"] = sc
    return rep


def _finalize_grade_report(rep: dict) -> dict:
    """Normalize scores, persist to DB once, and sync session state."""
    rep = _apply_db_score_comparison(rep)
    _sid = st.session_state.get("_grade_report_student_id") or _current_student_id()
    _sname = _current_student_name()
    if _sid and _sname and _sname != "학생":
        rep["student_name"] = _sname
        rep["student_id"] = _sid
    st.session_state["parent_feedback_report"] = rep

    if st.session_state.pop("_grade_report_save_pending", False):
        active = _active_test_meta()
        exam_name = _ocr_exam_name()
        exam_date = active["date"] if active else date.today().isoformat()

        try:
            if _sid:
                wrong_numbers = _extract_wrong_numbers_for_save(rep)
                test_id = st.session_state.get("active_test_id")
                if test_id:
                    save_student_result(
                        student_id=int(_sid),
                        test_id=int(test_id),
                        wrong_numbers=wrong_numbers,
                    )
                else:
                    save_score = _resolve_student_score_for_report(rep)
                    if save_score is None:
                        from ocr_extract import estimate_scores_from_wrong_answers

                        est = estimate_scores_from_wrong_answers(wrong_numbers)
                        save_score = float(est.get("student_score", 0))
                    append_student_test_result(
                        student_id=_sid,
                        student_name=_sname if _sname != "학생" else None,
                        test_name=exam_name,
                        wrong_numbers=wrong_numbers,
                        score=float(save_score),
                        test_date=exam_date,
                    )
                st.session_state["_test_results_just_saved"] = True
                st.session_state.pop("test_results_save_error", None)
                sync_all_csvs()
        except Exception as test_err:
            st.session_state["test_results_save_error"] = str(test_err)

        rep = _apply_db_score_comparison(rep)
        st.session_state["parent_feedback_report"] = rep

        try:
            saved_id = save_grade_report(
                rep,
                student_id=_sid,
                exam_name=exam_name,
                exam_date=exam_date,
            )
            st.session_state["last_grade_report_id"] = saved_id
            st.session_state["_grade_report_just_saved"] = True
            st.session_state.pop("grade_report_save_error", None)
            sync_all_csvs()
        except Exception as save_err:
            st.session_state["grade_report_save_error"] = str(save_err)

    return rep


def _render_grade_analysis_report(rep: dict) -> None:
    """학부모 상담용 전문 성적 분석표 — 탭 + 카드 + Plotly 그래프."""

    rep = _finalize_grade_report(rep)
    _parsed_ref = st.session_state.get("ocr_parsed_filtered_for_report")

    rep_mode = rep.get("mode", "ai")
    student = _current_student_name() or rep.get("student_name") or "학생"

    sc = rep.get("score_comparison") or {}
    student_sc = _parse_score_value(sc.get("student_score"))
    class_sc = _parse_score_value(sc.get("class_average"))
    gap = (
        (student_sc - class_sc)
        if student_sc is not None and class_sc is not None
        else None
    )

    if st.session_state.get("grade_report_save_error"):
        st.warning(
            f"성적 DB 저장 실패: {st.session_state['grade_report_save_error']}",
        )
    elif st.session_state.pop("_grade_report_just_saved", False):
        st.caption(
            f"성적이 DB에 저장되었습니다 (기록 #{st.session_state.get('last_grade_report_id', '—')})"
        )

    if st.session_state.get("test_results_save_error"):
        st.warning(
            f"오답 기록 저장 실패: {st.session_state['test_results_save_error']}",
        )
    elif st.session_state.pop("_test_results_just_saved", False):
        st.caption("학생별 오답 번호가 test_results에 누적 저장되었습니다.")

    student_pill = f"{student_sc:.0f}점" if student_sc is not None else "—"
    class_pill = f"{class_sc:.0f}점" if class_sc is not None else "기록 없음"
    gap_pill = f"{gap:+.0f}점" if gap is not None else "—"

    st.markdown(
        f"""
        <div class="ferma-report-hero">
            <h3>{rep.get('title', '전문 성적 분석표')}</h3>
            <p>{student} 학생 · 학부모 상담용 AI 성적 분석</p>
            <span class="ferma-score-pill">학생 {student_pill}</span>
            <span class="ferma-score-pill">반 평균 {class_pill}</span>
            <span class="ferma-score-pill">격차 {gap_pill}</span>
        </div>
        """,
        unsafe_allow_html=True,
    )

    if rep_mode == "mock":
        st.info(
            "시뮬레이션 리포트 · `.env`에 OPENAI_API_KEY 설정 시 실제 AI 분석",
        )
    else:
        st.success("GPT-4o 분석 완료")

    tab_overview, tab_detail, tab_rx = st.tabs(
        [
            "총평 및 그래프",
            "상세 분석표",
            "학습 처방전",
        ]
    )

    with tab_overview:
        with st.container(border=True):
            st.markdown(
                '<p class="ferma-section-label">Section 1</p>', unsafe_allow_html=True
            )
            st.markdown("#### 종합 총평")
            st.markdown(format_section1_overview_md(rep))

        with st.container(border=True):
            st.markdown(
                '<p class="ferma-section-label">성취도 비교</p>', unsafe_allow_html=True
            )
            st.markdown("#### 학생 vs 반 평균")
            m1, m2, m3 = st.columns(3)
            m1.metric(
                "학생 점수",
                f"{student_sc:.0f}점" if student_sc is not None else "—",
                delta=f"{gap:+.0f} vs 평균" if gap is not None else None,
            )
            m2.metric(
                "반 평균",
                f"{class_sc:.0f}점" if class_sc is not None else "기록 없음",
            )
            m3.metric(
                "격차",
                f"{gap:+.0f}점" if gap is not None else "—",
            )

            score_fig = build_score_comparison_figure(
                report=rep,
                parsed_filtered=_parsed_ref,
                student_score=student_sc,
                class_average=class_sc,
            )
            if score_fig is not None:
                st.plotly_chart(
                    score_fig,
                    use_container_width=True,
                    key="score_compare_chart_main",
                )
            else:
                st.info("점수 데이터가 없어 그래프를 표시할 수 없습니다.")

            _history = get_student_grade_history(student, limit=10)
            if not _history.empty:
                with st.expander("과거 성적 이력 (DB)", expanded=False):
                    _disp = _history[
                        [
                            "exam_date",
                            "exam_name",
                            "student_score",
                            "class_average",
                            "score_gap",
                            "created_at",
                        ]
                    ].rename(
                        columns={
                            "exam_date": "시험일",
                            "exam_name": "시험명",
                            "student_score": "학생 점수",
                            "class_average": "반 평균",
                            "score_gap": "격차",
                            "created_at": "저장 시각",
                        }
                    )
                    st.dataframe(
                        _safe_streamlit_dataframe(_disp),
                        hide_index=True,
                        use_container_width=True,
                    )
                    if len(_history) >= 2:
                        st.caption(
                            f"최근 {len(_history)}회 기록 · "
                            f"평균 점수 {_history['student_score'].mean():.1f}점"
                        )

    with tab_detail:
        with st.container(border=True):
            st.markdown(
                '<p class="ferma-section-label">Section 2</p>', unsafe_allow_html=True
            )
            st.markdown("#### 단원별 오답 상세")
            st.markdown(format_section2_detail_md(rep))

    with tab_rx:
        with st.container(border=True):
            st.markdown(
                '<p class="ferma-section-label">Section 3</p>', unsafe_allow_html=True
            )
            st.markdown("#### 맞춤 학습 처방")
            st.markdown(format_section3_prescription_md(rep))

    with st.expander("전체 리포트 복사 (마크다운)", expanded=False):
        st.code(format_full_report_markdown(rep), language="markdown")


# ═══════════════════════════════════════════════════════════════
# Page: 학생 명부 (Student Directory)
# ═══════════════════════════════════════════════════════════════


def page_students():
    """학생 명부 — 학생 검색·반 배정 (강사 선택 시 ``classes.teacher_id`` JOIN 필터)."""
    teacher_id = _current_teacher_id()
    _page_header("학생 명부", "학생 명단을 조회하고 반 배정·삭제를 관리합니다.")

    classes_df = get_all_classes(teacher_id)
    assignable_classes = classes_df if teacher_id is not None else get_all_classes()
    class_options: dict[str, int | None] = {"— 반 미배정 —": None}
    for _, row in assignable_classes.iterrows():
        class_options[row["name"]] = int(row["id"])

    # ── 요약 메트릭 카드 ──────────────────────────────────
    df_scope = get_all_students(teacher_id)
    total = len(df_scope)
    unassigned = int(df_scope["class_id"].isna().sum()) if not df_scope.empty else 0
    with st.container(border=True):
        st.markdown("#### 명부 요약")
        m1, m2 = st.columns(2)
        m1.metric("학생 수", total)
        m2.metric("수업 수", len(classes_df))
        if total > 0:
            st.caption(f"반 미배정 학생 {unassigned}명")
        if teacher_id is not None:
            st.caption(f"강사 **{_current_teacher_name()}** 기준 통계")

    # ── 학생 목록 카드 ───────────────────────────────────────
    with st.container(border=True):
        st.markdown("#### 등록된 학생")
        df = get_all_students(teacher_id)
        if df.empty:
            if teacher_id is None:
                st.info("등록된 학생이 없습니다. 대시보드에서 학생을 등록해 보세요.")
            else:
                st.info("선택한 강사 담당 학생이 아직 없습니다.")
        else:
            fc, sc = st.columns([1, 1.5])
            with fc:
                class_filter = st.selectbox(
                    "반 필터",
                    ["전체 수업"] + list(classes_df["name"]),
                    key="students_class_filter",
                )
            with sc:
                search_query = st.text_input(
                    "이름 검색",
                    placeholder="이름을 입력하면 자동 필터링됩니다",
                    key="students_search",
                )

            view = df.copy()
            if class_filter != "전체 수업":
                view = view[view["class_name"] == class_filter]
            if search_query:
                view = view[
                    view["name"].str.contains(search_query, case=False, na=False)
                ]

            display_df = view[
                [
                    "name",
                    "parent_phone",
                    "class_name",
                    "teacher_name",
                    "registered_at",
                ]
            ].copy()
            display_df.columns = [
                "학생 이름",
                "학부모 연락처",
                "반",
                "담당 강사",
                "등록일",
            ]
            display_df = display_df.reset_index(drop=True)
            display_df.index += 1
            st.dataframe(display_df, width="stretch", hide_index=False)
            st.caption(f"총 {total}명 중 {len(display_df)}명 표시")

            # ── 학생 상세 정보 조회 ───────────────────────────
            st.markdown("##### 학생 상세 정보 조회")
            detail_opts = {
                f"{r['name']} · {r['class_name']}": int(r["id"])
                for _, r in view.iterrows()
            }
            if detail_opts:
                sel_detail = st.selectbox(
                    "학생 선택",
                    list(detail_opts.keys()),
                    key="students_detail_sel",
                )
                sel_detail_id = detail_opts[sel_detail]
                sel_detail_row = view[view["id"] == sel_detail_id].iloc[0]

                with st.container(border=True):
                    d1, d2 = st.columns(2)
                    with d1:
                        st.markdown(f"**이름:** {sel_detail_row.get('name', '—')}")
                        st.markdown(f"**학교:** {sel_detail_row.get('school', '—') or '—'}")
                        st.markdown(f"**학년:** {sel_detail_row.get('grade', '—') or '—'}")
                        st.markdown(f"**반:** {sel_detail_row.get('class_name', '—')}")
                        st.markdown(f"**담당강사:** {sel_detail_row.get('teacher_name', '—')}")
                        st.markdown(f"**등록일:** {sel_detail_row.get('registered_at', '—')}")
                    with d2:
                        st.markdown(f"**연락처:** {sel_detail_row.get('parent_phone', '—') or '—'}")
                        st.markdown(f"**내원 전 진도:** {sel_detail_row.get('pre_visit_progress', '—') or '—'}")
                        st.markdown(f"**바라는 점:** {sel_detail_row.get('expectations', '—') or '—'}")
                        st.markdown(f"**비고:** {sel_detail_row.get('notes', '—') or '—'}")

                    # 상담일지 최근 내용
                    logs_df = get_consultation_logs_for_student(sel_detail_id, None)
                    if not logs_df.empty:
                        show_logs = logs_df.head(3)
                        st.markdown(f"**📋 상담일지 ({len(show_logs)}건):**")
                        for _, lr in show_logs.iterrows():
                            st.caption(f"• {lr['created_at']} — {lr['note']}")

            with st.expander("학생 성적 통합 조회", expanded=False):
                grade_student_opts = {
                    f"{r['name']} · {r['class_name']}": int(r["id"])
                    for _, r in df.iterrows()
                }
                if grade_student_opts:
                    sel_grade_label = st.selectbox(
                        "학생 선택",
                        list(grade_student_opts.keys()),
                        key="students_unified_grade_sel",
                    )
                    sel_grade_sid = grade_student_opts[sel_grade_label]
                    sel_grade_name = sel_grade_label.split(" · ")[0]
                    _render_student_unified_grades(sel_grade_sid, sel_grade_name)

            with st.expander("학생 반 재배정"):
                student_options = {
                    f"{r['name']} (현재: {r['class_name']})": int(r["id"])
                    for _, r in df.iterrows()
                }
                if student_options:
                    sel_s = st.selectbox(
                        "학생 선택",
                        list(student_options.keys()),
                        key="reassign_student",
                    )
                    new_cl = st.selectbox(
                        "새 반",
                        list(class_options.keys()),
                        key="reassign_class",
                    )
                    if st.button("배정 변경", type="primary"):
                        assign_class(student_options[sel_s], class_options[new_cl])
                        st.success("반 배정이 업데이트되었습니다.")
                        st.rerun()

            with st.expander("학생 삭제"):
                remove_options = {
                    f"{r['name']} (ID: {r['id']})": int(r["id"])
                    for _, r in df.iterrows()
                }
                if remove_options:
                    sel_r = st.selectbox(
                        "삭제할 학생 선택",
                        list(remove_options.keys()),
                        key="remove_student",
                    )
                    if st.button("선택한 학생 삭제", key="del_student_btn", type="primary"):
                        delete_student(remove_options[sel_r])
                        st.warning(
                            f"**{sel_r.split('(ID')[0]}** 학생이 삭제되었습니다."
                        )
                        st.rerun()

    st.markdown("---")
    with st.container(border=True):
        st.markdown("#### AI 성적 기록 (DB)")
        st.caption(
            f"**{TEST_CLASS_NAME}** 반 학생 "
            f"({', '.join(TEST_STUDENT_NAMES)})의 저장된 성적 리포트입니다."
        )
        grade_df = get_all_grade_records(
            class_name=TEST_CLASS_NAME,
            student_names=TEST_STUDENT_NAMES,
            teacher_id=teacher_id,
        )
        if grade_df.empty:
            st.info(
                "아직 저장된 성적 기록이 없습니다. "
                "**성적 리포트 → 학원시험 AI분석** 탭에서 TEST를 확정하고 학생을 선택한 뒤 "
                "**통합보고서 작성** 탭에서 보고서를 생성해 주세요."
            )
        else:
            summary_cols = st.columns(len(TEST_STUDENT_NAMES))
            for i, name in enumerate(TEST_STUDENT_NAMES):
                sub = grade_df[grade_df["student_name"] == name]
                with summary_cols[i]:
                    st.metric(
                        f"학생 {name}",
                        f"{len(sub)}건",
                        delta=(
                            f"최근 {sub.iloc[0]['student_score']:.0f}점"
                            if not sub.empty
                            else None
                        ),
                    )

            disp = grade_df[
                [
                    "student_name",
                    "class_name",
                    "exam_date",
                    "student_score",
                    "class_average",
                    "score_gap",
                    "report_mode",
                    "created_at",
                ]
            ].rename(
                columns={
                    "student_name": "학생",
                    "class_name": "반",
                    "exam_date": "시험일",
                    "student_score": "학생 점수",
                    "class_average": "반 평균",
                    "score_gap": "격차",
                    "report_mode": "모드",
                    "created_at": "저장 시각",
                }
            )
            st.dataframe(disp, hide_index=True, use_container_width=True)
            st.caption(f"총 {len(grade_df)}건 · 학생별로 따로 저장됩니다.")


# ═══════════════════════════════════════════════════════════════
# Page: 상담 일지 (Consultation Log)
# ═══════════════════════════════════════════════════════════════


def page_consultation():
    """상담 일지 — 학생별 메모 (강사 선택 시 ``get_all_students`` + 로그 JOIN 필터)."""
    teacher_id = _current_teacher_id()
    _page_header(
        "상담 일지",
        "학생 진도, 학부모 상담, 행동 관찰 등의 짧은 메모를 시간 기록과 함께 보관합니다.",
    )

    students_for_log = get_all_students(teacher_id)
    if students_for_log.empty:
        st.info("등록된 학생이 없습니다. ** 학생 명부**에서 먼저 학생을 등록해 주세요.")
        return

    log_id_to_label = {
        int(r["id"]): f"{r['name']} (반: {r['class_name']}) · #{int(r['id'])}"
        for _, r in students_for_log.iterrows()
    }
    log_id_to_name = {int(r["id"]): r["name"] for _, r in students_for_log.iterrows()}

    with st.container(border=True):
        st.markdown("#### 학생 선택")
        log_sel_sid = st.selectbox(
            "상담 일지를 작성·열람할 학생",
            options=list(log_id_to_label.keys()),
            format_func=lambda sid: log_id_to_label[sid],
            key="consult_student_picker",
        )
    log_sel_name = log_id_to_name[log_sel_sid]
    cat_keys = list(CATEGORY_LABELS.keys())

    new_col, hist_col = st.columns([1.1, 1.4], gap="large")

    # ── 새 메모 카드 ───────────────────────────────────────
    with new_col:
        with st.container(border=True):
            st.markdown(f"#### {log_sel_name} 학생 새 상담 메모")
            with st.form(f"consult_form_{log_sel_sid}", clear_on_submit=True):
                c1, c2 = st.columns([1, 1])
                new_category = c1.selectbox(
                    "분류",
                    options=cat_keys,
                    format_func=lambda k: CATEGORY_LABELS[k],
                    key=f"consult_cat_{log_sel_sid}",
                )
                new_author = c2.text_input(
                    "작성자 (선택)",
                    placeholder="예: 김선생",
                    max_chars=40,
                    key=f"consult_auth_{log_sel_sid}",
                )
                new_note = st.text_area(
                    "메모 내용",
                    placeholder="예: 이번 주 응용문제 풀이 속도가 눈에 띄게 향상됨. "
                    "학부모께 칭찬 메시지 발송 예정.",
                    max_chars=2000,
                    height=160,
                    key=f"consult_note_{log_sel_sid}",
                )
                submitted = st.form_submit_button(
                    "메모 저장",
                    type="primary",
                    width="stretch",
                )
            if submitted:
                if not new_note.strip():
                    st.error("메모 내용을 입력해 주세요.")
                else:
                    try:
                        add_consultation_log(
                            log_sel_sid,
                            new_note,
                            new_category,
                            new_author or "",
                        )
                        st.success("상담 메모가 저장되었습니다.")
                        st.rerun()
                    except Exception as e:
                        st.error(f"저장 중 오류가 발생했습니다: {e}")

    # ── 이력 카드 ────────────────────────────────────────
    with hist_col:
        with st.container(border=True):
            st.markdown(f"#### {log_sel_name} 학생 상담 이력")
            logs_df = get_consultation_logs_for_student(log_sel_sid, teacher_id)
            if logs_df.empty:
                st.info(
                    "저장된 상담 메모가 없습니다. 왼쪽에서 첫 번째 메모를 작성해 보세요."
                )
            else:
                st.caption(f"총 {len(logs_df)}건 — 최신순")
                for _, lr in logs_df.iterrows():
                    lid = int(lr["id"])
                    cat_label = CATEGORY_LABELS.get(lr["category"], lr["category"])
                    author = lr["author"] or "—"
                    ts = lr["created_at"]
                    note_text = lr["note"]
                    with st.container(border=True):
                        h1, h2 = st.columns([4, 1])
                        h1.markdown(f"**{cat_label}**  ·   {ts}  ·   {author}")
                        with h2.popover("삭제", use_container_width=True):
                            st.warning("이 메모를 삭제하시겠습니까?")
                            if st.button(
                                "예, 삭제합니다",
                                key=f"consult_del_{lid}",
                                type="primary",
                                width="stretch",
                            ):
                                delete_consultation_log(lid)
                                st.success("메모가 삭제되었습니다.")
                                st.rerun()
                        st.markdown(note_text)


# ═══════════════════════════════════════════════════════════════
# Page: 수강료 관리 (Tuition)
# ═══════════════════════════════════════════════════════════════


def page_tuition():
    """수강료 관리 — 월별 납부 현황."""
    teacher_id = _current_teacher_id()
    _page_header("수강료 관리", "월별 수강료 납부 상태와 금액을 학생별로 기록합니다.")

    classes_df = get_all_classes(teacher_id)
    students_all = get_all_students(teacher_id)

    if students_all.empty:
        st.info("등록된 학생이 없습니다. ** 학생 명부**에서 먼저 학생을 등록해 주세요.")
        return

    # ── 조회 조건 카드 ──────────────────────────────────────
    with st.container(border=True):
        st.markdown("#### 조회 조건")
        fc, mc = st.columns([1.2, 1])
        with fc:
            class_opts: dict[str, int | None] = {"전체 수업": None}
            for _, r in classes_df.iterrows():
                class_opts[r["name"]] = int(r["id"])
            sel_class_label = st.selectbox(
                "반 선택", list(class_opts.keys()), key="tu_cls"
            )
            sel_class_id = class_opts[sel_class_label]
        with mc:
            default_month = date.today().strftime("%Y-%m")
            tuition_month = st.text_input(
                "월 (YYYY-MM)",
                value=default_month,
                key="tu_month",
                help="예: 2026-05",
            ).strip()

        try:
            datetime.strptime(tuition_month, "%Y-%m")
            month_valid = True
        except ValueError:
            st.error("월 형식이 올바르지 않습니다. YYYY-MM 형식으로 입력하세요.")
            month_valid = False

    if not month_valid:
        return

    # ── 요약 카드 ─────────────────────────────────────────
    summary = get_tuition_summary(tuition_month, teacher_id=teacher_id)
    with st.container(border=True):
        st.markdown(f"#### {tuition_month} 요약")
        sc1, sc2, sc3, sc4 = st.columns(4)
        sc1.metric("납부", summary["paid"])
        sc2.metric("미납", summary["pending"])
        sc3.metric("연체", summary["overdue"])
        sc4.metric(
            "납부 총액",
            f"{summary['total_amount']:,.0f}원" if summary["total_amount"] else "0원",
        )

    # ── 학생별 입력 카드 ──────────────────────────────────
    with st.container(border=True):
        st.markdown("#### 학생별 납부 상태")
        tuition_df = get_tuition_for_month(
            tuition_month, sel_class_id, teacher_id=teacher_id
        )
        if tuition_df.empty:
            st.info("선택한 조건에 해당하는 학생이 없습니다.")
            return

        status_labels_t = {"paid": "납부", "pending": "미납", "overdue": "연체"}
        status_keys_t = list(status_labels_t.keys())

        for _, r in tuition_df.iterrows():
            sid = int(r["student_id"])
            cur_status = r["status"] if r["status"] in status_keys_t else "pending"
            cur_amount = float(r["amount"] or 0)
            with st.container(border=True):
                hcol, sc, ac, btn = st.columns([2.2, 1.4, 1.4, 0.9])
                hcol.markdown(f"**{r['name']}**")
                new_status = sc.selectbox(
                    "상태",
                    options=status_keys_t,
                    format_func=lambda s: status_labels_t[s],
                    index=status_keys_t.index(cur_status),
                    key=f"tu_st_{sid}_{tuition_month}",
                )
                new_amount = ac.number_input(
                    "금액",
                    min_value=0.0,
                    value=cur_amount,
                    step=10000.0,
                    format="%.0f",
                    key=f"tu_amt_{sid}_{tuition_month}",
                )
                if btn.button(
                    "저장",
                    key=f"tu_save_{sid}_{tuition_month}",
                    width="stretch",
                    type="primary",
                ):
                    paid_dt = (
                        date.today().strftime("%Y-%m-%d")
                        if new_status == "paid"
                        else None
                    )
                    save_tuition_status(
                        sid,
                        tuition_month,
                        new_status,
                        amount=new_amount,
                        paid_date=paid_dt,
                    )
                    st.success(f"{r['name']} 수강료 상태가 저장되었습니다.")
                    st.rerun()


# ═══════════════════════════════════════════════════════════════
# Page: 대시보드 (Overview)
# ═══════════════════════════════════════════════════════════════


_DASHBOARD_MENUS: list[tuple[str, str]] = [
    ("notices", "전체 공지사항"),
    ("class_manage", "신규 수업"),
    ("new_student", "신규 학생 등록/배정"),
    ("overview", "전체 반 현황 / 강사별 현황"),
]


def _set_dashboard_menu(menu_key: str) -> None:
    st.session_state["dashboard_menu"] = menu_key


def _dashboard_new_student_form() -> None:
    """Dashboard [3] — 신규 학생 등록 / 반 배정 / 학생 정보 수정."""
    teacher_id = _current_teacher_id()
    classes_df = get_all_classes(teacher_id)
    class_options: dict[str, int | None] = {"— 반 미배정 —": None}
    for _, row in classes_df.iterrows():
        class_options[row["name"]] = int(row["id"])

    tab_new, tab_reassign, tab_edit = st.tabs(["신규 학생 등록", "반 재배정", "학생 정보 수정"])

    with tab_new:
        with st.container(border=True):
            st.markdown("#### 신규 학생 등록")
            st.caption("입력한 정보는 학생 데이터베이스에 저장됩니다.")
            with st.form("dashboard_new_student_form", clear_on_submit=True):
                c1, c2 = st.columns(2)
                with c1:
                    student_name = st.text_input("학생 이름 *", max_chars=40)
                    reg_date = st.date_input("등록날짜", value=date.today(), key="dash_intake_reg_date")
                    school = st.text_input("학교", max_chars=80, placeholder="예) 장충고등학교")
                    _all_grades = [
                        "초등학교 1학년", "초등학교 2학년", "초등학교 3학년",
                        "초등학교 4학년", "초등학교 5학년", "초등학교 6학년",
                        "중학교 1학년", "중학교 2학년", "중학교 3학년",
                        "고등학교 1학년", "고등학교 2학년", "고등학교 3학년",
                    ]
                    grade = st.selectbox(
                        "학년",
                        _all_grades,
                        index=6,
                        key="dash_intake_grade",
                    )
                with c2:
                    pre_visit = st.text_area("내원 전 진도", height=100, placeholder="현재 학습 진도, 취약 단원 등")
                    contact = st.text_input("학부모 연락처 *", max_chars=80, placeholder="010-0000-0000")
                    student_contact = st.text_input("학생 연락처", max_chars=80, placeholder="010-0000-0000")
                    expectations = st.text_area("바라는 점", height=100, placeholder="학부모·학생이 원하는 수업 방향")
                notes = st.text_area("비고", height=80)
                class_label = st.selectbox("배정 반 (선택)", list(class_options.keys()), key="dash_intake_class")
                submitted = st.form_submit_button("학생 등록", type="primary", use_container_width=True)

            if submitted:
                if not student_name.strip():
                    st.error("학생 이름을 입력해 주세요.")
                elif not contact.strip():
                    st.error("학생/학부모 연락처를 입력해 주세요.")
                else:
                    target_class_id = class_options[class_label]
                    add_student_intake(
                        name=student_name,
                        registered_at=reg_date.strftime("%Y-%m-%d"),
                        school=school,
                        grade=grade,
                        pre_visit_progress=pre_visit,
                        contact_info=contact,
                        student_phone=student_contact,
                        expectations=expectations,
                        notes=notes,
                        class_id=target_class_id,
                    )
                    st.success(f"**{student_name.strip()}** 학생이 등록되었습니다.")
                    st.rerun()

    with tab_reassign:
        with st.container(border=True):
            st.markdown("#### 기존 학생 반 재배정")
            students_df = get_all_students()
            if students_df.empty:
                st.info("등록된 학생이 없습니다.")
            else:
                student_opts = {
                    f"{r['name']} (현재: {r['class_name']})": int(r["id"])
                    for _, r in students_df.iterrows()
                }
                sel_s = st.selectbox("학생 선택", list(student_opts.keys()), key="dash_reassign_student")
                new_cl = st.selectbox("새 반", list(class_options.keys()), key="dash_reassign_class")
                if st.button("재배정", type="primary", key="dash_reassign_btn"):
                    assign_class(student_opts[sel_s], class_options[new_cl])
                    st.success("반 배정이 업데이트되었습니다.")
                    st.rerun()

    with tab_edit:
        with st.container(border=True):
            st.markdown("#### 학생 정보 수정")
            students_df = get_all_students()
            if students_df.empty:
                st.info("등록된 학생이 없습니다.")
            else:
                edit_opts = {
                    f"{r['name']} · {r['class_name']}": int(r["id"])
                    for _, r in students_df.iterrows()
                }
                sel_edit = st.selectbox("학생 선택", list(edit_opts.keys()), key="dash_edit_student")
                sel_edit_id = edit_opts[sel_edit]
                sel_row = students_df[students_df["id"] == sel_edit_id].iloc[0]

                st.markdown(f"**이름:** {sel_row['name']}  |  **반:** {sel_row['class_name']}  |  **연락처:** {sel_row.get('parent_phone', '')}")

                if st.button("수정하기", key="dash_edit_open_btn", type="primary"):
                    st.session_state["dash_edit_open"] = sel_edit_id

                if st.session_state.get("dash_edit_open") == sel_edit_id:
                    with st.form("dash_edit_student_form"):
                        ec1, ec2 = st.columns(2)
                        with ec1:
                            new_name = st.text_input("이름 *", value=str(sel_row.get("name", "")))
                            new_school = st.text_input("학교", value=str(sel_row.get("school", "") or ""), placeholder="예) 장충고등학교")
                            _edit_grade_all = [
                                "초등학교 1학년", "초등학교 2학년", "초등학교 3학년",
                                "초등학교 4학년", "초등학교 5학년", "초등학교 6학년",
                                "중학교 1학년", "중학교 2학년", "중학교 3학년",
                                "고등학교 1학년", "고등학교 2학년", "고등학교 3학년",
                            ]
                            _cur_grade = str(sel_row.get("grade", "") or "")
                            _edit_grade_idx = _edit_grade_all.index(_cur_grade) if _cur_grade in _edit_grade_all else 6
                            new_grade = st.selectbox(
                                "학년",
                                _edit_grade_all,
                                index=_edit_grade_idx,
                                key="dash_edit_grade_sel",
                            )
                            new_class = st.selectbox(
                                "배정 반",
                                list(class_options.keys()),
                                index=list(class_options.values()).index(
                                    int(sel_row["class_id"]) if sel_row.get("class_id") else None
                                ) if sel_row.get("class_id") in class_options.values() else 0,
                                key="dash_edit_class_sel",
                            )
                        with ec2:
                            new_phone = st.text_input("학부모 연락처 *", value=str(sel_row.get("parent_phone", "") or ""))
                            new_student_phone = st.text_input("학생 연락처", value=str(sel_row.get("student_phone", "") or ""))
                            new_pre = st.text_area("내원 전 진도", value=str(sel_row.get("pre_visit_progress", "") or ""), height=100)
                            new_exp = st.text_area("바라는 점", value=str(sel_row.get("expectations", "") or ""), height=100)
                        new_notes = st.text_area("비고", value=str(sel_row.get("notes", "") or ""), height=70)

                        if st.form_submit_button("저장", type="primary", use_container_width=True):
                            if _is_manager():
                                conn = get_conn()
                                conn.execute(
                                    """UPDATE students SET
                                        name=?, parent_phone=?, class_id=?,
                                        school=?, grade=?,
                                        pre_visit_progress=?, expectations=?, notes=?,
                                        student_phone=?
                                    WHERE id=?""",
                                    (
                                        new_name.strip(),
                                        new_phone.strip(),
                                        class_options[new_class],
                                        new_school.strip(),
                                        new_grade.strip(),
                                        new_pre.strip(),
                                        new_exp.strip(),
                                        new_notes.strip(),
                                        new_student_phone.strip(),
                                        sel_edit_id,
                                    ),
                                )
                                _commit(conn)
                                conn.close()
                                st.success("학생 정보가 수정되었습니다.")
                                st.session_state.pop("dash_edit_open", None)
                                st.rerun()
                            else:
                                st.error("수정 권한이 없습니다.")


def _dashboard_notices() -> None:
    """Dashboard [4] — weekly/monthly academy notices."""
    with st.container(border=True):
        st.markdown("#### 전체 공지사항")
        st.caption(
            "Weekly / Monthly 공지를 작성·저장합니다. DB에 저장되어 재접속 후에도 유지됩니다."
        )

        tab_weekly, tab_monthly = st.tabs(["Weekly", "Monthly"])

        with tab_weekly:
            with st.container(border=True):
                weekly_body, weekly_updated = get_academy_notice("weekly")
                if weekly_updated:
                    st.caption(f"마지막 저장: {weekly_updated}")
                with st.form("dash_notice_weekly_form"):
                    weekly_text = st.text_area(
                        "Weekly 공지",
                        value=weekly_body,
                        height=220,
                        placeholder="이번 주 학원 공지 사항을 입력하세요.",
                    )
                    if st.form_submit_button(
                        "저장", type="primary", use_container_width=True
                    ):
                        save_academy_notice("weekly", weekly_text)
                        st.success("Weekly 공지가 저장되었습니다.")
                        st.rerun()

        with tab_monthly:
            with st.container(border=True):
                monthly_body, monthly_updated = get_academy_notice("monthly")
                if monthly_updated:
                    st.caption(f"마지막 저장: {monthly_updated}")
                with st.form("dash_notice_monthly_form"):
                    monthly_text = st.text_area(
                        "Monthly 공지",
                        value=monthly_body,
                        height=220,
                        placeholder="이번 달 학원 공지 사항을 입력하세요.",
                    )
                    if st.form_submit_button(
                        "저장", type="primary", use_container_width=True
                    ):
                        save_academy_notice("monthly", monthly_text)
                        st.success("Monthly 공지가 저장되었습니다.")
                        st.rerun()


def _dashboard_placeholder(title: str, description: str) -> None:
    with st.container(border=True):
        st.markdown(f"#### {title}")
        st.info(description)


def _dashboard_class_manage() -> None:
    """대시보드 > 수업 관리 — 새 수업 만들기."""
    teacher_id = _current_teacher_id()
    teachers_df = get_all_teachers()

    DAY_OPTIONS = ["월", "화", "수", "목", "금", "토", "일"]
    _TIME_OPTS = [f"{h:02d}:{m:02d}" for h in range(9, 23) for m in (0, 30)]

    if "dash_class_slots" not in st.session_state:
        st.session_state["dash_class_slots"] = [{"days": [], "start": "17:00", "end": "18:30"}]

    with st.container(border=True):
        st.markdown("#### 새 수업 만들기")

        class_name = st.text_input("수업 이름", placeholder="예: 중1 심화반", max_chars=60, key="dash_class_name")

        st.markdown("**수업 요일 · 시간**")
        slots = st.session_state["dash_class_slots"]
        to_delete = None
        for idx, slot in enumerate(slots):
            sc1, sc2, sc3, sc4 = st.columns([2.5, 1.3, 1.3, 0.4])
            with sc1:
                slot["days"] = st.multiselect(
                    f"요일{idx+1}", DAY_OPTIONS,
                    default=slot.get("days", []),
                    key=f"dash_slot_days_{idx}",
                    label_visibility="collapsed",
                )
            with sc2:
                start_val = slot.get("start", "17:00")
                if start_val not in _TIME_OPTS:
                    start_val = "17:00"
                slot["start"] = st.selectbox(
                    f"시작{idx+1}", _TIME_OPTS,
                    index=_TIME_OPTS.index(start_val),
                    key=f"dash_slot_start_{idx}",
                    label_visibility="collapsed",
                )
            with sc3:
                end_val = slot.get("end", "18:30")
                if end_val not in _TIME_OPTS:
                    end_val = "18:30"
                slot["end"] = st.selectbox(
                    f"종료{idx+1}", _TIME_OPTS,
                    index=_TIME_OPTS.index(end_val),
                    key=f"dash_slot_end_{idx}",
                    label_visibility="collapsed",
                )
            with sc4:
                if len(slots) > 1:
                    if st.button("✕", key=f"dash_del_slot_{idx}", help="삭제"):
                        to_delete = idx
        if to_delete is not None:
            st.session_state["dash_class_slots"].pop(to_delete)
            st.rerun()

        if st.button("＋ 시간대 추가", key="dash_add_slot_btn", use_container_width=True, type="primary"):
            st.session_state["dash_class_slots"].append({"days": [], "start": "17:00", "end": "18:30"})
            st.rerun()

        class_desc = st.text_input("기타 설명 (선택)", placeholder="예: 중학교 1학년 대상", max_chars=100, key="dash_class_desc")

        teacher_opts: dict[str, int | None] = {"— 담당 강사 미지정 —": None}
        for _, t in teachers_df.iterrows():
            teacher_opts[t["name"]] = int(t["id"])
        default_idx = 0
        if teacher_id is not None:
            vals = list(teacher_opts.values())
            if teacher_id in vals:
                default_idx = vals.index(teacher_id)
        sel_teacher_label = st.selectbox("담당 강사", list(teacher_opts.keys()), index=default_idx, key="dash_class_teacher")

        if st.button("수업 생성", type="primary", use_container_width=True, key="dash_create_class_btn"):
            if not class_name.strip():
                st.error("수업 이름을 입력해 주세요.")
            else:
                import json as _json
                schedule_json_slots = []
                for sl in st.session_state["dash_class_slots"]:
                    days_list = sl.get("days") or []
                    start_s = sl.get("start", "")
                    end_s = sl.get("end", "")
                    for d in days_list:
                        schedule_json_slots.append({"day": d, "start": start_s, "end": end_s})
                schedule_json = _json.dumps(schedule_json_slots, ensure_ascii=False)
                pure_desc = class_desc.strip()
                try:
                    add_class(class_name.strip(), pure_desc, teacher_opts[sel_teacher_label], schedule_json)
                    st.session_state["dash_class_slots"] = [{"days": [], "start": "17:00", "end": "18:30"}]
                    st.success(f"수업 **{class_name.strip()}** 이(가) 생성되었습니다.")
                    st.rerun()
                except Exception:
                    st.error("같은 이름의 수업이 이미 존재합니다.")


def _dashboard_overview_combined() -> None:
    """대시보드 > 전체 반 현황 / 강사별 현황."""
    tab1, tab2 = st.tabs(["전체 반 현황", "강사별 현황"])
    with tab1:
        _dashboard_all_classes()
    with tab2:
        _dashboard_by_teacher()


def page_dashboard_overview():
    """대시보드 — 4개 운영 메뉴 (고도화 전략)."""
    _page_header(
        "대시보드",
        f"오늘 {date.today().strftime('%Y년 %m월 %d일')} — 학원 운영 메뉴",
    )

    if "dashboard_menu" not in st.session_state:
        st.session_state["dashboard_menu"] = "notices"

    with st.container(border=True):
        st.markdown("#### 메뉴")
        menu_cols = st.columns(len(_DASHBOARD_MENUS))
        active = st.session_state["dashboard_menu"]
        for col, (menu_key, menu_label) in zip(menu_cols, _DASHBOARD_MENUS):
            with col:
                st.button(
                    menu_label,
                    key=f"dash_menu_{menu_key}",
                    use_container_width=True,
                    type="primary" if active == menu_key else "secondary",
                    on_click=_set_dashboard_menu,
                    args=(menu_key,),
                )

    selected = st.session_state["dashboard_menu"]
    if selected == "notices":
        _dashboard_notices()
    elif selected == "class_manage":
        _dashboard_class_manage()
    elif selected == "new_student":
        _dashboard_new_student_form()
    elif selected == "overview":
        _dashboard_overview_combined()


def _parse_schedule_label(schedule_json: str) -> str:
    """schedule JSON → '월 16:00~18:00 / 목 16:00~18:00' 형태."""
    import json as _json
    try:
        slots = _json.loads(schedule_json or "[]")
        if not slots:
            return "시간 미설정"
        return " / ".join(f"{s['day']} {s['start']}~{s['end']}" for s in slots)
    except Exception:
        return "시간 미설정"


def _build_class_overview_df(teacher_id: int | None = None) -> pd.DataFrame:
    """반별 현황 표 — ``get_all_classes`` + ``get_all_students`` 조합."""
    classes_df = get_all_classes(teacher_id)
    if classes_df.empty:
        return pd.DataFrame(columns=["반 이름", "수업 시간", "인원수", "담당 강사", "현재 진도"])

    students_df = get_all_students(teacher_id)
    count_by_class: dict[int, int] = {}
    if not students_df.empty and "class_id" in students_df.columns:
        grouped = students_df.dropna(subset=["class_id"]).groupby("class_id").size()
        count_by_class = {int(k): int(v) for k, v in grouped.items()}

    rows: list[dict[str, object]] = []
    for _, cls in classes_df.iterrows():
        cid = int(cls["id"])
        desc = str(cls.get("description") or "").strip()
        # 기존 DB에 '매주 월·수 16:00~18:00' 형태로 저장된 경우 진도로 표시 안 함
        import re as _re
        if _re.match(r"^매주\s", desc) or _re.match(r"^\d{2}:\d{2}", desc):
            desc = ""
        schedule = _parse_schedule_label(str(cls.get("schedule") or "[]"))
        rows.append(
            {
                "반 이름": cls["name"],
                "수업 시간": schedule,
                "인원수": count_by_class.get(cid, 0),
                "담당 강사": cls["teacher_name"],
                "현재 진도": desc if desc else "—",
            }
        )
    return pd.DataFrame(rows)


def _dashboard_all_classes() -> None:
    """Dashboard [2] — all classes overview table."""
    overview_df = _build_class_overview_df(teacher_id=None)
    classes_df = get_all_classes()

    with st.container(border=True):
        st.markdown("#### 전체 반 현황")
        st.caption("등록된 모든 반의 인원·담당 강사·진도를 표시합니다.")

        if overview_df.empty:
            st.info(
                "등록된 반이 없습니다. 「내 수업 관리」에서 반을 먼저 만들어 주세요."
            )
            return

        total_students = int(overview_df["인원수"].sum())
        m1, m2 = st.columns(2)
        m1.metric("총 반 수", len(overview_df))
        m2.metric("총 학생 수", total_students)

    with st.container(border=True):
        st.markdown("#### 반 목록")
        st.dataframe(
            overview_df,
            hide_index=True,
            use_container_width=True,
            column_config={
                "인원수": st.column_config.NumberColumn("인원수", format="%d명"),
            },
        )

    # 반 선택 → 학생명단 + 상담일지
    if not classes_df.empty:
        class_opts = {"— 반을 선택하세요 —": None}
        for _, r in classes_df.iterrows():
            class_opts[r["name"]] = int(r["id"])

        sel_cls_label = st.selectbox(
            "반 선택 (학생명단·상담일지 확인)",
            list(class_opts.keys()),
            key="all_classes_detail_sel",
        )
        sel_cls_id = class_opts[sel_cls_label]

        if sel_cls_id is not None:
            stu_df = get_students_by_class(sel_cls_id)

            col_a, col_b = st.columns(2)

            with col_a:
                with st.container(border=True):
                    st.markdown(f"##### {sel_cls_label} — 학생명단")
                    if stu_df.empty:
                        st.info("배정된 학생이 없습니다.")
                    else:
                        for _, srow in stu_df.iterrows():
                            grade = str(srow.get("grade", "") or "").strip()
                            name = str(srow.get("name", ""))
                            label = f"{grade} · {name}" if grade else name
                            st.write(f"• {label}")

            with col_b:
                with st.container(border=True):
                    st.markdown(f"##### {sel_cls_label} — 상담일지")
                    if stu_df.empty:
                        st.info("배정된 학생이 없습니다.")
                    else:
                        _CAT = {
                            "general": "일반", "progress": "진도",
                            "parent": "학부모", "behavior": "태도/행동", "other": "기타"
                        }
                        has_any = False
                        for _, srow in stu_df.iterrows():
                            logs_df = get_consultation_logs_for_student(int(srow["id"]), None)
                            if not logs_df.empty:
                                has_any = True
                                with st.expander(f"📋 {srow['name']} ({len(logs_df)}건)"):
                                    for _, log in logs_df.iterrows():
                                        cat_label = _CAT.get(str(log.get("category", "")), log.get("category", ""))
                                        st.markdown(
                                            f"**{log.get('created_at', '')}** `{cat_label}`  \n{log.get('note', '')}"
                                        )
                                        st.divider()
                        if not has_any:
                            st.info("등록된 상담일지가 없습니다.")

        # ⑧ 수업 삭제 및 강사 재배정 (관리자 이상만)
        if _is_manager():
            with st.expander("수업 수정 및 강사 재배정"):
                if not classes_df.empty:
                    all_teachers_df = get_all_teachers()
                    tabs8 = st.tabs(["수업 삭제", "강사 재배정", "수업 수정"])

                    with tabs8[0]:
                        del_opts = {r["name"]: int(r["id"]) for _, r in classes_df.iterrows()}
                        sel_del_cls = st.selectbox("삭제할 반 선택", list(del_opts.keys()), key="del_class_sel")
                        st.warning(f"**{sel_del_cls}** 반을 삭제하면 학생 배정 정보도 함께 사라집니다.")
                        if st.button("삭제 확인", key="del_class_confirm_btn", type="primary"):
                            conn = get_conn()
                            conn.execute("DELETE FROM classes WHERE id = ?", (del_opts[sel_del_cls],))
                            _commit(conn)
                            conn.close()
                            st.warning(f"**{sel_del_cls}** 반이 삭제되었습니다.")
                            st.rerun()

                    with tabs8[1]:
                        reassign_opts = {r["name"]: int(r["id"]) for _, r in classes_df.iterrows()}
                        sel_reassign_cls = st.selectbox("재배정할 반 선택", list(reassign_opts.keys()), key="reassign_class_sel")
                        sel_cls_row = classes_df[classes_df["id"] == reassign_opts[sel_reassign_cls]]
                        current_teacher = sel_cls_row["teacher_name"].values[0] if not sel_cls_row.empty else "—"
                        st.info(f"현재 담당 강사: **{current_teacher}**")

                        teacher_opts2: dict[str, int | None] = {"— 미지정 —": None}
                        for _, t in all_teachers_df.iterrows():
                            teacher_opts2[t["name"]] = int(t["id"])
                        sel_new_teacher = st.selectbox("새 담당 강사", list(teacher_opts2.keys()), key="reassign_teacher_sel")

                        if st.button("강사 재배정 확인", key="reassign_teacher_btn", type="primary"):
                            new_tid = teacher_opts2[sel_new_teacher]
                            conn = get_conn()
                            conn.execute(
                                "UPDATE classes SET teacher_id = ? WHERE id = ?",
                                (new_tid, reassign_opts[sel_reassign_cls]),
                            )
                            _commit(conn)
                            conn.close()
                            st.success(f"**{sel_reassign_cls}** 반의 담당 강사가 **{sel_new_teacher}**(으)로 변경되었습니다.")
                            st.rerun()

                    with tabs8[2]:  # ── 수업 수정 ──
                        import json as _json
                        DAY_OPTIONS = ["월", "화", "수", "목", "금", "토", "일"]
                        _TIME_OPTS = [f"{h:02d}:{m:02d}" for h in range(9, 23) for m in (0, 30)]

                        edit_opts = {r["name"]: int(r["id"]) for _, r in classes_df.iterrows()}
                        sel_edit_cls = st.selectbox("수정할 반 선택", list(edit_opts.keys()), key="edit_class_sel")
                        sel_edit_id = edit_opts[sel_edit_cls]
                        edit_row = classes_df[classes_df["id"] == sel_edit_id].iloc[0]

                        # 반 선택이 바뀌면 세션 초기화
                        if st.session_state.get("edit_class_prev") != sel_edit_id:
                            st.session_state["edit_class_prev"] = sel_edit_id
                            # schedule 파싱해서 slots 초기화
                            try:
                                raw_slots = _json.loads(edit_row.get("schedule") or "[]")
                            except Exception:
                                raw_slots = []
                            # 같은 (start, end) 묶기
                            grouped: dict[tuple, list] = {}
                            for s in raw_slots:
                                key = (s.get("start", "17:00"), s.get("end", "18:30"))
                                grouped.setdefault(key, []).append(s.get("day", ""))
                            if grouped:
                                init_slots = [{"days": days, "start": k[0], "end": k[1]}
                                              for k, days in grouped.items()]
                            else:
                                init_slots = [{"days": [], "start": "17:00", "end": "18:30"}]
                            st.session_state["edit_class_slots"] = init_slots
                            st.rerun()

                        # 현재 값으로 폼 표시
                        edit_name = st.text_input("수업 이름", value=str(edit_row.get("name") or ""),
                                                  max_chars=60, key="edit_class_name")

                        st.markdown("**수업 요일 · 시간**")
                        slots_e = st.session_state.get("edit_class_slots",
                                                        [{"days": [], "start": "17:00", "end": "18:30"}])
                        to_del_e = None
                        for idx, slot in enumerate(slots_e):
                            ec1, ec2, ec3, ec4 = st.columns([2.5, 1.3, 1.3, 0.4])
                            with ec1:
                                slot["days"] = st.multiselect(
                                    f"요일{idx+1}", DAY_OPTIONS,
                                    default=slot.get("days", []),
                                    key=f"edit_slot_days_{sel_edit_id}_{idx}",
                                    label_visibility="collapsed",
                                )
                            with ec2:
                                sv = slot.get("start", "17:00")
                                if sv not in _TIME_OPTS: sv = "17:00"
                                slot["start"] = st.selectbox(
                                    f"시작{idx+1}", _TIME_OPTS, index=_TIME_OPTS.index(sv),
                                    key=f"edit_slot_start_{sel_edit_id}_{idx}",
                                    label_visibility="collapsed",
                                )
                            with ec3:
                                ev = slot.get("end", "18:30")
                                if ev not in _TIME_OPTS: ev = "18:30"
                                slot["end"] = st.selectbox(
                                    f"종료{idx+1}", _TIME_OPTS, index=_TIME_OPTS.index(ev),
                                    key=f"edit_slot_end_{sel_edit_id}_{idx}",
                                    label_visibility="collapsed",
                                )
                            with ec4:
                                if len(slots_e) > 1:
                                    if st.button("✕", key=f"edit_del_slot_{sel_edit_id}_{idx}"):
                                        to_del_e = idx
                        if to_del_e is not None:
                            st.session_state["edit_class_slots"].pop(to_del_e)
                            st.rerun()

                        if st.button("＋ 시간대 추가", key="edit_add_slot_btn", use_container_width=True, type="primary"):
                            st.session_state["edit_class_slots"].append({"days": [], "start": "17:00", "end": "18:30"})
                            st.rerun()

                        edit_desc = st.text_input("기타 설명 (선택)",
                                                  value=str(edit_row.get("description") or ""),
                                                  max_chars=100, key="edit_class_desc")

                        teacher_opts_e: dict[str, int | None] = {"— 담당 강사 미지정 —": None}
                        for _, t in all_teachers_df.iterrows():
                            teacher_opts_e[t["name"]] = int(t["id"])
                        cur_tid = edit_row.get("teacher_id")
                        cur_t_idx = 0
                        for i, v in enumerate(teacher_opts_e.values()):
                            if v == cur_tid:
                                cur_t_idx = i
                                break
                        sel_edit_teacher = st.selectbox("담당 강사", list(teacher_opts_e.keys()),
                                                        index=cur_t_idx, key="edit_class_teacher")

                        st.markdown("---")
                        btn_c1, btn_c2 = st.columns(2)
                        with btn_c1:
                            if st.button("✕ 취소", key="edit_class_cancel_btn", use_container_width=True, type="secondary"):
                                st.session_state.pop("edit_class_prev", None)
                                st.session_state.pop("edit_class_slots", None)
                                st.rerun()
                        with btn_c2:
                            if st.button("✔ 수정 확인", key="edit_class_confirm_btn",
                                         type="primary", use_container_width=True):
                                if not edit_name.strip():
                                    st.error("수업 이름을 입력해 주세요.")
                                else:
                                    new_slots = []
                                    for sl in st.session_state.get("edit_class_slots", []):
                                        for d in (sl.get("days") or []):
                                            new_slots.append({"day": d,
                                                              "start": sl.get("start", ""),
                                                              "end": sl.get("end", "")})
                                    new_schedule = _json.dumps(new_slots, ensure_ascii=False)
                                    new_tid = teacher_opts_e[sel_edit_teacher]
                                    conn = get_conn()
                                    conn.execute(
                                        "UPDATE classes SET name=?, description=?, teacher_id=?, schedule=? WHERE id=?",
                                        (edit_name.strip(), edit_desc.strip(), new_tid, new_schedule, sel_edit_id),
                                    )
                                    _commit(conn)
                                    conn.close()
                                    st.session_state.pop("edit_class_prev", None)
                                    st.session_state.pop("edit_class_slots", None)
                                    st.success(f"**{edit_name.strip()}** 반 정보가 수정되었습니다.")
                                    st.rerun()


def _dashboard_by_teacher() -> None:
    """Dashboard [3] — classes filtered by selected teacher."""
    teachers_df = get_all_teachers()

    with st.container(border=True):
        st.markdown("#### 강사별 현황")
        st.caption("강사를 선택하면 담당 반·학생 수·진도가 필터링됩니다.")

        if teachers_df.empty:
            st.info(
                "등록된 강사가 없습니다. 왼쪽 「강사 추가 / 관리」에서 먼저 등록해 주세요."
            )
            return

        teacher_opts = {str(r["name"]): int(r["id"]) for _, r in teachers_df.iterrows()}
        labels = list(teacher_opts.keys())

        nav_tid = _current_teacher_id()
        default_label = next(
            (lbl for lbl, tid in teacher_opts.items() if tid == nav_tid),
            labels[0],
        )
        sel_label = st.selectbox(
            "강사 선택",
            labels,
            index=labels.index(default_label),
            key="dash_teacher_overview_sel",
        )
        sel_tid = teacher_opts[sel_label]

    overview_df = _build_class_overview_df(teacher_id=sel_tid)

    with st.container(border=True):
        st.markdown(f"#### {sel_label} — 담당 반")
        if overview_df.empty:
            st.info(f"**{sel_label}** 강사에게 배정된 반이 없습니다.")
            return

        total_students = int(overview_df["인원수"].sum())
        s1, s2 = st.columns(2)
        s1.metric("담당 반 수", len(overview_df))
        s2.metric("담당 학생 수", total_students)

        st.dataframe(
            overview_df,
            hide_index=True,
            use_container_width=True,
            column_config={
                "인원수": st.column_config.NumberColumn("인원수", format="%d명"),
            },
        )

        # 반별 학생 목록 (학년 + 이름)
        teacher_classes_df = get_all_classes(teacher_id=sel_tid)
        if not teacher_classes_df.empty:
            st.markdown("---")
            st.markdown("**반별 학생 목록**")
            for _, cls_row in teacher_classes_df.iterrows():
                cid = int(cls_row["id"])
                stu_list = get_students_by_class(cid)
                with st.expander(f"{cls_row['name']} ({len(stu_list)}명)"):
                    if stu_list.empty:
                        st.info("배정된 학생이 없습니다.")
                    else:
                        for _, srow in stu_list.iterrows():
                            grade = str(srow.get("grade", "") or "").strip()
                            label = f"{grade} · {srow['name']}" if grade else srow['name']
                            st.write(f"• {label}")


# ═══════════════════════════════════════════════════════════════
# Page: Classes
# ═══════════════════════════════════════════════════════════════


def page_classes():
    """내 수업 관리 — 강사별 수업(반) 생성·수정·삭제."""
    _page_header("내 수업 관리", "강의 클래스를 만들고 담당 강사·학생 수를 관리합니다.")

    teachers_df = get_all_teachers()

    # 권한에 따라 teacher_id 결정
    if _is_manager():
        # 관리자/부원장/원장: 강사 필터 selectbox 노출
        teacher_filter_opts: dict[str, int | None] = {"전체 수업": None}
        for _, t in teachers_df.iterrows():
            teacher_filter_opts[t["name"]] = int(t["id"])
        sel_filter = st.selectbox("강사 필터", list(teacher_filter_opts.keys()), key="cls_teacher_filter")
        teacher_id = teacher_filter_opts[sel_filter]
    else:
        # 강사: 본인 수업만
        teacher_id = _current_teacher_id()

    teachers_df = get_all_teachers()
    with st.container(border=True):
        st.markdown("#### 등록된 수업")
        classes_df = get_all_classes(teacher_id)
        students_df = get_all_students(teacher_id)
        if classes_df.empty:
            if teacher_id is None:
                st.info(
                    "등록된 수업이 없습니다. 왼쪽 양식으로 첫 수업을 만들어 보세요."
                )
            else:
                st.info("선택한 강사에게 배정된 수업이 없습니다.")
        else:
            for _, cls in classes_df.iterrows():
                cls_id = int(cls["id"])
                count = (
                    len(students_df[students_df["class_name"] == cls["name"]])
                    if not students_df.empty
                    else 0
                )
                with st.container(border=True):
                    hcol, info_col, cnt_col, act_col = st.columns(
                        [2.5, 1.5, 0.9, 1.3]
                    )
                    with hcol:
                        st.markdown(f"**{cls['name']}**")
                        if cls["description"]:
                            st.caption(cls["description"])
                    info_col.markdown(
                        f"<small> 담당<br/>**{cls['teacher_name']}**</small>",
                        unsafe_allow_html=True,
                    )
                    # 학생수 버튼
                    with cnt_col:
                        if st.button(
                            f"👥 {count}명",
                            key=f"cls_cnt_btn_{cls_id}",
                            use_container_width=True,
                        ):
                            cur = st.session_state.get("cls_open_id")
                            st.session_state["cls_open_id"] = cls_id if cur != cls_id else None
                            st.session_state.pop(f"cls_student_detail_{cls_id}", None)

                    with act_col:
                        with st.popover("강사 변경", use_container_width=True):
                            t_opts2 = {"— 미지정 —": None}
                            for _, t in teachers_df.iterrows():
                                t_opts2[t["name"]] = int(t["id"])
                            cur_tid = (
                                int(cls["teacher_id"])
                                if pd.notna(cls["teacher_id"])
                                else None
                            )
                            vals = list(t_opts2.values())
                            idx = vals.index(cur_tid) if cur_tid in vals else 0
                            new_t_label = st.selectbox(
                                "강사 선택",
                                list(t_opts2.keys()),
                                index=idx,
                                key=f"cls_t_{cls_id}",
                            )
                            if st.button(
                                "저장",
                                key=f"cls_t_save_{cls_id}",
                                type="primary",
                                use_container_width=True,
                            ):
                                assign_teacher_to_class(
                                    cls_id, t_opts2[new_t_label]
                                )
                                st.success("강사 배정이 변경되었습니다.")
                                st.rerun()
                        if st.button(
                            "삭제",
                            key=f"del_cls_{cls_id}",
                            use_container_width=True,
                            type="primary",
                        ):
                            delete_class(cls_id)
                            st.warning(
                                f"수업 **{cls['name']}** 이(가) 삭제되었습니다."
                            )
                            st.rerun()

                # ── 학생 리스트 (버튼 클릭 시 펼침) ─────────────
                if st.session_state.get("cls_open_id") == cls_id:
                    cls_students = students_df[students_df["class_name"] == cls["name"]] if not students_df.empty else pd.DataFrame()
                    st.markdown(f"##### 📋 {cls['name']} 학생 명단 ({count}명)")
                    if cls_students.empty:
                        st.info("이 반에 배정된 학생이 없습니다.")
                    else:
                        # 학생 버튼 목록
                        for _, stu in cls_students.iterrows():
                            stu_id = int(stu["id"])
                            if st.button(
                                f"👤 {stu['name']}",
                                key=f"cls_stu_btn_{cls_id}_{stu_id}",
                                use_container_width=False,
                            ):
                                cur_stu = st.session_state.get(f"cls_student_detail_{cls_id}")
                                st.session_state[f"cls_student_detail_{cls_id}"] = stu_id if cur_stu != stu_id else None

                        # 선택된 학생 상세정보
                        sel_stu_id = st.session_state.get(f"cls_student_detail_{cls_id}")
                        if sel_stu_id:
                            stu_row = cls_students[cls_students["id"] == sel_stu_id]
                            if not stu_row.empty:
                                r = stu_row.iloc[0]
                                with st.container(border=True):
                                    st.markdown(f"**{r.get('name','—')} 학생 정보**")
                                    i1, i2 = st.columns(2)
                                    with i1:
                                        st.markdown(f"**학교:** {r.get('school','—') or '—'}")
                                        st.markdown(f"**학년:** {r.get('grade','—') or '—'}")
                                        st.markdown(f"**반:** {r.get('class_name','—')}")
                                        st.markdown(f"**등록일:** {r.get('registered_at','—')}")
                                    with i2:
                                        st.markdown(f"**연락처:** {r.get('parent_phone','—') or '—'}")
                                        st.markdown(f"**내원 전 진도:** {r.get('pre_visit_progress','—') or '—'}")
                                        st.markdown(f"**바라는 점:** {r.get('expectations','—') or '—'}")
                                        st.markdown(f"**비고:** {r.get('notes','—') or '—'}")
                                    # 상담일지
                                    logs_df = get_consultation_logs_for_student(sel_stu_id, None)
                                    if not logs_df.empty:
                                        show_logs = logs_df.head(3)
                                        st.markdown(f"**📋 상담일지 ({len(show_logs)}건):**")
                                        for _, lr in show_logs.iterrows():
                                            st.caption(f"• {lr['created_at']} — {lr['note']}")


# ═══════════════════════════════════════════════════════════════
# Page: Attendance
# ═══════════════════════════════════════════════════════════════


def page_attendance(classes_df: pd.DataFrame):
    """출석 관리 — 수업별 출석 체크 및 월별 이력·통계."""
    _page_header("출석 관리", "수업별로 학생 출결을 기록하고 월별 통계를 확인합니다.")
    if classes_df.empty:
        st.info(
            "등록된 수업이 없습니다. 먼저 ** 내 수업 관리**에서 수업을 만들어 주세요."
        )
        return

    teacher_id = _current_teacher_id()

    with st.container(border=True):
        st.markdown("#### 조회 월")
        st.caption(
            "달력에서 날짜를 선택하면 해당 **월** 전체 출석 데이터가 아래에 표시됩니다."
        )
        month_pick = st.date_input(
            "월 선택",
            value=date.today().replace(day=1),
            key="att_view_month",
        )
    from_str, to_str, month_label = _month_date_range(month_pick)

    hist_opts: dict[str, int | None] = {"전체 수업": None}
    for _, row in classes_df.iterrows():
        hist_opts[row["name"]] = int(row["id"])

    sub_mark, sub_history = st.tabs(["출석 체크", "출석 이력 및 통계"])

    with sub_mark:
        with st.container(border=True):
            st.markdown("#### 출석 체크")
            ctrl_col, sheet_col = st.columns([1.1, 2.3], gap="large")
            with ctrl_col:
                st.markdown("##### 수업 선택")
                class_name_map = {
                    row["name"]: int(row["id"]) for _, row in classes_df.iterrows()
                }
                sel_cls_name = st.selectbox(
                    "수업", list(class_name_map.keys()), key="att_class"
                )
                sel_cls_id = class_name_map[sel_cls_name]
                session_date = st.date_input(
                    "수업 날짜", value=date.today(), key="att_date"
                )
                session_date_str = session_date.strftime("%Y-%m-%d")
                _KO_WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"]
                _weekday_label = _KO_WEEKDAYS[session_date.weekday()]
                st.caption(f"선택 날짜: {session_date_str} ({_weekday_label})")
                already_saved = session_date_str in get_session_dates_for_class(
                    sel_cls_id
                )
                if already_saved:
                    st.info(
                        "이 날짜의 출결 기록이 이미 저장되어 있습니다. 수정 후 다시 저장할 수 있습니다."
                    )

            with sheet_col:
                st.markdown("##### 학생별 상태")
                students = get_students_by_class(sel_cls_id)
                if students.empty:
                    st.warning(f"**{sel_cls_name}** 수업에 배정된 학생이 없습니다.")
                else:
                    existing_df = get_attendance_for_session(
                        sel_cls_id, session_date_str
                    )
                    status_map = dict(
                        zip(existing_df["student_id"], existing_df["status"])
                    )
                    STATUS_OPTIONS = ["present", "late", "absent"]
                    STATUS_LABELS = {
                        "present": "출석",
                        "late": "지각",
                        "absent": "결석",
                    }
                    selections: dict[int, str] = {}

                    with st.form("attendance_form"):
                        for _, student in students.iterrows():
                            sid = int(student["id"])
                            current = status_map.get(sid, "present")
                            rc = st.columns([2, 3])
                            rc[0].markdown(f"**{student['name']}**")
                            radio_val = rc[1].radio(
                                f"s{sid}",
                                STATUS_OPTIONS,
                                index=STATUS_OPTIONS.index(current),
                                horizontal=True,
                                key=f"radio_{sid}",
                                format_func=lambda s: STATUS_LABELS[s],
                            )
                            selections[sid] = radio_val

                        save_btn = st.form_submit_button(
                            "출석 저장" if not already_saved else "출석 수정",
                            width="stretch",
                            type="primary",
                        )

                    if save_btn:
                        save_attendance(
                            [
                                {
                                    "student_id": sid,
                                    "class_id": sel_cls_id,
                                    "session_date": session_date_str,
                                    "status": status,
                                }
                                for sid, status in selections.items()
                            ]
                        )
                        pc = sum(1 for s in selections.values() if s == "present")
                        lc = sum(1 for s in selections.values() if s == "late")
                        ac = sum(1 for s in selections.values() if s == "absent")
                        st.success(f"저장 완료 — 출석 {pc} · 지각 {lc} · 결석 {ac}")
                        st.rerun()

    with sub_history:
        with st.container(border=True):
            st.markdown(f"#### {month_label} 출석 조회")
            hist_cls = st.selectbox(
                "수업 필터", list(hist_opts.keys()), key="hist_class"
            )
            hist_class_id = hist_opts[hist_cls]
            st.caption(f"기간: {from_str} ~ {to_str}")

        summary_df = get_attendance_summary(
            hist_class_id, from_str, to_str, teacher_id=teacher_id
        )
        history_df = get_attendance_history(
            hist_class_id, from_str, to_str, teacher_id=teacher_id
        )

        if summary_df.empty:
            st.info(f"**{month_label}**에 해당하는 출결 기록이 없습니다.")
        else:
            with st.container(border=True):
                st.markdown("#### 학생별 출석 통계")
                disp = summary_df[
                    [
                        "student_name",
                        "class_name",
                        "present",
                        "late",
                        "absent",
                        "attendance_rate",
                    ]
                ].copy()
                disp.columns = ["학생", "수업", "출석", "지각", "결석", "출석률"]
                disp = disp.reset_index(drop=True)
                disp.index += 1
                st.dataframe(disp, width="stretch")

            with st.container(border=True):
                st.markdown("#### 세션별 출석 로그")
                if not history_df.empty:
                    emap = {
                        "present": "출석",
                        "late": "지각",
                        "absent": "결석",
                    }
                    history_display = history_df.copy()
                    history_display["status"] = (
                        history_display["status"]
                        .map(emap)
                        .fillna(history_display["status"])
                    )
                    _KO_WD = ["월", "화", "수", "목", "금", "토", "일"]
                    history_display["session_date"] = history_display["session_date"].apply(
                        lambda d: (
                            f"{d} ({_KO_WD[pd.to_datetime(d).weekday()]})"
                            if pd.notna(d) and str(d).strip()
                            else d
                        )
                    )
                    dh = history_display[
                        ["session_date", "student_name", "class_name", "status"]
                    ].copy()
                    dh.columns = ["날짜", "학생", "수업", "상태"]
                    dh = dh.reset_index(drop=True)
                    dh.index += 1
                    st.dataframe(dh, width="stretch")

        with st.container(border=True):
            st.markdown("#### 출석부 내보내기")
            st.caption("현재 조회 중인 월·수업 필터 기준으로 PDF 초안을 생성합니다.")
            if st.button(
                "출석부 인쇄 (PDF)",
                type="primary",
                key="att_pdf_export_btn",
                use_container_width=True,
            ):
                try:
                    pdf_history = history_df.copy()
                    if not pdf_history.empty:
                        emap = {"present": "출석", "late": "지각", "absent": "결석"}
                        pdf_history["status"] = (
                            pdf_history["status"]
                            .map(emap)
                            .fillna(pdf_history["status"])
                        )
                    pdf_bytes, pdf_fname = generate_attendance_pdf_bytes(
                        month_label=month_label,
                        class_label=hist_cls,
                        summary_df=summary_df,
                        history_df=pdf_history,
                    )
                    st.session_state["att_pdf_bytes"] = pdf_bytes
                    st.session_state["att_pdf_fname"] = pdf_fname
                    st.success("PDF가 생성되었습니다. 아래에서 다운로드하세요.")
                except Exception as exc:
                    st.error(f"PDF 생성 실패: {exc}")

            if st.session_state.get("att_pdf_bytes") and st.session_state.get(
                "att_pdf_fname"
            ):
                st.download_button(
                    "PDF 다운로드",
                    data=st.session_state["att_pdf_bytes"],
                    file_name=st.session_state["att_pdf_fname"],
                    mime="application/pdf",
                    key="att_pdf_download_btn",
                    use_container_width=True,
                )


def _render_school_grade_tab() -> None:
    """School exam — student first, then year/grade/semester/kind."""
    teacher_id = _current_teacher_id()
    students_df = get_all_students(teacher_id)
    year_options = list(range(date.today().year - 2, date.today().year + 2))

    if students_df.empty:
        st.info("등록된 학생이 없습니다.")
        return

    with st.container(border=True):
        st.markdown("#### 학교시험 성적관리")
        st.caption(f"**{MATH_SUBJECT}** 성적 입력 · 학생을 먼저 선택하세요.")

        # ① 학생 먼저
        student_opts = {
            f"{r['name']} · {r['class_name']}": int(r["id"])
            for _, r in students_df.iterrows()
        }
        sel_student = st.selectbox("학생 선택", list(student_opts.keys()), key="school_grade_student")
        sel_student_id = student_opts[sel_student]
        st.markdown("---")

        # ② 연도 / 학년 / 학기 / 시험종류
        c1, c2, c3, c4 = st.columns(4)
        with c1:
            school_year = st.selectbox("연도", year_options, index=year_options.index(date.today().year), key="school_grade_year")
        with c2:
            grade_level = st.selectbox("학년", GRADE_LEVEL_OPTIONS, key="school_grade_grade")
        with c3:
            semester = st.selectbox("학기", SEMESTER_OPTIONS, key="school_grade_semester")
        with c4:
            exam_kind = st.selectbox("시험 종류", SCHOOL_EXAM_KIND_OPTIONS, key="school_grade_kind")

        # ③ 점수 + 저장 나란히
        sc1, sc2 = st.columns([3, 1])
        with sc1:
            math_score = st.number_input(f"{MATH_SUBJECT} 점수", min_value=0.0, max_value=100.0, step=0.5, key="school_grade_score")
        with sc2:
            st.markdown("<div style='height:28px'></div>", unsafe_allow_html=True)
            if st.button("저장", type="primary", use_container_width=True, key="school_grade_save"):
                save_school_math_grade(
                    student_id=sel_student_id,
                    school_year=int(school_year),
                    grade_level=grade_level,
                    semester=semester,
                    exam_kind=exam_kind,
                    score=float(math_score),
                )
                sync_all_csvs()
                st.success(f"{MATH_SUBJECT} 성적이 저장되었습니다.")
                st.rerun()

    # ④ 선택 학생 전체 이력
    with st.container(border=True):
        sel_name = sel_student.split(" · ")[0]
        st.markdown(f"#### {sel_name} 학생 — 학교시험 전체 성적")
        records_df = get_external_grade_records(
            exam_source=EXAM_SOURCE_SCHOOL,
            student_id=sel_student_id,
            teacher_id=teacher_id,
        )
        if records_df.empty:
            st.info("저장된 학교시험 성적이 없습니다.")
        else:
            view = records_df[["school_year", "grade_level", "semester", "exam_kind", "score", "updated_at"]].copy()
            view.columns = ["연도", "학년", "학기", "시험종류", "수학 점수", "저장일"]
            view = view.sort_values(["연도", "학기"], ascending=[False, True])
            st.dataframe(view, hide_index=True, use_container_width=True)


MOCK_GRADE_LEVEL_OPTIONS = ["고1", "고2", "고3"]


def _render_mock_grade_tab() -> None:
    """Mock exam — student first, then year/month/grade."""
    teacher_id = _current_teacher_id()
    students_df = get_all_students(teacher_id)
    year_options = list(range(date.today().year - 2, date.today().year + 2))
    month_labels = [f"{m}월" for m in MOCK_MONTH_OPTIONS]

    if students_df.empty:
        st.info("등록된 학생이 없습니다.")
        return

    with st.container(border=True):
        st.markdown("#### 모의고사 성적관리")
        st.caption(f"**{MATH_SUBJECT}** 성적 입력 · 학생을 먼저 선택하세요.")

        # ① 학생 먼저
        student_opts = {
            f"{r['name']} · {r['class_name']}": int(r["id"])
            for _, r in students_df.iterrows()
        }
        sel_student = st.selectbox("학생 선택", list(student_opts.keys()), key="mock_grade_student")
        sel_student_id = student_opts[sel_student]
        st.markdown("---")

        # ② 연도 / 월 / 학년
        c1, c2, c3 = st.columns(3)
        with c1:
            school_year = st.selectbox("연도", year_options, index=year_options.index(date.today().year), key="mock_grade_year")
        with c2:
            month_label = st.selectbox("월", month_labels, key="mock_grade_month")
            exam_month = MOCK_MONTH_OPTIONS[month_labels.index(month_label)]
        with c3:
            grade_level = st.selectbox("학년", MOCK_GRADE_LEVEL_OPTIONS, key="mock_grade_grade")

        # ③ 점수 + 저장 나란히
        sc1, sc2 = st.columns([3, 1])
        with sc1:
            math_score = st.number_input(f"{MATH_SUBJECT} 점수", min_value=0.0, max_value=100.0, step=0.5, key="mock_grade_score")
        with sc2:
            st.markdown("<div style='height:28px'></div>", unsafe_allow_html=True)
            if st.button("저장", type="primary", use_container_width=True, key="mock_grade_save"):
                save_mock_math_grade(
                    student_id=sel_student_id,
                    school_year=int(school_year),
                    grade_level=grade_level,
                    exam_month=int(exam_month),
                    score=float(math_score),
                )
                sync_all_csvs()
                st.success(f"{MATH_SUBJECT} 성적이 저장되었습니다.")
                st.rerun()

    # ④ 선택 학생 전체 이력
    with st.container(border=True):
        sel_name = sel_student.split(" · ")[0]
        st.markdown(f"#### {sel_name} 학생 — 모의고사 전체 성적")
        records_df = get_external_grade_records(
            exam_source=EXAM_SOURCE_MOCK,
            student_id=sel_student_id,
            teacher_id=teacher_id,
        )
        if records_df.empty:
            st.info("저장된 모의고사 성적이 없습니다.")
        else:
            view = records_df[["school_year", "grade_level", "exam_month", "score", "updated_at"]].copy()
            view.columns = ["연도", "학년", "월", "수학 점수", "저장일"]
            view = view.sort_values(["연도", "월"], ascending=[False, False])
            st.dataframe(view, hide_index=True, use_container_width=True)


def _generate_unified_grade_report_pdf(
    student_name: str,
    df: pd.DataFrame,
) -> tuple[bytes, str]:
    """PDF export for filtered unified grade report — expert academy layout."""
    from fpdf import FPDF

    font_path = _ensure_korean_font()
    report_date = datetime.now().strftime("%Y-%m-%d")

    # Brand palette
    _MAIN = (44, 62, 80)  # #2C3E50
    _MUTED = (100, 116, 139)  # #64748B
    _HIGH_BG = (220, 247, 230)
    _HIGH_TX = (22, 101, 52)
    _LOW_BG = (254, 226, 226)
    _LOW_TX = (185, 28, 28)
    _PANEL_BG = (248, 250, 252)
    _TREND_COLORS = {
        UNIFIED_GROUP_SCHOOL: "#5C7C99",
        UNIFIED_GROUP_MOCK: "#6B9080",
        UNIFIED_GROUP_ACADEMY: "#9A7B4F",
    }

    def _trend_png(report_df: pd.DataFrame) -> bytes | None:
        """Matplotlib trend chart → PNG bytes (static, PDF-safe)."""
        if report_df.empty:
            return None
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import matplotlib.dates as mdates

        fig, ax = plt.subplots(figsize=(7.6, 3.5))
        sec = split_unified_grades_by_group(report_df)
        has_trace = False
        for group_key, label in UNIFIED_GROUP_LABELS.items():
            sub = sec[group_key]
            if sub.empty:
                continue
            plot_df = sub.copy()
            plot_df["_dt"] = pd.to_datetime(plot_df["exam_date"], errors="coerce")
            plot_df = plot_df.dropna(subset=["_dt"]).sort_values("_dt")
            if plot_df.empty:
                continue
            has_trace = True
            ax.plot(
                plot_df["_dt"],
                plot_df["score"].astype(float),
                marker="o",
                linewidth=2.4,
                markersize=6,
                label=label,
                color=_TREND_COLORS.get(group_key, "#5C7C99"),
            )
        if not has_trace:
            plt.close(fig)
            return None
        ax.set_title(
            f"{student_name} — 성적 변화 추이",
            fontsize=12,
            color="#2C3E50",
            pad=12,
            fontweight="bold",
        )
        ax.set_xlabel("시험 날짜", fontsize=9, color="#64748B")
        ax.set_ylabel("수학 점수", fontsize=9, color="#64748B")
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
        ax.grid(True, axis="y", color="#EEF2F6", linewidth=0.9)
        ax.set_facecolor("#FFFFFF")
        fig.patch.set_facecolor("#FFFFFF")
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.spines["left"].set_color("#CBD5E1")
        ax.spines["bottom"].set_color("#CBD5E1")
        ax.legend(loc="upper left", fontsize=8, frameon=False)
        ax.set_ylim(bottom=0)
        fig.tight_layout()
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=140, facecolor="white")
        plt.close(fig)
        buf.seek(0)
        return buf.read()

    def _insight_lines(report_df: pd.DataFrame) -> list[str]:
        if report_df.empty:
            return ["(데이터 없음)"]
        scores = report_df["score"].astype(float)
        avg = float(scores.mean())
        lines = [
            f"선택 시험 {len(report_df)}회 · 평균 {avg:.1f}점 · "
            f"최고 {scores.max():.1f}점 · 최저 {scores.min():.1f}점",
        ]
        dated = report_df.copy()
        dated["_dt"] = pd.to_datetime(dated["exam_date"], errors="coerce")
        dated = dated.dropna(subset=["_dt"]).sort_values("_dt")
        if len(dated) >= 2:
            first_sc = float(dated.iloc[0]["score"])
            last_sc = float(dated.iloc[-1]["score"])
            delta = last_sc - first_sc
            lines.append(
                f"점수 변화폭: {delta:+.1f}점 "
                f"({dated.iloc[0]['exam_label']} → {dated.iloc[-1]['exam_label']})"
            )
        above = int((scores >= avg).sum())
        lines.append(
            f"평균 대비: {above}회 상회 / {len(scores) - above}회 미만 "
            f"(전체 {len(scores)}회 중)"
        )
        best = report_df.loc[scores.idxmax()]
        lines.append(
            f"최고 성과: {best.get('exam_label', '—')} "
            f"({float(best['score']):.1f}점)"
        )
        return lines

    class _ReportPDF(FPDF):
        def header(self):
            fam = "NanumGothic" if font_path else "Helvetica"
            self.set_fill_color(*_MAIN)
            self.rect(0, 0, 210, 30, style="F")
            self.set_text_color(255, 255, 255)
            self.set_font(fam, size=12)
            self.set_xy(12, 7)
            self.cell(0, 7, _safe_pdf_text("압구정 페르마 수학"))
            self.set_font(fam, size=8)
            self.set_xy(12, 15)
            self.cell(
                0,
                5,
                _safe_pdf_text(
                    f"Expert Grade Report  ·  학생 {student_name}  ·  {report_date}"
                ),
            )
            self.set_xy(12, 21)
            self.set_text_color(200, 214, 229)
            self.cell(0, 4, _safe_pdf_text("학부모 상담용 통합 성적 분석"))
            self.set_text_color(0, 0, 0)
            self.ln(34)

        def footer(self):
            self.set_y(-12)
            fam = "NanumGothic" if font_path else "Helvetica"
            self.set_font(fam, size=8)
            self.set_text_color(*_MUTED)
            self.cell(0, 6, f"- {self.page_no()} -", align="C")

        def multi_cell(self, w, h=None, text="", *args, **kwargs):
            kwargs.setdefault("new_x", "LMARGIN")
            kwargs.setdefault("new_y", "NEXT")
            return super().multi_cell(w, h, _safe_pdf_text(text), *args, **kwargs)

        def _font(self, size: int = 10, *, color: tuple[int, int, int] | None = None):
            fam = "NanumGothic" if font_path else "Helvetica"
            self.set_font(fam, size=size)
            if color:
                self.set_text_color(*color)
            else:
                self.set_text_color(44, 62, 80)

        def _section_bar(self, title: str) -> None:
            self._font(11)
            self.set_fill_color(*_MAIN)
            self.set_text_color(255, 255, 255)
            self.cell(
                0, 8, _safe_pdf_text(title), fill=True, new_x="LMARGIN", new_y="NEXT"
            )
            self.set_text_color(44, 62, 80)
            self.ln(2)

        def _insight_box(self, lines: list[str]) -> None:
            self.set_fill_color(*_PANEL_BG)
            self.set_draw_color(226, 232, 240)
            self._font(9)
            y0 = self.get_y()
            self.rect(self.l_margin, y0, self.epw, 6 + len(lines) * 5.5, style="DF")
            self.set_xy(self.l_margin + 3, y0 + 3)
            for line in lines:
                self.cell(
                    0, 5.5, _safe_pdf_text(f"  · {line}"), new_x="LMARGIN", new_y="NEXT"
                )
            self.ln(4)

        def _score_row_style(self, score: float, avg: float) -> tuple[tuple, tuple]:
            if score >= avg + 5:
                return _HIGH_BG, _HIGH_TX
            if score <= avg - 5:
                return _LOW_BG, _LOW_TX
            return (255, 255, 255), _MAIN

        def _grades_table(self, report_df: pd.DataFrame) -> None:
            if report_df.empty:
                self._font(9, color=_MUTED)
                self.multi_cell(0, 5, "(데이터 없음)")
                return

            scores = report_df["score"].astype(float)
            avg = float(scores.mean())
            ranked = report_df.copy()
            ranked["_score_f"] = scores
            ranked["_rank"] = scores.rank(ascending=False, method="min").astype(int)
            n = len(ranked)
            ranked = ranked.sort_values(
                ["exam_date", "updated_at"], ascending=[False, False]
            )

            col_w = [24, 62, 26, 22, 28, 18]
            headers = ["구분", "시험명", "날짜", "점수", "평균대비", "순위"]
            self._font(8)
            self.set_fill_color(*_MAIN)
            self.set_text_color(255, 255, 255)
            for h, w in zip(headers, col_w):
                self.cell(w, 7, _safe_pdf_text(h), border=1, fill=True, align="C")
            self.ln()

            for _, row in ranked.iterrows():
                score = float(row["_score_f"])
                bg, fg = self._score_row_style(score, avg)
                diff = score - avg
                rank = int(row["_rank"])
                cat = str(
                    row.get("exam_source_label")
                    or EXAM_SOURCE_LABELS.get(str(row.get("exam_source", "")), "기타")
                )
                cells = [
                    cat[:8],
                    str(row.get("exam_label", "—"))[:28],
                    str(row.get("exam_date", "—"))[:10],
                    f"{score:.1f}",
                    f"{diff:+.1f}",
                    f"{rank}/{n}",
                ]
                self.set_fill_color(*bg)
                self.set_text_color(*fg)
                self._font(8, color=fg)
                for text, w in zip(cells, col_w):
                    self.cell(
                        w, 7, _safe_pdf_text(text), border=1, fill=True, align="C"
                    )
                self.ln()
            self.set_text_color(44, 62, 80)

    pdf = _ReportPDF(format="A4", unit="mm")
    pdf.set_margins(left=12, top=12, right=12)
    pdf.set_auto_page_break(auto=True, margin=14)
    if font_path:
        pdf.add_font("NanumGothic", fname=font_path)

    pdf.add_page()

    if df.empty:
        pdf._section_bar("성적 분석 요약")
        pdf._font(10, color=_MUTED)
        pdf.multi_cell(
            0, 6, "(데이터 없음) — 선택한 항목에 해당하는 성적 기록이 없습니다."
        )
    else:
        png = _trend_png(df)
        pdf._section_bar("성적 변화 추이")
        if png:
            pdf.image(io.BytesIO(png), x=12, w=186)
            pdf.ln(4)
        else:
            pdf._font(9, color=_MUTED)
            pdf.multi_cell(
                0, 5, "(데이터 없음) — 그래프를 그릴 날짜·점수 데이터가 없습니다."
            )
            pdf.ln(2)

        pdf._section_bar("핵심 인사이트")
        pdf._insight_box(_insight_lines(df))

        pdf._section_bar("선택 시험 상세")
        pdf._grades_table(df)

    safe_name = _safe_pdf_text(student_name).replace(" ", "_")[:30]
    fname = f"통합성적_{safe_name}_{datetime.now().strftime('%Y%m%d')}.pdf"
    return bytes(pdf.output()), fname


def _parse_grade_student_id(student_id: int | None) -> int | None:
    """Validate student id for grade/report panels."""
    if student_id is None or student_id == "":
        return None
    try:
        sid = int(student_id)
    except (TypeError, ValueError):
        return None
    if sid <= 0:
        return None
    return sid


def _grade_student_selectbox(
    teacher_id: int | None,
    *,
    key: str,
) -> tuple[int | None, str | None, str | None]:
    """Return (student_id, student_name, class_name) from a teacher-scoped selectbox."""
    students_df = get_all_students(teacher_id)
    if students_df.empty:
        st.info("등록된 학생이 없습니다.")
        return None, None, None
    opts = {
        f"{r['name']} · {r['class_name']}": int(r["id"])
        for _, r in students_df.iterrows()
    }
    sel = st.selectbox("학생 선택", list(opts.keys()), key=key)
    sid = opts[sel]
    parts = sel.split(" · ", 1)
    sname = parts[0]
    class_name = parts[1] if len(parts) > 1 else "—"
    return sid, sname, class_name


def _resolve_grade_selectbox_student(
    teacher_id: int | None,
    *,
    key: str,
) -> tuple[int | None, str | None]:
    """Return (student_id, student_name) from a grade selectbox session key."""
    students_df = get_all_students(teacher_id)
    if students_df.empty:
        return None, None
    opts = {
        f"{r['name']} · {r['class_name']}": int(r["id"])
        for _, r in students_df.iterrows()
    }
    label = st.session_state.get(key)
    if not label or label not in opts:
        return None, None
    student_name = label.split(" · ", 1)[0]
    return int(opts[label]), student_name


_GRADE_TREND_COLORS = {
    UNIFIED_GROUP_SCHOOL: "#2563EB",   # 파랑 — 학교시험
    UNIFIED_GROUP_MOCK: "#F97316",     # 주황 — 모의고사
    UNIFIED_GROUP_ACADEMY: "#16A34A",  # 초록 — 학원시험
}


def _grade_dashboard_grade_hint(df: pd.DataFrame) -> str:
    if df.empty or "grade_level" not in df.columns:
        return "—"
    levels = df["grade_level"].dropna()
    return str(levels.iloc[0]) if not levels.empty else "—"


def _render_grade_dashboard_summary_cards(
    student_name: str,
    class_name: str,
    df: pd.DataFrame,
) -> None:
    grade_hint = _grade_dashboard_grade_hint(df)
    n_exams = len(df)
    if not df.empty:
        avg_score = f"{df['score'].astype(float).mean():.1f}점"
        latest_row = df.sort_values(["exam_date", "updated_at"], ascending=False).iloc[
            0
        ]
        latest_score = f"{float(latest_row['score']):.1f}점"
    else:
        avg_score = "—"
        latest_score = "—"

    sections = split_unified_grades_by_group(df)
    school_n = len(sections[UNIFIED_GROUP_SCHOOL])
    mock_n = len(sections[UNIFIED_GROUP_MOCK])
    academy_n = len(sections[UNIFIED_GROUP_ACADEMY])

    c1, c2, c3 = st.columns(3)
    with c1:
        st.markdown(
            f"""
            <div class="grade-dash-card">
                <p class="grade-dash-card-label">학생</p>
                <p class="grade-dash-card-value">{_html_mod.escape(student_name)}</p>
                <p class="grade-dash-card-sub">Academy Grade Report</p>
            </div>
            """,
            unsafe_allow_html=True,
        )
    with c2:
        st.markdown(
            f"""
            <div class="grade-dash-card">
                <p class="grade-dash-card-label">학년 · 반</p>
                <p class="grade-dash-card-value">{_html_mod.escape(grade_hint)} · {_html_mod.escape(class_name)}</p>
                <p class="grade-dash-card-sub">현재 배정 기준</p>
            </div>
            """,
            unsafe_allow_html=True,
        )
    with c3:
        st.markdown(
            f"""
            <div class="grade-dash-card grade-dash-card-accent">
                <p class="grade-dash-card-label">누적 성적</p>
                <p class="grade-dash-card-value">{n_exams}회 · 평균 {avg_score}</p>
                <p class="grade-dash-card-sub">
                    학교 {school_n} · 모의 {mock_n} · 학원 {academy_n}
                    · 최근 {latest_score}
                </p>
            </div>
            """,
            unsafe_allow_html=True,
        )


def _build_grade_trend_figure(df: pd.DataFrame) -> go.Figure | None:
    """Smoothed Plotly trend chart — 예쁜 디자인 버전."""
    if df.empty:
        return None

    sections = split_unified_grades_by_group(df)
    fig = go.Figure()
    has_trace = False

    COLOR_MAP = {
        UNIFIED_GROUP_SCHOOL:  {"line": "#2563EB", "fill": "rgba(37,99,235,0.08)"},
        UNIFIED_GROUP_MOCK:    {"line": "#F97316", "fill": "rgba(249,115,22,0.08)"},
        UNIFIED_GROUP_ACADEMY: {"line": "#16A34A", "fill": "rgba(22,163,74,0.08)"},
    }

    for group_key, label in UNIFIED_GROUP_LABELS.items():
        sub = sections[group_key]
        if sub.empty:
            continue
        plot_df = sub.copy()
        plot_df["exam_date_parsed"] = pd.to_datetime(
            plot_df["exam_date"], errors="coerce"
        )
        plot_df = plot_df.dropna(subset=["exam_date_parsed"])
        plot_df = plot_df.sort_values("exam_date_parsed")
        if plot_df.empty:
            continue
        has_trace = True
        c = COLOR_MAP[group_key]

        # 면적 채우기 (아래 영역 반투명)
        fig.add_trace(
            go.Scatter(
                x=plot_df["exam_date_parsed"],
                y=plot_df["score"].astype(float),
                mode="none",
                fill="tozeroy",
                fillcolor=c["fill"],
                showlegend=False,
                hoverinfo="skip",
            )
        )
        # 메인 선
        fig.add_trace(
            go.Scatter(
                x=plot_df["exam_date_parsed"],
                y=plot_df["score"].astype(float),
                mode="lines+markers+text",
                name=label,
                line=dict(color=c["line"], width=3.0, shape="spline", smoothing=0.8),
                marker=dict(
                    size=10,
                    color="#ffffff",
                    line=dict(width=3, color=c["line"]),
                    symbol="circle",
                ),
                text=[f"{v:.0f}" for v in plot_df["score"].astype(float)],
                textposition="top center",
                textfont=dict(size=11, color=c["line"], family="Nanum Gothic, sans-serif"),
                hovertemplate=(
                    "<b>%{x|%Y-%m-%d}</b><br>"
                    "점수: <b>%{y:.1f}점</b>"
                    "<extra>" + label + "</extra>"
                ),
            )
        )

    if not has_trace:
        return None

    # 100점 기준선
    fig.add_hline(
        y=100,
        line=dict(color="#94a3b8", width=1.5, dash="dot"),
        annotation_text="100점",
        annotation_position="right",
        annotation_font=dict(size=11, color="#94a3b8"),
    )

    fig.update_layout(
        title=None,
        height=460,
        margin=dict(l=56, r=48, t=32, b=56),
        plot_bgcolor="#f8fafc",
        paper_bgcolor="#ffffff",
        xaxis=dict(
            title=dict(text="시험 날짜", font=dict(size=13, color="#64748b")),
            showgrid=True,
            gridcolor="#e2e8f0",
            gridwidth=1,
            zeroline=False,
            linecolor="#cbd5e1",
            linewidth=1.5,
            tickfont=dict(size=12, color="#64748b"),
            tickformat="%Y-%m",
        ),
        yaxis=dict(
            title=dict(text="수학 점수 (점)", font=dict(size=13, color="#64748b")),
            showgrid=True,
            gridcolor="#e2e8f0",
            gridwidth=1,
            zeroline=True,
            zerolinecolor="#cbd5e1",
            linecolor="#cbd5e1",
            linewidth=1.5,
            range=[0, 110],
            tickvals=[0, 20, 40, 60, 80, 100],
            tickfont=dict(size=12, color="#64748b"),
        ),
        legend=dict(
            orientation="h",
            yanchor="bottom",
            y=1.04,
            xanchor="left",
            x=0,
            bgcolor="rgba(255,255,255,0.9)",
            bordercolor="#e2e8f0",
            borderwidth=1,
            font=dict(size=13, color="#334155"),
        ),
        hovermode="closest",
        hoverlabel=dict(
            bgcolor="#1e293b",
            font_size=13,
            font_color="#ffffff",
            bordercolor="#334155",
        ),
        font=dict(family="Nanum Gothic, Malgun Gothic, sans-serif", size=13),
    )
    return fig


def _render_grade_trend_chart(df: pd.DataFrame, *, chart_key: str) -> None:
    with st.container(border=True):
        st.markdown(
            '<p class="grade-dash-section-title">성적 변화 추이</p>',
            unsafe_allow_html=True,
        )
        st.caption("학교 · 모의 · 학원시험 유형별 수학 점수 추이 (부드러운 곡선)")
        fig = _build_grade_trend_figure(df)
        if fig is None:
            st.info("그래프를 표시할 성적 데이터가 없습니다.")
            return
        st.plotly_chart(fig, use_container_width=True, key=chart_key)


def _render_unified_grade_tables(
    df: pd.DataFrame, *, fixed_sections: bool = False, dashboard_style: bool = False
) -> None:
    """Render school / mock / academy sections from unified dataframe."""
    if df.empty and not fixed_sections:
        st.info("표시할 성적 기록이 없습니다.")
        return
    sections = split_unified_grades_by_group(df)
    for group_key, label in UNIFIED_GROUP_LABELS.items():
        sub = sections[group_key]
        if sub.empty and not fixed_sections:
            continue
        with st.container(border=True):
            if dashboard_style:
                st.markdown(
                    f'<p class="grade-dash-section-title">{label}</p>',
                    unsafe_allow_html=True,
                )
            else:
                st.markdown(f"##### {label}")
            if sub.empty:
                st.caption("등록된 성적 기록이 없습니다.")
            else:
                disp = sub[["exam_label", "score", "exam_date", "updated_at"]].copy()
                disp.columns = ["시험", "수학 점수", "시험일", "저장일"]
                st.dataframe(disp, hide_index=True, use_container_width=True)


def _render_student_grade_view_panel(student_id: int | None, student_name: str) -> None:
    """Read-only unified grade view — all three categories, fixed layout."""
    sid = _parse_grade_student_id(student_id)
    if sid is None:
        st.info("성적을 조회할 학생을 선택해 주세요.")
        return

    df = get_student_unified_grades_filtered(
        sid,
        include_school=True,
        include_mock=True,
        include_academy=True,
    )
    _render_unified_grade_tables(df, fixed_sections=True)


def _collect_report_exam_selection(
    sid: int, df: pd.DataFrame, *, key_prefix: str
) -> pd.DataFrame:
    """Return unified rows selected via per-exam checkboxes."""
    if df.empty:
        return df
    selected_ids: list[int] = []
    sections = split_unified_grades_by_group(df)
    for group_key, label in UNIFIED_GROUP_LABELS.items():
        sub = sections[group_key]
        with st.container(border=True):
            st.markdown(f"##### {label}")
            if sub.empty:
                st.caption("선택할 시험이 없습니다.")
                continue
            for _, row in sub.iterrows():
                exam_id = int(row["id"])
                score = float(row["score"])
                label_text = f"{row['exam_label']} · {score:.1f}점 ({row['exam_date']})"
                if st.checkbox(
                    label_text,
                    value=True,
                    key=f"{key_prefix}_rep_exam_sel_{sid}_{exam_id}",
                ):
                    selected_ids.append(exam_id)
    if not selected_ids:
        return df.iloc[0:0].copy()
    return df[df["id"].isin(selected_ids)].copy()


def _generate_parent_comment_ai(
    student_name: str,
    selected_df: pd.DataFrame,
    openai_client,
) -> str:
    """AI로 학부모 전달 메시지 초안 생성 (300자 이내)."""
    exam_summaries = []
    for _, row in selected_df.iterrows():
        label = str(row.get("exam_label", ""))
        score = float(row.get("score", 0))
        exam_summaries.append(f"- {label}: {score:.1f}점")
    exams_text = "\n".join(exam_summaries) if exam_summaries else "시험 정보 없음"
    avg_score = float(selected_df["score"].mean()) if not selected_df.empty else 0
    max_score = float(selected_df["score"].max()) if not selected_df.empty else 0
    min_score = float(selected_df["score"].min()) if not selected_df.empty else 0

    prompt = f"""학원 수학 강사로서 학부모님께 보내는 학습 상담 메시지를 작성해주세요.

[학생 정보]
- 학생 이름: {student_name}
- 평균 점수: {avg_score:.1f}점 / 최고: {max_score:.1f}점 / 최저: {min_score:.1f}점

[시험 성적]
{exams_text}

[작성 조건]
1. 시험 난이도와 학생 수준을 점수 기반으로 분석해주세요
2. 학생의 현재 수준과 부족한 부분을 구체적으로 언급해주세요
3. 앞으로 어떤 학습을 시킬 것인지 계획을 포함해주세요
4. 학부모님께 전달하는 따뜻하고 전문적인 톤으로 작성해주세요
5. 반드시 300자 이내로 작성 (A4 레이아웃 고려)
6. 인사말 없이 바로 내용부터 시작해주세요"""
    try:
        resp = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=400,
            temperature=0.7,
        )
        return resp.choices[0].message.content.strip()
    except Exception:
        return (
            f"{student_name} 학생은 이번 시험에서 평균 {avg_score:.1f}점을 기록하였습니다. "
            "전반적인 개념 이해도는 양호하나 응용 문제에서 보완이 필요합니다. "
            "앞으로 취약 단원 집중 훈련과 서술형 풀이 연습을 강화하겠습니다."
        )


def _render_exam_comparison_chart(selected_df: pd.DataFrame, student_name: str) -> None:
    """선택된 시험들 가로 누적 띠그래프 (정답/오답 비율 비교)."""
    import plotly.graph_objects as go

    if selected_df.empty:
        return

    exam_labels, correct_pcts, wrong_pcts = [], [], []
    for _, row in selected_df.iterrows():
        label = str(row.get("exam_label", ""))
        score = min(float(row.get("score", 0)), 100.0)
        exam_labels.append(label)
        correct_pcts.append(round(score, 1))
        wrong_pcts.append(round(max(0.0, 100.0 - score), 1))

    fig = go.Figure()
    fig.add_trace(go.Bar(
        name="정답률", y=exam_labels, x=correct_pcts, orientation="h",
        marker_color="#2563eb",
        text=[f"{v}%" for v in correct_pcts],
        textposition="inside", insidetextanchor="middle",
    ))
    fig.add_trace(go.Bar(
        name="오답률", y=exam_labels, x=wrong_pcts, orientation="h",
        marker_color="#e2e8f0",
        text=[f"{v}%" for v in wrong_pcts],
        textposition="inside", insidetextanchor="middle",
        textfont=dict(color="#64748b"),
    ))
    fig.update_layout(
        barmode="stack",
        title=dict(text=f"{student_name} — 시험별 정답률 비교", font=dict(size=14, color="#1e293b")),
        xaxis=dict(range=[0, 100], ticksuffix="%", title=""),
        yaxis=dict(title="", autorange="reversed"),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        height=max(200, len(exam_labels) * 52 + 80),
        margin=dict(l=10, r=10, t=50, b=10),
        plot_bgcolor="#ffffff", paper_bgcolor="#ffffff",
    )
    st.plotly_chart(fig, use_container_width=True)


def _render_student_report_write_panel(
    student_id: int | None,
    student_name: str,
    *,
    key_prefix: str,
) -> None:
    """통합보고서 — 시험 선택 → 띠그래프 → AI 학부모 글 → 웹분석 보고서."""
    sid = _parse_grade_student_id(student_id)
    if sid is None:
        st.info("보고서를 작성할 학생을 선택해 주세요.")
        return

    all_df = get_student_unified_grades(sid)
    if all_df.empty:
        st.info("이 학생의 통합 성적 기록이 없습니다. 성적을 먼저 등록해 주세요.")
        return

    # ── ① 포함할 시험 선택 (기존 유지) ──────────────────────────
    with st.container(border=True):
        st.markdown("#### 보고서에 포함할 시험")
        st.caption("카테고리별로 시험을 선택하세요.")
        selected_df = _collect_report_exam_selection(sid, all_df, key_prefix=key_prefix)

    if selected_df.empty:
        st.info("시험을 하나 이상 선택해 주세요.")
        return

    # ── ② 시험별 비교 띠그래프 ───────────────────────────────────
    with st.container(border=True):
        st.markdown("#### 시험별 성적 비교")
        _render_exam_comparison_chart(selected_df, student_name)

    # ── ③ AI 학부모 메시지 초안 ──────────────────────────────────
    ai_key = f"{key_prefix}_ai_comment_{sid}"
    with st.container(border=True):
        st.markdown("#### 📝 학부모님께 전하는 글")
        st.caption("AI 초안을 확인하고 수정한 뒤 보고서 생성을 진행하세요. (**300자 이내** 권장)")

        if st.button("AI 초안 생성", type="primary", key=f"{key_prefix}_ai_gen_{sid}"):
            if not has_openai_api_key():
                st.error("OpenAI API 키가 설정되지 않았습니다. 설정 메뉴에서 등록해 주세요.")
            else:
                with st.spinner("AI 초안 작성 중…"):
                    try:
                        draft = _generate_parent_comment_ai(student_name, selected_df, get_openai_client())
                        st.session_state[ai_key] = draft
                    except Exception as exc:
                        st.error(f"AI 초안 생성 실패: {exc}")

        current_comment = st.session_state.get(ai_key, "")
        char_count = len(current_comment)
        color = "#dc2626" if char_count > 300 else "#64748b"
        st.markdown(
            f"<div style='text-align:right;font-size:13px;color:{color};margin-bottom:4px'>"
            f"{char_count}/300자</div>", unsafe_allow_html=True,
        )
        parent_comment = st.text_area(
            "학부모님께 전할 메시지",
            value=current_comment,
            height=130,
            key=f"{key_prefix}_parent_comment_edit_{sid}",
            label_visibility="collapsed",
        )
        st.session_state[ai_key] = parent_comment

    # ── ④ 통합보고서 생성 ────────────────────────────────────────
    with st.container(border=True):
        st.markdown("#### 통합보고서 생성")
        st.caption(
            "선택된 학원 TEST 결과를 기반으로 웹 분석 보고서를 생성합니다. "
            "학원시험 AI분석 탭에서 오답이 저장된 시험만 선택 가능합니다."
        )

        exam_options = _list_web_report_exam_options(sid)
        if not exam_options:
            st.info("학원 TEST 결과가 없습니다. **학원시험 AI분석** 탭에서 오답을 저장한 뒤 다시 시도해 주세요.")
        else:
            exam_label_map = {opt["label"]: opt["test_id"] for opt in exam_options}
            sel_exam_label = st.selectbox(
                "분석할 학원 TEST 선택",
                list(exam_label_map.keys()),
                key=f"{key_prefix}_web_exam_sel_{sid}",
            )
            selected_test_id = exam_label_map.get(sel_exam_label)

            if st.button("📊 통합보고서 생성", type="primary", use_container_width=True, key=f"{key_prefix}_web_report_gen_{sid}"):
                try:
                    with st.spinner("보고서 생성 중…"):
                        report_data = _build_web_report_data(student_id=sid, test_id=int(selected_test_id))
                        report_data["parent_comment"] = st.session_state.get(ai_key, "")
                        html_str = generate_html_report(report_data)
                    fname = (
                        f"통합보고서_{_sanitize_test_filename_part(student_name)}_"
                        f"{_sanitize_test_filename_part(sel_exam_label)}.html"
                    )
                    st.session_state[f"{key_prefix}_report_html_{sid}"] = html_str
                    st.session_state[f"{key_prefix}_report_fname_{sid}"] = fname
                    st.success("통합보고서가 생성되었습니다.")
                except ValueError as exc:
                    st.error(str(exc))
                except Exception as exc:
                    st.error(f"보고서 생성 실패: {exc}")

        html_key = f"{key_prefix}_report_html_{sid}"
        fname_key = f"{key_prefix}_report_fname_{sid}"
        if st.session_state.get(html_key):
            html_str = st.session_state[html_key]
            fname = st.session_state.get(fname_key, "통합보고서.html")

            components.html(html_str, height=1000, scrolling=True)
            st.markdown("---")
            dl_col, save_col = st.columns(2)
            with dl_col:
                st.download_button(
                    "⬇️ HTML 다운로드", data=html_str.encode("utf-8"),
                    file_name=fname, mime="text/html",
                    key=f"{key_prefix}_html_dl_{sid}", use_container_width=True,
                )
            with save_col:
                if st.button("💾 설정 폴더에 저장", use_container_width=True, type="primary", key=f"{key_prefix}_html_save_{sid}"):
                    try:
                        save_dir = get_pdf_save_directory()
                        os.makedirs(save_dir, exist_ok=True)
                        save_path = os.path.join(save_dir, fname)
                        with open(save_path, "w", encoding="utf-8") as f:
                            f.write(html_str)
                        st.success(f"저장 완료: `{save_path}`")
                    except Exception as exc:
                        st.error(f"저장 실패: {exc}")


def _render_student_grade_view_page(teacher_id: int | None) -> None:
    """Brand-grade dashboard — summary cards, Plotly trend, tabbed detail."""
    st.markdown(
        """
        <div class="grade-dash-hero">
            <div style="font-size:3.2rem;font-weight:900;letter-spacing:0.08em;color:#ffffff;margin-bottom:0.4rem;line-height:1.2;text-shadow:0 2px 12px rgba(0,0,0,0.5);">Math Management</div>
            <div style="font-size:1rem;color:#e2e8f0;margin-top:0.2rem;">
                학교 · 모의 · 학원시험 성적을 한눈에 확인합니다.
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    sid, sname, class_name = _grade_student_selectbox(
        teacher_id, key="grade_view_student_sel"
    )
    if sid is None:
        return

    parsed_sid = _parse_grade_student_id(sid)
    if parsed_sid is None:
        st.info("성적을 조회할 학생을 선택해 주세요.")
        return

    df = get_student_unified_grades_filtered(
        parsed_sid,
        include_school=True,
        include_mock=True,
        include_academy=True,
    )

    _render_grade_dashboard_summary_cards(sname, class_name, df)
    st.markdown('<div class="grade-dash-divider"></div>', unsafe_allow_html=True)

    tab_table, tab_chart = st.tabs(["통합 성적표", "성적 추이 그래프"])

    with tab_table:
        st.markdown(
            '<p class="grade-dash-tab-lead">카테고리별 누적 성적 기록</p>',
            unsafe_allow_html=True,
        )
        _render_unified_grade_tables(df, fixed_sections=True, dashboard_style=True)

    with tab_chart:
        # ── 체크박스 필터 ──────────────────────────────────
        cb_col1, cb_col2, cb_col3, _ = st.columns([1, 1, 1, 3])
        show_school = cb_col1.checkbox("🏫 학교시험", value=True, key=f"chk_school_{parsed_sid}")
        show_mock   = cb_col2.checkbox("📝 모의고사", value=True, key=f"chk_mock_{parsed_sid}")
        show_acad   = cb_col3.checkbox("🏆 학원시험", value=True, key=f"chk_acad_{parsed_sid}")
        filtered_df = get_student_unified_grades_filtered(
            parsed_sid,
            include_school=show_school,
            include_mock=show_mock,
            include_academy=show_acad,
        )
        _render_grade_trend_chart(filtered_df, chart_key=f"grade_trend_chart_{parsed_sid}")


def _render_student_report_write_page(teacher_id: int | None) -> None:
    """Full-page unified report builder."""
    st.markdown("#### 통합 보고서 작성")
    st.caption("포함할 시험을 선택한 뒤 「제작」으로 최종 보고서를 생성합니다.")
    sid, sname, _class_name = _grade_student_selectbox(
        teacher_id, key="report_write_student_sel"
    )
    if sid is None:
        return
    parsed_sid = _parse_grade_student_id(sid)
    if parsed_sid is None:
        return
    _render_student_report_write_panel(parsed_sid, sname, key_prefix="page_report")


def _render_student_unified_grades(student_id: int, student_name: str) -> None:
    """Compact unified view (학생 명부 expander)."""
    _render_student_grade_view_panel(student_id, student_name)


# ═══════════════════════════════════════════════════════════════
# Page: Exams & Scores
# ═══════════════════════════════════════════════════════════════


def _compute_web_report_irt_stats(
    student_score: float,
    peer_scores: list[float],
) -> dict[str, Any]:
    import statistics

    scores = sorted(float(s) for s in peer_scores) if peer_scores else [float(student_score)]
    if float(student_score) not in scores:
        scores = sorted(scores + [float(student_score)])
    n = len(scores)
    mean = sum(scores) / n
    std = statistics.stdev(scores) if n > 1 else 0.0
    z_score = (float(student_score) - mean) / std if std > 0 else 0.0
    below = sum(1 for s in scores if s < student_score)
    equal = sum(1 for s in scores if s == student_score)
    percentile = round((below + 0.5 * equal) / n * 100, 1)
    rank = sum(1 for s in scores if s > student_score) + 1
    if percentile >= 90:
        grade = 1
    elif percentile >= 70:
        grade = 2
    elif percentile >= 50:
        grade = 3
    elif percentile >= 30:
        grade = 4
    else:
        grade = 5
    if n >= 5:
        sorted_s = sorted(scores)

        def _cut(pct: float) -> float:
            idx = min(int(len(sorted_s) * pct / 100), len(sorted_s) - 1)
            return round(sorted_s[idx], 1)

        grade_cuts = {
            "5등급": _cut(20),
            "4등급": _cut(40),
            "3등급_low": _cut(45),
            "3등급_high": _cut(55),
            "2등급": _cut(70),
            "1등급": _cut(90),
        }
    else:
        grade_cuts = {
            "5등급": round(mean - 2 * std, 1),
            "4등급": round(mean - std, 1),
            "3등급_low": round(mean - 0.5 * std, 1),
            "3등급_high": round(mean + 0.5 * std, 1),
            "2등급": round(mean + std, 1),
            "1등급": round(mean + 2 * std, 1),
        }
    return {
        "percentile": percentile,
        "rank": rank,
        "grade": grade,
        "mean_score": round(mean, 1),
        "std_dev": round(std, 2),
        "z_score": round(z_score, 2),
        "grade_cuts": grade_cuts,
    }


def _list_web_report_exam_options(student_id: int) -> list[dict[str, Any]]:
    """List exams for web report — merges AI ``student_results`` + ``test_results``."""
    seen: set[tuple[str, str]] = set()
    options: list[dict[str, Any]] = []

    for item in reversed(get_student_test_score_history(int(student_id))):
        test_name = str(item.get("test_name", "")).strip()
        test_date = str(item.get("date", "")).strip()
        if not test_name or not test_date:
            continue
        key = (test_name, test_date)
        if key in seen:
            continue
        seen.add(key)
        score = float(item.get("score", 0))
        options.append(
            {
                "test_id": int(item["test_id"]),
                "test_name": test_name,
                "date": test_date,
                "score": score,
                "label": f"{test_name} · {test_date} · {score:.1f}점",
            }
        )

    for entry in reversed(get_student_test_results(student_id=int(student_id))):
        test_name = str(entry.get("test_name", "")).strip()
        test_date = str(entry.get("date", "")).strip()
        if not test_name or not test_date:
            continue
        key = (test_name, test_date)
        if key in seen:
            continue
        record = get_student_result_record(
            student_id=int(student_id),
            test_name=test_name,
            test_date=test_date,
        )
        if not record or not record.get("test_id"):
            continue
        seen.add(key)
        score = float(entry.get("score") or record.get("score") or 0)
        options.append(
            {
                "test_id": int(record["test_id"]),
                "test_name": test_name,
                "date": test_date,
                "score": score,
                "label": f"{test_name} · {test_date} · {score:.1f}점",
            }
        )

    return options


def _build_web_report_data(*, student_id: int, test_id: int) -> dict[str, Any]:
    """Assemble ``generate_html_report`` payload from DB."""
    from collections import defaultdict

    profile = get_student_profile(student_id)
    if not profile:
        raise ValueError("학생 정보를 찾을 수 없습니다.")

    record = get_student_result_record(student_id=student_id, test_id=test_id)
    if not record:
        raise ValueError(
            f"{profile['student_name']} 학생의 해당 시험 결과가 없습니다. "
            "먼저 **학원 TEST AI분석**에서 오답을 저장해 주세요."
        )

    questions = get_test_questions(test_id)
    if not questions:
        raise ValueError("시험 문항 정보가 없습니다.")

    test_meta = get_test_by_id(int(test_id)) or {}
    course_label = str(test_meta.get("test_name") or record.get("test_name") or "시험")

    wrong_set = {int(n) for n in (record.get("wrong_numbers") or [])}
    test_name = str(record["test_name"])
    test_date = str(record["date"])
    total_score = float(record["score"])
    total_questions = max(int(record["total_questions"]), 1)

    class_id = profile.get("class_id")
    if class_id is not None:
        peer_df = get_all_student_test_results(class_id=int(class_id))
    else:
        peer_df = get_all_student_test_results()
    exam_peers = peer_df[
        (peer_df["test_name"] == test_name) & (peer_df["date"] == test_date)
    ]

    peer_wrong_sets: list[set[int]] = []
    peer_scores: list[float] = []
    for _, row in exam_peers.iterrows():
        try:
            wrong_raw = json.loads(row.get("wrong_numbers") or "[]")
        except json.JSONDecodeError:
            wrong_raw = []
        peer_wrong_sets.append({int(n) for n in wrong_raw})
        if row.get("score") is not None and not pd.isna(row.get("score")):
            peer_scores.append(float(row["score"]))

    national_avg = get_test_average_score(test_id)
    if national_avg is None and class_id is not None:
        national_avg = get_class_average_for_exam(
            int(class_id), test_name, test_date
        )
    if national_avg is None:
        national_avg = total_score

    def _question_class_rate(qnum: int) -> float:
        if not peer_wrong_sets:
            return float(national_avg)
        correct = sum(1 for ws in peer_wrong_sets if qnum not in ws)
        return correct / len(peer_wrong_sets) * 100.0

    def _agg_questions(qlist: list[dict[str, Any]]) -> dict[str, Any]:
        total = len(qlist)
        if total == 0:
            return {
                "total": 0,
                "correct": 0,
                "wrong": 0,
                "own_pct": 0.0,
                "national_pct": 0.0,
            }
        correct = sum(
            1 for q in qlist if int(q["question_number"]) not in wrong_set
        )
        wrong = total - correct
        own_pct = round(correct / total * 100, 1)
        nat_pcts = [
            _question_class_rate(int(q["question_number"])) for q in qlist
        ]
        national_pct = round(sum(nat_pcts) / len(nat_pcts), 1)
        return {
            "total": total,
            "correct": correct,
            "wrong": wrong,
            "own_pct": own_pct,
            "national_pct": national_pct,
        }

    sorted_qs = sorted(questions, key=lambda q: int(q["question_number"]))
    half = max(1, len(sorted_qs) // 2)
    obj_qs = sorted_qs[:half]
    subj_qs = sorted_qs[half:]

    type_analysis: list[dict[str, Any]] = []
    if obj_qs:
        type_analysis.append({"type": "객관식", **_agg_questions(obj_qs)})
    if subj_qs:
        type_analysis.append(
            {"type": "주관식&서술형", **_agg_questions(subj_qs)}
        )

    difficulty_analysis: list[dict[str, Any]] = []
    _db_to_level = {"High": "상", "Mid": "중", "Low": "하"}
    for db_level, level in _db_to_level.items():
        qlist = [
            q
            for q in sorted_qs
            if str(q.get("difficulty") or "Mid") == db_level
        ]
        if qlist:
            difficulty_analysis.append({"level": level, **_agg_questions(qlist)})

    cognitive_analysis: list[dict[str, Any]] = []
    for db_level, (domain, note) in {
        "Low": ("계산", "기본 공식 활용한 정확한 계산"),
        "Mid": ("이해", "수학적 개념 이해와 원리 설명 적용"),
        "High": ("해결", "복합 문제 풀이 전략 적용"),
    }.items():
        qlist = [
            q
            for q in sorted_qs
            if str(q.get("difficulty") or "Mid") == db_level
        ]
        if qlist:
            agg = _agg_questions(qlist)
            cognitive_analysis.append(
                {
                    "domain": domain,
                    "total": agg["total"],
                    "correct": agg["correct"],
                    "wrong": agg["wrong"],
                    "pct": agg["own_pct"],
                    "note": note,
                }
            )

    by_topic: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for q in sorted_qs:
        by_topic[str(q.get("topic") or "미분류")].append(q)

    unit_analysis: list[dict[str, Any]] = []
    for topic, qlist in sorted(by_topic.items()):
        agg = _agg_questions(qlist)
        parts = topic.split(" ", 1)
        if len(parts) > 1 and _re_mod.match(r"[\d.]+", parts[0]):
            unit_code, unit_name = parts[0], parts[1]
        else:
            unit_code, unit_name = topic[:12], topic
        unit_analysis.append(
            {
                "course": course_label,
                "unit_code": unit_code,
                "unit_name": unit_name,
                "total": agg["total"],
                "correct": agg["correct"],
                "wrong": agg["wrong"],
                "pct": agg["own_pct"],
            }
        )

    type_detail: list[dict[str, Any]] = []
    for idx, (topic, qlist) in enumerate(sorted(by_topic.items()), start=1):
        agg = _agg_questions(qlist)
        type_detail.append(
            {
                "course": course_label,
                "code": f"A{100 + idx}",
                "name": topic,
                "correct": agg["correct"],
                "total": agg["total"],
                "own_pct": agg["own_pct"],
                "avg_pct": agg["national_pct"],
            }
        )

    correct_count = total_questions - len(wrong_set)
    correct_rate = round(correct_count / total_questions * 100, 1)
    grade_label = _student_report_pdf.infer_grade_label(
        profile.get("class_name", ""),
        profile.get("class_description", ""),
    )

    return {
        "student_name": profile["student_name"],
        "grade_level": grade_label,
        "academy_name": "Ferma Academy",
        "exam_title": test_name if not test_date else f"{test_name} ({test_date})",
        "total_score": total_score,
        "weighted_score": total_score,
        "correct_rate": correct_rate,
        "total_correct": correct_count,
        "total_questions": total_questions,
        "national_avg": float(national_avg),
        "national_delta": round(total_score - float(national_avg), 1),
        "type_analysis": type_analysis,
        "difficulty_analysis": difficulty_analysis,
        "cognitive_analysis": cognitive_analysis,
        "unit_analysis": unit_analysis,
        "type_detail": type_detail,
        "irt_stats": _compute_web_report_irt_stats(total_score, peer_scores),
    }


def page_grade_report() -> None:
    """성적 조회 · 입력 · AI 분석 · 통합 보고서 (탭 통합)."""
    teacher_id = _current_teacher_id()

    tab_view, tab_school, tab_mock, tab_aitest, tab_report = st.tabs(
        [
            "성적 조회",
            "학교시험 성적관리",
            "모의고사 성적관리",
            "학원시험 AI분석",
            "통합보고서 작성",
        ]
    )

    with tab_view:
        _render_student_grade_view_page(teacher_id)

    with tab_school:
        _render_school_grade_tab()

    with tab_mock:
        _render_mock_grade_tab()

    with tab_aitest:
        page_ai_test_analysis()

    with tab_report:
        _render_student_report_write_page(teacher_id)


def page_ai_test_analysis() -> None:
    """학원 TEST OCR · 오답 · AI 분석 (전용 메뉴)."""
    st.markdown("### 학원 TEST AI분석")

    if st.session_state.get("active_test_id") and not st.session_state.get(
        "test_sheet_confirmed"
    ):
        st.session_state["test_sheet_confirmed"] = True

    _render_existing_test_selector()

    _parsed_for_picker = None
    if st.session_state.get("ocr_extract_result"):
        _parsed_for_picker = st.session_state.get("ocr_parsed_questions")
        if not _parsed_for_picker:
            _parsed_for_picker = parse_questions_from_extraction(
                st.session_state["ocr_extract_result"]
            )
            st.session_state["ocr_parsed_questions"] = _parsed_for_picker

    with st.container(border=True):
        st.markdown("#### TEST지 업로드")
        st.caption("시험지 이미지 또는 PDF를 업로드한 뒤 OCR을 실행하세요.")
        test_upload = st.file_uploader(
            "TEST지 파일",
            type=["jpg", "jpeg", "png", "webp", "pdf"],
            key="ocr_test_upload",
        )
        ocr_btn = st.button(
            "OCR 실행 (Vision + GPT)",
            type="primary",
            disabled=(test_upload is None),
        )

    if ocr_btn:
        if test_upload is None:
            st.warning("파일을 먼저 업로드해주세요.")
        elif not has_google_vision_credentials():
            st.session_state["ocr_extract_error"] = GOOGLE_VISION_AUTH_USER_MESSAGE
            st.session_state.pop("ocr_extract_result", None)
        elif not has_openai_api_key():
            st.session_state["ocr_extract_error"] = OPENAI_AUTH_USER_MESSAGE
            st.session_state.pop("ocr_extract_result", None)
        else:
            try:
                test_bytes = test_upload.read()
                st.session_state["ocr_upload_bytes"] = test_bytes
                st.session_state["ocr_upload_filename"] = test_upload.name
                st.session_state.pop("ocr_confirm_test_name", None)
                with st.spinner("1/2 Google Vision OCR 분석 중…"):
                    raw_ocr = extract_text_google_vision(
                        test_bytes,
                        filename=test_upload.name,
                    )
                with st.spinner("2/2 GPT-4o 수식 정제 + 문항 분석 중… (10~20초)"):
                    refined_pages, gpt_questions = refine_and_analyze_with_gpt(
                        raw_ocr["pages"]
                    )
                    extraction = assemble_exam_extraction(raw_ocr, refined_pages)
                    st.session_state["ocr_extract_result"] = extraction
                    parsed = parse_questions_from_extraction(extraction)
                    # GPT 문항분석 결과 반영
                    if gpt_questions:
                        parsed = analyze_topics_with_gpt(
                            parsed,
                            _preanalyzed_questions=gpt_questions,
                        )
                    st.session_state["ocr_parsed_questions"] = parsed
                    st.session_state.pop("ocr_questions_editor", None)
                    st.session_state.pop("ocr_selected_collected", None)
                    st.session_state.pop("test_sheet_confirmed", None)
                    st.session_state.pop("active_test_id", None)
                    st.session_state.pop("_loaded_test_id", None)
                    st.session_state.pop("ocr_reedit_test", None)
                    st.session_state.pop("ocr_reedit_test_id", None)
                    st.session_state["_test_input_mode"] = "new"
                st.session_state.pop("ocr_extract_error", None)
                st.success("OCR 및 수식 정제가 완료되었습니다.")
                st.rerun()
            except GoogleVisionAuthError as exc:
                st.session_state["ocr_extract_error"] = str(exc)
                st.session_state.pop("ocr_extract_result", None)
            except OpenAIAuthError:
                st.session_state["ocr_extract_error"] = OPENAI_AUTH_USER_MESSAGE
                st.session_state.pop("ocr_extract_result", None)
            except Exception as exc:
                st.session_state["ocr_extract_error"] = str(exc)
                st.session_state.pop("ocr_extract_result", None)

    if st.session_state.get("ocr_extract_error"):
        st.error(st.session_state["ocr_extract_error"])


    _render_test_question_editor(_parsed_for_picker)

    if (
        st.session_state.get("ocr_extract_result")
        and _parsed_for_picker
        and not _is_test_sheet_confirmed()
    ):
        _detected = _parsed_for_picker.get("detected_count", 0)
        if _detected:
            st.caption(
                f"OCR 완료 — **{_detected}개** 문항 감지. "
                "위 편집표에서 내용을 확인한 뒤 **확정**을 눌러 주세요."
            )

    st.divider()

    _render_ocr_class_student_picker(parsed=_parsed_for_picker)

    st.divider()

    left_ocr = st.container()
    right_ocr = st.container()

    with left_ocr:
        _vision_ok = has_google_vision_credentials()
        _openai_ok = has_openai_api_key()
        if _vision_ok and _openai_ok:
            st.success(
                "Google Vision + OpenAI API 키 로드됨 — OCR·AI 분석을 실행합니다.",
            )
        elif _openai_ok:
            st.warning(
                "OpenAI 키는 있으나 Google Vision 인증 파일이 없습니다. "
                "service-account-key.json (streamlit-app 폴더) 파일을 확인하세요.",
            )
        elif _vision_ok:
            st.warning(
                "Google Vision 인증은 있으나 OpenAI API 키가 없습니다. "
                "수식 정제·AI 분석을 위해 OPENAI_API_KEY 가 필요합니다.",
            )
        else:
            st.info("API 키 없음 — 시뮬레이션 결과가 표시됩니다.")
            st.markdown(
                "streamlit-app/service-account-key.json 과 `.env`의 OPENAI_API_KEY 를 설정하면 "
                "실제 OCR·AI 분석이 가능합니다."
            )

        st.markdown("#### 시험지 파일 업로드")
        st.caption("학생의 시험지 사진, 스캔 이미지 또는 PDF를 업로드하세요.")

        uploaded_file = st.file_uploader(
            "파일 선택",
            type=["jpg", "jpeg", "png", "webp", "pdf"],
        )

        if uploaded_file:
            ext = uploaded_file.name.rsplit(".", 1)[-1].lower()
            if ext == "pdf":
                st.markdown(f"**PDF 업로드됨:** `{uploaded_file.name}`")
                try:
                    pdf_bytes_preview = uploaded_file.read()
                    uploaded_file.seek(0)
                    doc_prev = fitz.open(stream=pdf_bytes_preview, filetype="pdf")
                    n_pages = len(doc_prev)
                    pix_prev = doc_prev[0].get_pixmap(
                        matrix=fitz.Matrix(1.2, 1.2), alpha=False
                    )
                    doc_prev.close()
                    st.image(
                        pix_prev.tobytes("png"),
                        caption=f"1페이지 미리보기 (총 {n_pages}페이지)",
                        width="stretch",
                    )
                except Exception:
                    st.info("PDF 미리보기를 생성할 수 없습니다.")
            else:
                st.image(
                    uploaded_file, caption="업로드된 시험지 이미지", width="stretch"
                )

        st.markdown("")

        analyze_btn = st.button(
            "AI 채점 및 분석하기",
            type="primary",
            width="stretch",
            disabled=(uploaded_file is None),
            help="시험지 파일을 업로드하고 이 버튼을 클릭하세요.",
        )

        if uploaded_file is None:
            st.caption("먼저 파일을 업로드한 후 버튼을 클릭하세요.")

        if analyze_btn and uploaded_file:
            ext = uploaded_file.name.rsplit(".", 1)[-1].lower()
            file_bytes = uploaded_file.read()
            has_real_keys = has_openai_api_key() and has_google_vision_credentials()

            with st.spinner("Google Vision OCR → GPT-4o 정제 → AI 분석 중…"):
                try:
                    extraction = extract_exam_text(
                        file_bytes,
                        filename=uploaded_file.name,
                    )
                    if ext == "pdf":
                        pages = pdf_to_images(file_bytes)
                        result = analyze_exam_pages(
                            pages,
                            pdf_text=extraction["raw_combined"],
                        )
                    else:
                        mime_map = {
                            "jpg": "image/jpeg",
                            "jpeg": "image/jpeg",
                            "png": "image/png",
                            "webp": "image/webp",
                        }
                        mime = mime_map.get(ext, "image/jpeg")
                        result = analyze_exam_pages(
                            [(file_bytes, mime)],
                            pdf_text=extraction["raw_combined"],
                        )

                    st.session_state["ocr_result"] = result
                    st.session_state.pop("ocr_error", None)

                except (GoogleVisionAuthError, OpenAIAuthError) as e:
                    st.session_state["ocr_error"] = str(e)
                    st.session_state.pop("ocr_result", None)
                except Exception as e:
                    if has_real_keys:
                        st.session_state["ocr_error"] = str(e)
                        st.session_state.pop("ocr_result", None)
                    else:
                        st.session_state["ocr_result"] = _mock_analysis()
                        st.session_state.pop("ocr_error", None)

    with right_ocr:
        st.markdown("#### AI 분석 리포트")

        # ── API error display (key was set but call failed) ───
        if "ocr_error" in st.session_state:
            st.error(
                f"**OpenAI API 오류**\n\n{st.session_state['ocr_error']}\n\n"
                "API 키와 네트워크 상태를 확인한 후 다시 시도해 주세요.",
            )
            if st.button("오류 지우기", type="secondary", key="clear_error"):
                st.session_state.pop("ocr_error", None)
                st.rerun()

        elif "ocr_result" not in st.session_state:
            st.info(
                "왼쪽에서 시험지 파일을 업로드하고 **AI 채점 및 분석하기** 버튼을 클릭하면 여기에 리포트가 표시됩니다."
            )
        else:
            res = st.session_state["ocr_result"]
            mode = res.get("mode", "ai")

            # ── No handwriting detected ───────────────────────
            if mode == "no_answers":
                st.warning(
                    res.get(
                        "message",
                        "학생의 답안이 확인되지 않습니다. "
                        "학생이 작성한 답안지 사진을 함께 업로드해주세요.",
                    ),
                )
                st.info(
                    "업로드하신 파일에서 학생이 직접 작성한 필기나 표시된 답안을 찾을 수 없었습니다.\n\n"
                    "**올바른 업로드 방법:**\n"
                    "- 학생이 이미 풀이를 작성한 답안지를 촬영하세요.\n"
                    "- 문항지와 답안지가 함께 찍힌 사진이면 더욱 좋습니다.\n"
                    "- 백지 또는 문항만 인쇄된 시험지는 분석할 수 없습니다.",
                )
                if st.button("초기화", type="secondary", key="clear_no_answers"):
                    st.session_state.pop("ocr_result", None)
                    st.rerun()

            else:
                is_mock = mode == "mock"

                # ── Mode badge ────────────────────────────────
                if is_mock:
                    st.warning(
                        "**시뮬레이션 리포트** — API 키가 설정되지 않았습니다. "
                        "**설정** 탭에서 OpenAI API 키를 입력하면 GPT-4o 실제 분석 결과가 표시됩니다.",
                    )
                else:
                    st.success("**실제 AI 리포트** — GPT-4o 비전으로 분석 완료.")

                # ── Overall score + Grade badge (vertical) ────────
                overall = res.get("overall_estimated_pct", 0)
                grade = compute_grade(overall)
                g_emoji = GRADE_EMOJI.get(grade, "")
                g_label = GRADE_LABEL.get(grade, "")

                st.markdown(f"### 예상 점수: **{overall}%** {score_label(overall)}")
                st.markdown(
                    f"<div style='background:#f0f4ff;border:1px solid #c0cce0;"
                    f"border-radius:8px;padding:10px 16px;margin-bottom:8px;"
                    f"display:inline-block'>"
                    f"<span style='font-size:1.4em'>{g_emoji}</span>&nbsp;"
                    f"<b style='font-size:1.2em'>{grade}등급</b>&nbsp;"
                    f"<span style='font-size:0.9em;color:#555'>— {g_label}</span>"
                    f"</div>",
                    unsafe_allow_html=True,
                )

                detected = res.get("topics_detected", [])
                if detected:
                    st.caption(f"감지된 단원: {', '.join(detected)}")

                st.divider()

                # ── Question-by-question breakdown ─────────────
                questions = res.get("questions", [])
                if questions:
                    st.markdown("#### 문항별 채점 결과")

                    RESULT_LABEL = {
                        "Correct": "맞음",
                        "Partial": "부분정답",
                        "Incorrect": "틀림",
                    }
                    RESULT_ICON = {
                        "Correct": "",
                        "Partial": "",
                        "Incorrect": "",
                    }
                    DIFF_BADGE = {"High": "상", "Mid": "중", "Low": "하"}

                    for q in questions:
                        r_icon = RESULT_ICON.get(q.get("result", ""), "")
                        r_label = RESULT_LABEL.get(
                            q.get("result", ""), q.get("result", "—")
                        )
                        d_badge = DIFF_BADGE.get(
                            q.get("difficulty", ""), q.get("difficulty", "")
                        )

                        with st.container(border=True):
                            st.markdown(
                                f"**문항 {q.get('number', '?')}** · "
                                f"{q.get('topic', '—')} · {d_badge} &nbsp; "
                                f"{r_icon} **{r_label}**",
                                unsafe_allow_html=True,
                            )
                            ans = q.get("student_answer", "")
                            if ans:
                                st.markdown(
                                    f"<span style='color:grey;font-size:0.88em'>학생 답안: {ans}</span>",
                                    unsafe_allow_html=True,
                                )
                            comment = q.get("ai_comment", "")
                            if comment:
                                st.caption(f"{comment}")

                    total_q = len(questions)
                    correct = sum(1 for q in questions if q.get("result") == "Correct")
                    partial = sum(1 for q in questions if q.get("result") == "Partial")
                    incorrect = sum(
                        1 for q in questions if q.get("result") == "Incorrect"
                    )
                    st.caption(
                        f"**총 {total_q}문항** — "
                        f"{correct}개 맞음 · {partial}개 부분정답 · {incorrect}개 틀림"
                    )
                    st.divider()

                # ── Topic score bars ───────────────────────────
                est_scores = res.get("estimated_scores", [])
                if est_scores:
                    st.markdown("#### 단원별 성취도")
                    for ts in est_scores:
                        pct = ts.get("estimated_pct", 0)
                        bar_val = max(0.0, min(1.0, pct / 100))
                        st.markdown(
                            f"**{ts.get('topic', '—')}** — "
                            f"`{pct}%` {score_label(pct)}"
                        )
                        if ts.get("observation"):
                            st.caption(ts["observation"])
                        st.progress(bar_val)
                    st.divider()

                # ── Topic-based analysis ───────────────────────
                if questions:
                    st.markdown("#### 단원 유형별 분석")
                    topic_map: dict[str, list] = {}
                    for q in questions:
                        topic_map.setdefault(q.get("topic", "기타"), []).append(q)

                    for topic, tqs in topic_map.items():
                        c_cnt = sum(1 for q in tqs if q.get("result") == "Correct")
                        p_cnt = sum(1 for q in tqs if q.get("result") == "Partial")
                        i_cnt = sum(1 for q in tqs if q.get("result") == "Incorrect")
                        ratio = c_cnt / len(tqs) if tqs else 0
                        status = (
                            "강점"
                            if ratio >= 0.7
                            else ("보통" if i_cnt == 0 else "집중 필요")
                        )
                        with st.container(border=True):
                            st.markdown(
                                f"**{topic}** &nbsp; {status}",
                                unsafe_allow_html=True,
                            )
                            st.caption(
                                f"정답 {c_cnt}개 · 부분정답 {p_cnt}개 · 오답 {i_cnt}개"
                            )
                            st.progress(max(0.0, min(1.0, ratio)))
                    st.divider()

                # ── Strengths & improvement (vertical) ────────
                st.markdown("#### 잘한 점")
                for s in res.get("strengths", []):
                    st.markdown(f"{s}")
                st.markdown("#### 보완이 필요한 점")
                for a in res.get("improvement_areas", []):
                    st.markdown(f"{a}")

                st.divider()

                # ── Teacher notes ──────────────────────────────
                notes = res.get("teacher_notes", "")
                if notes:
                    st.markdown("#### 교사 총평")
                    st.info(notes)

                # ── Suggested practice ─────────────────────────
                practice = res.get("suggested_practice", [])
                if practice:
                    st.markdown("#### 추천 연습 문제")
                    for i, p in enumerate(practice, 1):
                        st.markdown(f"**{i}.** {p}")

                st.divider()

                # ── Save result to student history ─────────────
                with st.container(border=True):
                    st.markdown("#### 결과 저장")
                    all_students_df = get_all_students()
                    if all_students_df.empty:
                        st.info("저장하려면 먼저 학생을 등록해 주세요. (반 관리 탭)")
                    else:
                        student_name_opts = {
                            f"{r['name']} ({r['class_name']})": int(r["id"])
                            for _, r in all_students_df.iterrows()
                        }
                        sel_student_label = st.selectbox(
                            "학생 선택",
                            list(student_name_opts.keys()),
                            key="save_result_student",
                        )
                        exam_name_input = st.text_input(
                            "시험 이름",
                            placeholder="예: 중간고사 1회",
                            key="save_result_exam_name",
                        )
                        if st.button(
                            "이 결과 저장",
                            type="primary",
                            width="stretch",
                            key="save_result_btn",
                        ):
                            sid = student_name_opts[sel_student_label]
                            e_name = exam_name_input.strip() or "AI 분석 시험"
                            save_ai_result(
                                student_id=sid,
                                exam_name=e_name,
                                overall_pct=float(overall),
                                grade=grade,
                                analysis_json=json.dumps(res, ensure_ascii=False),
                            )
                            st.success(
                                f"**{sel_student_label}** 의 결과가 저장되었습니다. "
                                "「성적 리포트」 메뉴에서 확인하세요.",
                            )

                st.divider()

                # ── PDF 리포트 다운로드 ─────────────────────────
                with st.container(border=True):
                    st.markdown("#### PDF 리포트 다운로드")
                    pdf_student_name = st.text_input(
                        "학생 이름 (PDF 표지)",
                        placeholder="학생 이름을 입력하세요",
                        key="pdf_student_name",
                    )
                    pdf_exam_name = st.text_input(
                        "시험 이름",
                        placeholder="예: 2026 중간고사",
                        key="pdf_exam_name",
                    )
                    include_hist_chk = st.checkbox(
                        "누적 성취도 그래프 포함",
                        key="pdf_include_history",
                        help="학생을 선택하고 저장된 이력이 있어야 그래프가 포함됩니다.",
                    )
                    hist_for_pdf = None
                    if include_hist_chk and not all_students_df.empty:
                        hist_stud_opts = {
                            f"{r['name']} ({r['class_name']})": int(r["id"])
                            for _, r in all_students_df.iterrows()
                        }
                        hist_sel = st.selectbox(
                            "이력 조회 학생",
                            list(hist_stud_opts.keys()),
                            key="pdf_hist_student",
                        )
                        hist_for_pdf = get_student_ai_history(hist_stud_opts[hist_sel])
                    if st.button(
                        "PDF 생성 및 다운로드",
                        type="primary",
                        width="stretch",
                        key="gen_pdf_btn",
                    ):
                        with st.spinner("PDF 생성 중…"):
                            try:
                                pdf_bytes = generate_report_pdf(
                                    result=res,
                                    student_name=pdf_student_name.strip() or "학생",
                                    exam_name=pdf_exam_name.strip(),
                                    include_history=include_hist_chk,
                                    history_df=hist_for_pdf,
                                )
                                _stud = pdf_student_name.strip() or "학생"
                                _rec = save_pdf_and_log(
                                    pdf_bytes,
                                    "analysis",
                                    student_name=_stud,
                                    exam_name=pdf_exam_name.strip(),
                                )
                                st.download_button(
                                    label="PDF 다운로드",
                                    data=pdf_bytes,
                                    file_name=f"성적분석_{_stud}.pdf",
                                    mime="application/pdf",
                                    width="stretch",
                                )
                                st.success(
                                    f"리포트가 영구 링크로 저장되었습니다 "
                                    f"(파일 크기: {_rec['file_size']/1024:.1f} KB)"
                                )
                                render_share_panel(
                                    public_url=_rec["public_url"],
                                    student_name=_stud,
                                    report_label="성적분석 리포트",
                                    message=(
                                        f"안녕하세요 압구정 페르마 수학입니다. "
                                        f"{_stud} 학생의 성적분석 리포트입니다. "
                                        f"확인 부탁드립니다."
                                    ),
                                    key_suffix=f"analysis_{_rec['id']}",
                                )
                            except Exception as e:
                                import traceback
                                from datetime import datetime as _dt

                                tb = traceback.format_exc()
                                print("[pdf-trace] report EXCEPTION:", flush=True)
                                print(tb, flush=True)
                                try:
                                    with open(
                                        _ERROR_LOG_PATH, "a", encoding="utf-8"
                                    ) as _fh:
                                        _fh.write(
                                            f"\n===== {_dt.now().isoformat(timespec='seconds')}  "
                                            f"REPORT EXCEPTION =====\n{tb}\n"
                                        )
                                except Exception:
                                    pass
                                st.error(f"PDF 생성 오류: {e}")

                st.divider()

                # ── 오답 노트 생성 ────────────────────────────
                wrong_qs = [q for q in questions if q.get("result") == "Incorrect"]
                if wrong_qs:
                    with st.container(border=True):
                        st.markdown("#### 오답 노트 생성")
                        st.caption(
                            f"틀린 문항 **{len(wrong_qs)}개** 가 감지되었습니다. "
                            "각 오답에 대해 유사한 연습문제를 생성합니다."
                        )
                        en_student = st.text_input(
                            "학생명 (오답 노트 표지)",
                            placeholder="학생 이름을 입력하세요",
                            key="errornote_student",
                        )
                        similar_count = st.slider(
                            "문항 당 유사문제 개수",
                            min_value=1,
                            max_value=5,
                            value=2,
                            key="similar_q_count",
                            help="오답 1문항 당 생성할 유사 연습문제 수",
                        )
                        st.caption(
                            f"오답 **{len(wrong_qs)}문항** × 유사문제 **{similar_count}개** "
                            f"= 총 **{len(wrong_qs) * similar_count}개** 연습문제 생성"
                        )
                        if st.button(
                            "오답 노트 생성 및 다운로드",
                            type="primary",
                            width="stretch",
                            key="gen_error_note_btn",
                        ):
                            with st.spinner(
                                f"AI가 유사문제 {len(wrong_qs) * similar_count}개를 생성 중입니다…"
                            ):
                                try:
                                    similar_data = generate_similar_questions(
                                        wrong_qs, similar_count, ""
                                    )
                                    note_pdf = generate_error_note_pdf(
                                        similar_data,
                                        en_student.strip() or "학생",
                                    )
                                    _en_stud = en_student.strip() or "학생"
                                    _en_rec = save_pdf_and_log(
                                        note_pdf,
                                        "errornote",
                                        student_name=_en_stud,
                                    )
                                    st.download_button(
                                        label="오답 노트 PDF 다운로드",
                                        data=note_pdf,
                                        file_name=f"오답노트_{_en_stud}.pdf",
                                        mime="application/pdf",
                                        width="stretch",
                                        key="dl_error_note",
                                    )
                                    st.success(
                                        f"오답 노트가 생성되었습니다 "
                                        f"(파일 크기: {_en_rec['file_size']/1024:.1f} KB)"
                                    )
                                    render_share_panel(
                                        public_url=_en_rec["public_url"],
                                        student_name=_en_stud,
                                        report_label="오답 노트",
                                        message=DEFAULT_KAKAO_MESSAGE,
                                        key_suffix=f"errornote_{_en_rec['id']}",
                                    )
                                except Exception as e:
                                    import traceback
                                    from datetime import datetime as _dt

                                    tb = traceback.format_exc()
                                    print(
                                        "[pdf-trace] errornote EXCEPTION:",
                                        flush=True,
                                    )
                                    print(tb, flush=True)
                                    try:
                                        with open(
                                            _ERROR_LOG_PATH, "a", encoding="utf-8"
                                        ) as _fh:
                                            _fh.write(
                                                f"\n===== {_dt.now().isoformat(timespec='seconds')}  "
                                                f"ERRORNOTE EXCEPTION =====\n{tb}\n"
                                            )
                                    except Exception:
                                        pass
                                    st.error(f"오답 노트 생성 오류: {e}")
                else:
                    st.info("틀린 문항이 없어 오답 노트를 생성할 필요가 없습니다.")

                st.divider()

                # ── 학부모에게 전송 (full-width, bottom of report) ─────
                with st.container(border=True):
                    st.markdown("#### 학부모에게 전송")
                    st.caption(
                        "아래 메시지를 복사하여 문자 또는 카카오톡으로 전송하세요."
                    )
                    _est_s = res.get("estimated_scores", [])
                    _topic_lines = (
                        "\n".join(
                            f"  • {ts.get('topic','—')}: {ts.get('estimated_pct',0)}%"
                            for ts in _est_s
                        )
                        if _est_s
                        else "  • (단원별 데이터 없음)"
                    )
                    _notes_text = res.get("teacher_notes", "—")
                    _parent_msg = (
                        f"[압구정 페르마 수학 성적 알림]\n\n"
                        f"날짜: {datetime.now().strftime('%Y년 %m월 %d일')}\n"
                        f"예상 점수: {overall}% ({grade}등급 {g_emoji})\n\n"
                        f"단원별 성취도:\n{_topic_lines}\n\n"
                        f"교사 총평:\n{_notes_text}\n\n"
                        f"— 압구정 페르마 수학 학원 드림"
                    )
                    st.text_area(
                        "전송 메시지 (전체 선택 후 복사: Ctrl+A → Ctrl+C)",
                        value=_parent_msg,
                        height=240,
                        key="parent_msg_area",
                    )

                st.divider()
                if st.button(
                    "리포트 초기화",
                    type="secondary",
                    width="stretch",
                    key="reset_report_btn",
                ):
                    st.session_state.pop("ocr_result", None)
                    st.rerun()


# ═══════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════


def _nav_teacher_selectbox() -> None:
    """강사 로그인 UI (4자리 비밀번호)."""
    teachers_df = get_all_teachers()
    logged_id = st.session_state.get("logged_in_teacher_id")

    if logged_id:
        name = st.session_state.get("logged_in_teacher_name", "")
        role = st.session_state.get("logged_in_teacher_role", "teacher")
        role_kr = _ROLE_KR.get(role, role)
        st.success(f"{name} ({role_kr}) 로그인 중")
        if st.button("로그아웃", key="nav_logout_btn", use_container_width=True, type="secondary"):
            st.session_state.pop("logged_in_teacher_id", None)
            st.session_state.pop("logged_in_teacher_name", None)
            st.session_state.pop("logged_in_teacher_role", None)
            st.session_state["current_teacher_id"] = None
            st.rerun()
    else:
        if teachers_df.empty:
            st.info("등록된 강사가 없습니다.")
            return
        teacher_opts = {r["name"]: int(r["id"]) for _, r in teachers_df.iterrows()}
        sel_name = st.selectbox("이름 선택", list(teacher_opts.keys()), key="nav_login_name")
        pw = st.number_input("비밀번호 (4자리)", min_value=0, max_value=9999,
                             step=1, format="%04d", key="nav_login_pw")
        if st.button("로그인", key="nav_login_btn", use_container_width=True, type="primary"):
            sel_id = teacher_opts[sel_name]
            row = teachers_df[teachers_df["id"] == sel_id].iloc[0]
            stored_pw = str(row.get("password", "") or "")
            input_pw = f"{int(pw):04d}"
            # 비밀번호 미설정 시 0000으로 로그인 허용
            if stored_pw == "" or stored_pw == input_pw:
                st.session_state["logged_in_teacher_id"] = sel_id
                st.session_state["logged_in_teacher_name"] = sel_name
                st.session_state["logged_in_teacher_role"] = str(row.get("role", "teacher") or "teacher")
                st.session_state["current_teacher_id"] = sel_id
                st.rerun()
            else:
                st.error("비밀번호가 올바르지 않습니다")


def _nav_teacher_admin() -> None:
    """강사 추가/삭제 (role, password 포함)."""
    teachers_df = get_all_teachers()
    _ROLE_OPTIONS = {"강사": "teacher", "관리자": "admin", "부원장": "vice", "원장": "director"}

    with st.form("add_teacher_form", clear_on_submit=True):
        new_name = st.text_input("강사 이름", max_chars=40, placeholder="예: 김선생")
        new_role_kr = st.selectbox("역할", list(_ROLE_OPTIONS.keys()), key="add_teacher_role")
        new_pw = st.number_input("비밀번호 (4자리, 미설정 시 0000)",
                                 min_value=0, max_value=9999, step=1, format="%04d", key="add_teacher_pw")
        if st.form_submit_button("강사 추가", type="primary", use_container_width=True):
            if not new_name.strip():
                st.error("강사 이름을 입력해 주세요.")
            else:
                try:
                    conn = get_conn()
                    from datetime import datetime as _dt
                    role_val = _ROLE_OPTIONS[new_role_kr]
                    pw_val = f"{int(new_pw):04d}"
                    conn.execute(
                        "INSERT INTO teachers (name, created_at, password, role) VALUES (?, ?, ?, ?)",
                        (new_name.strip(), _dt.now().isoformat(), pw_val, role_val),
                    )
                    _commit(conn)
                    conn.close()
                    st.success(f"강사 **{new_name.strip()}** 추가됨")
                    st.rerun()
                except Exception:
                    st.error("같은 이름의 강사가 이미 존재합니다.")

    if not teachers_df.empty:
        del_opts = {r["name"]: int(r["id"]) for _, r in teachers_df.iterrows()}
        sel_del = st.selectbox("삭제할 강사", list(del_opts.keys()), key="nav_t_del")
        if st.button("강사 삭제", key="nav_t_del_btn", use_container_width=True, type="primary"):
            cur_tid = _current_teacher_id()
            delete_teacher(del_opts[sel_del])
            if cur_tid == del_opts[sel_del]:
                st.session_state["current_teacher_id"] = None
                st.session_state.pop("logged_in_teacher_id", None)
            st.warning(f"강사 **{sel_del}** 이(가) 삭제되었습니다.")
            st.rerun()


def _nav_footer_stats() -> None:
    try:
        sn = len(get_all_students())
        cn = len(get_all_classes())
        tn = len(get_all_teachers())
        st.caption(f"학생 {sn} · 수업 {cn} · 강사 {tn}")
    except Exception:
        pass
    st.caption("데이터 동기화: 정상")


def render_app_navigation() -> str:
    """Fixed left nav (HTML) + teacher widgets. No ``st.sidebar``."""
    return render_fixed_nav_rail(
        teacher_selectbox_fn=_nav_teacher_selectbox,
        teacher_admin_fn=_nav_teacher_admin,
        footer_stats_fn=_nav_footer_stats,
    )


def page_attendance_sheet() -> None:
    """출석부 만들기 — 반/년/월 선택 후 인쇄용 A4 출석부 HTML 생성."""
    import json as _json
    import calendar

    _page_header("출석부 만들기", "반과 월을 선택하면 인쇄용 출석부가 자동 생성됩니다.")

    classes_df = get_all_classes(_current_teacher_id())
    if classes_df.empty:
        st.info("등록된 수업이 없습니다. 먼저 내 수업 관리에서 수업을 만들어 주세요.")
        return

    with st.container(border=True):
        c1, c2, c3 = st.columns(3)
        class_opts = {r["name"]: int(r["id"]) for _, r in classes_df.iterrows()}
        sel_cls_name = c1.selectbox("반 선택", list(class_opts.keys()), key="as_class")
        sel_year = c2.number_input("년도", min_value=2020, max_value=2035,
                                   value=date.today().year, step=1, key="as_year")
        sel_month = c3.selectbox("월", list(range(1, 13)),
                                 index=date.today().month - 1, key="as_month",
                                 format_func=lambda m: f"{m}월")

    sel_cls_id = class_opts[sel_cls_name]
    cls_row = classes_df[classes_df["id"] == sel_cls_id].iloc[0]
    teacher_name = str(cls_row.get("teacher_name") or "—")
    schedule_raw = str(cls_row.get("schedule") or "[]")

    try:
        slots = _json.loads(schedule_raw)
        class_days_kor = list(dict.fromkeys(s["day"] for s in slots if "day" in s))
    except Exception:
        class_days_kor = []

    if not class_days_kor:
        desc = str(cls_row.get("description") or "")
        for d in ["월","화","수","목","금","토","일"]:
            if d in desc:
                class_days_kor.append(d)

    day_kor_to_weekday = {"월":0,"화":1,"수":2,"목":3,"금":4,"토":5,"일":6}
    target_weekdays = {day_kor_to_weekday[d] for d in class_days_kor if d in day_kor_to_weekday}
    year, month = int(sel_year), int(sel_month)
    _, last_day = calendar.monthrange(year, month)
    session_dates = [date(year, month, d) for d in range(1, last_day+1)
                     if date(year, month, d).weekday() in target_weekdays]
    kor_weekday = ["월","화","수","목","금","토","일"]
    date_headers = [f"{d.day}({kor_weekday[d.weekday()]})" for d in session_dates]

    students_df = get_students_by_class(sel_cls_id)
    n_stu = len(students_df)

    with st.container(border=True):
        st.markdown(f"**{sel_cls_name}** · {year}년 {month}월 · 담임강사: {teacher_name}")
        if class_days_kor:
            st.caption(f"수업 요일: {chr(183).join(class_days_kor)} — {len(session_dates)}회 수업")
        else:
            st.warning("이 반의 수업 요일이 설정되지 않았습니다. 신규 수업에서 요일을 설정해주세요.")
        st.caption(f"학생 수: {n_stu}명")

    if not date_headers:
        st.info("선택한 월에 해당 요일의 수업이 없습니다.")
        return

    # 학생 수에 따라 표시할 행 수 결정 (최소 10행)
    BASE_ROWS = max(10, n_stu)

    # 비고 표시 여부: 인쇄 시 행 높이 8mm 기준으로 계산
    # 브라우저 인쇄 가용 높이 약 155mm (머리글/바닥글 포함)
    # 헤더 10mm + thead 7mm + 행 8mm*BASE_ROWS
    PRINT_AVAIL_MM = 155
    used_print_mm  = 10 + 7 + BASE_ROWS * 8
    show_bigo = (PRINT_AVAIL_MM - used_print_mm) >= 8

    student_rows_html = ""
    for i in range(BASE_ROWS):
        num = i + 1
        if not students_df.empty and i < n_stu:
            stu = students_df.iloc[i]
            name          = str(stu.get("name", "") or "")
            school        = str(stu.get("school", "") or "")
            grade         = str(stu.get("grade", "") or "")
            parent_phone  = str(stu.get("parent_phone", "") or "")
            student_phone = str(stu.get("student_phone", "") or "")
            school_grade  = f"{school}<br>{grade}".strip("<br>") if school or grade else ""
            phone_parts = []
            if parent_phone:
                phone_parts.append(f"모: {parent_phone}")
            if student_phone:
                phone_parts.append(f"학생: {student_phone}")
            phone_html = "<br>".join(phone_parts)
        else:
            name = school_grade = phone_html = ""

        date_cells = "".join('<td class="date-cell"></td>' for _ in date_headers)
        student_rows_html += f"""
        <tr>
            <td class="num-cell">{num}</td>
            <td class="name-cell">{name}</td>
            <td class="info-cell">{school_grade}</td>
            <td class="phone-cell">{phone_html}</td>
            {date_cells}
        </tr>"""

    date_header_cells = "".join(f'<th class="date-header" style="background-color:#ececec;">{h}</th>' for h in date_headers)
    n_date_cols = len(date_headers)

    if show_bigo:
        bigo_row = f"""
        <tr class="bigo-row">
            <td colspan="4" class="bigo-label" style="background-color:#ececec;">비고</td>
            <td colspan="{n_date_cols}" class="bigo-content"></td>
        </tr>"""
    else:
        bigo_row = ""

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  @page {{ size: A4 landscape; margin: 10mm;
    @top-left {{ content: none; }} @top-center {{ content: none; }} @top-right {{ content: none; }}
    @bottom-left {{ content: none; }} @bottom-center {{ content: none; }} @bottom-right {{ content: none; }}
  }}
  @media print {{
    html, body {{ margin: 0 !important; padding: 0 !important; background: white !important; height: 100% !important; }}
    .no-print {{ display: none !important; }}
    .sheet {{ box-shadow: none !important; padding: 4mm 6mm !important; width: 100% !important; height: 100% !important; display: flex !important; flex-direction: column !important; }}
    * {{ -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }}
    th, td {{ height: 10mm !important; padding: 1mm !important; }}
    thead th {{ height: 8mm !important; }}
    .title-row {{ min-height: 10mm !important; margin-bottom: 1mm !important; padding-bottom: 1mm !important; }}
    .title-main {{ font-size: 18pt !important; }}
    .title-divider {{ margin: 0 0 2mm 0 !important; }}
    table {{ flex: 1 !important; height: 100% !important; }}
    .bigo-row {{ height: auto !important; }}
    .bigo-row td {{ height: auto !important; }}
  }}
  * {{ box-sizing: border-box; font-family: '맑은 고딕', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; margin:0; padding:0; -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }}
  body {{
    background: #e0e0e0;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px;
  }}
  .sheet {{
    background: white;
    width: 277mm;
    padding: 8mm 8mm 6mm 8mm;
    box-shadow: 0 2px 10px rgba(0,0,0,0.25);
  }}
  .title-row {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2mm;
    padding-bottom: 2mm;
    min-height: 14mm;
  }}
  .title-divider {{
    border: none;
    border-top: 2.5px solid #111;
    margin: 0 0 3mm 0;
  }}
  .title-spacer {{ flex: 1; }}
  .title-main {{
    flex: 1;
    font-size: 22pt;
    font-weight: 900;
    letter-spacing: -0.5px;
    white-space: nowrap;
    text-align: center;
  }}
  .title-info {{ text-align: right; white-space: nowrap; }}
  .info-line {{ margin-bottom: 2px; }}
  .info-line .label {{
    font-size: 10pt;
    color: #111;
    font-weight: 800;
  }}
  .info-line .value {{
    font-size: 13pt;
    font-weight: 800;
    color: #111;
  }}
  table {{ width: 100%; border-collapse: collapse; font-size: 10pt; }}
  th, td {{
    border: 1px solid #333;
    text-align: center;
    vertical-align: middle;
    padding: 1mm 1mm;
    height: 10.5mm;
  }}
  thead th {{ background-color: #ececec; font-weight: 700; height: 9mm; }}
  .num-cell   {{ width: 7mm; font-weight: bold; }}
  .name-cell  {{ width: 18mm; font-weight: 600; }}
  .info-cell  {{ width: 24mm; font-size: 9pt; line-height: 1.5; }}
  .phone-cell {{ width: 40mm; font-size: 9pt; text-align: left; padding-left: 2mm; line-height: 1.6; white-space: nowrap; }}
  .date-header {{ font-size: 9pt; background-color: #ececec; font-weight: 700; }}
  .date-cell  {{ min-width: 10mm; }}
  .bigo-label  {{ font-weight: 800; background-color: #ececec; font-size: 10pt; }}
  .bigo-content {{ text-align: left; }}
</style>
</head>
<body>
<div class="sheet">
  <div class="title-row">
    <div class="title-spacer"></div>
    <div class="title-main">{year}년 {month}월 출석부</div>
    <div class="title-info" style="flex:1; text-align:right;">
      <div class="info-line">
        <span class="label">반&nbsp;&nbsp;</span>
        <span class="value">{sel_cls_name}</span>
      </div>
      <div class="info-line">
        <span class="label">담임강사&nbsp;&nbsp;</span>
        <span class="value">{teacher_name}</span>
      </div>
    </div>
  </div>
  <hr class="title-divider">
  <table>
    <thead>
      <tr>
        <th class="num-cell" style="background-color:#ececec;">번호</th>
        <th class="name-cell" style="background-color:#ececec;">이름</th>
        <th class="info-cell" style="background-color:#ececec;">학교/학년</th>
        <th class="phone-cell" style="background-color:#ececec;">연락처</th>
        {date_header_cells}
      </tr>
    </thead>
    <tbody>
      {student_rows_html}
      {bigo_row}
    </tbody>
  </table>
</div>
<div class="no-print" style="margin-top:14px; text-align:center;">
  <button onclick="window.print()"
    style="padding:10px 36px;font-size:13pt;background:#1a56db;color:white;
           border:none;border-radius:6px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,0.2);">
    🖨️ 인쇄
  </button>
</div>
</body>
</html>"""

    st.markdown("---")
    st.markdown("#### 출석부 미리보기")
    import streamlit.components.v1 as components
    components.html(html, height=680, scrolling=True)

    st.markdown("---")
    col1, col2 = st.columns([1, 1])
    with col1:
        st.caption("🖨️ 미리보기 안 [인쇄] 버튼으로 브라우저 인쇄 가능")
    with col2:
        try:
            from weasyprint import HTML as WeasyprintHTML
            pdf_html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
  @page {{ size: A4 landscape; margin: 10mm; }}
  @page {{ @top-left {{ content: none; }} @top-center {{ content: none; }} @top-right {{ content: none; }}
           @bottom-left {{ content: none; }} @bottom-center {{ content: none; }} @bottom-right {{ content: none; }} }}
  * {{ box-sizing: border-box; font-family: '맑은 고딕', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif;
       margin: 0; padding: 0;
       -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }}
  body {{ background: white; margin: 0; padding: 0; }}
  .title-row {{
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 2mm; padding-bottom: 2mm; min-height: 14mm;
  }}
  .title-divider {{ border: none; border-top: 2.5px solid #111; margin: 0 0 3mm 0; }}
  .title-spacer {{ flex: 1; }}
  .title-main {{
    flex: 1; font-size: 22pt; font-weight: 900;
    letter-spacing: -0.5px; white-space: nowrap; text-align: center;
  }}
  .title-info {{ text-align: right; white-space: nowrap; }}
  .info-line {{ margin-bottom: 2px; }}
  .info-line .label {{ font-size: 10pt; color: #111; font-weight: 800; }}
  .info-line .value {{ font-size: 13pt; font-weight: 800; color: #111; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 10pt; }}
  th, td {{
    border: 1px solid #333; text-align: center;
    vertical-align: middle; padding: 1mm 1mm; height: 10.5mm;
  }}
  thead th {{ background-color: #ececec !important; font-weight: 700; height: 9mm; }}
  .num-cell   {{ width: 7mm; font-weight: bold; }}
  .name-cell  {{ width: 18mm; font-weight: 600; }}
  .info-cell  {{ width: 24mm; font-size: 9pt; line-height: 1.5; }}
  .phone-cell {{ width: 40mm; font-size: 9pt; text-align: left; padding-left: 2mm; line-height: 1.6; white-space: nowrap; }}
  .date-header {{ font-size: 9pt; background-color: #ececec !important; font-weight: 700; }}
  .date-cell  {{ min-width: 10mm; }}
  .bigo-label  {{ font-weight: 800; background-color: #ececec !important; font-size: 10pt; }}
  .bigo-content {{ text-align: left; }}
</style>
</head>
<body>
  <div class="title-row">
    <div class="title-spacer"></div>
    <div class="title-main">{year}년 {month}월 출석부</div>
    <div class="title-info" style="flex:1; text-align:right;">
      <div class="info-line">
        <span class="label">반&nbsp;&nbsp;</span>
        <span class="value">{sel_cls_name}</span>
      </div>
      <div class="info-line">
        <span class="label">담임강사&nbsp;&nbsp;</span>
        <span class="value">{teacher_name}</span>
      </div>
    </div>
  </div>
  <hr class="title-divider">
  <table>
    <thead>
      <tr>
        <th class="num-cell">번호</th>
        <th class="name-cell">이름</th>
        <th class="info-cell">학교/학년</th>
        <th class="phone-cell">연락처</th>
        {date_header_cells}
      </tr>
    </thead>
    <tbody>
      {student_rows_html}
      {bigo_row}
    </tbody>
  </table>
</body>
</html>"""
            pdf_bytes = WeasyprintHTML(string=pdf_html).write_pdf()
            fname = f"출석부_{sel_cls_name}_{year}년{month}월.pdf"
            st.download_button(
                label="📄 PDF 다운로드",
                data=pdf_bytes,
                file_name=fname,
                mime="application/pdf",
                key="as_pdf_download",
            )
        except Exception as e:
            st.error(f"PDF 생성 실패: {e}")


def main():
    st.set_page_config(
        page_title="압구정 페르마 수학 · 교육 관리 대시보드",
        layout="wide",
        initial_sidebar_state="collapsed",
    )
    init_db()
    sync_all_csvs()
    _init_app_settings_session()
    _register_korean_font()
    _inject_theme()
    sync_nav_from_query()

    nav_col, body_col = st.columns([1, 4.5], gap="small")

    with nav_col:
        selected = render_app_navigation()

    with body_col:
        classes_df = get_all_classes(_current_teacher_id())

        if selected == "대시보드":
            page_dashboard_overview()
        elif selected == "내 수업 관리":
            page_classes()
        elif selected == "학생 명부":
            page_students()
        elif selected == "출석 관리":
            page_attendance(classes_df)
        elif selected == "출석부 만들기":
            page_attendance_sheet()
        elif selected == "수강료 관리":
            page_tuition()
        elif selected == "상담 일지":
            page_consultation()
        elif selected == "성적 리포트":
            _page_header(
                "성적 리포트",
                "대시보드형 성적 조회 · 추이 그래프, 학교·모의 입력, 통합 보고서 작성, 학원시험 AI분석.",
            )
            page_grade_report()
        elif selected == "문제 은행":
            _page_header(
                "문제 은행",
                "문제집 OCR 등록, 검수, DB 저장 — 유사문제 추출의 데이터 소스입니다.",
            )
            render_question_bank_page(sync_csvs=sync_all_csvs)
        elif selected == "기출문제분석":
            _page_header(
                "기출문제분석",
                "기출문제를 분석하고 출제 경향을 확인합니다.",
            )
            render_past_exam_analyzer_page()
        elif selected == "설정":
            page_settings()


def page_settings() -> None:
    """설정 — API 키 안내 · PDF 저장 경로."""
    _init_app_settings_session()
    st.markdown("## 설정")
    st.divider()

    _, centre, _ = st.columns([1, 3, 1])

    with centre:
        with st.container(border=True):
            st.markdown("### PDF 저장 경로")
            st.caption(
                "학부모용 리포트·오답노트 PDF가 저장되는 폴더입니다. "
                "경로는 `data/app_settings.json`에 저장되어 재시작 후에도 유지됩니다."
            )
            pdf_dir = st.text_input(
                "PDF 저장 경로",
                key="pdf_save_dir",
                placeholder=DEFAULT_PDF_SAVE_DIR,
            )
            if st.button("경로 저장", type="primary", key="settings_save_pdf_dir_btn"):
                chosen = (pdf_dir or "").strip() or DEFAULT_PDF_SAVE_DIR
                st.session_state["pdf_save_dir"] = chosen
                settings = _read_app_settings_file()
                settings["pdf_save_dir"] = chosen
                _write_app_settings_file(settings)
                try:
                    os.makedirs(chosen, exist_ok=True)
                    st.success(f"저장 경로가 설정되었습니다: `{chosen}`")
                except OSError as exc:
                    st.error(f"폴더를 만들 수 없습니다: {exc}")
            st.caption(f"현재 적용 경로: `{get_pdf_save_directory()}`")

        st.markdown("")

        with st.container(border=True):
            st.markdown("### OpenAI API 키 (.env)")
            st.caption(
                "API 키는 **코드·세션에 저장하지 않습니다**. "
                "`streamlit-app/.env` 파일에서 `python-dotenv`로 불러옵니다."
            )

            env_path = os.path.join(os.path.dirname(__file__), ".env")
            key = resolve_api_key()

            if key:
                masked = key[:7] + "•" * 16
                st.success(f"`.env`에서 API 키가 로드되었습니다: `{masked}`")
            else:
                st.warning(
                    "API 키가 설정되지 않았습니다. 아래 절차에 따라 `.env` 파일을 만드세요.",
                )

            st.markdown("")
            st.markdown("**설정 방법**")
            st.markdown(
                "1. `streamlit-app/.env.example`을 복사하여 `.env` 생성\n"
                "2. `OPENAI_API_KEY=sk-...` 입력 후 저장\n"
                "3. 앱 재시작 (`streamlit run app.py`)\n"
                f"4. 예상 경로: `{env_path}`"
            )
            st.code("copy .env.example .env", language="powershell")

        st.markdown("")

        with st.container(border=True):
            st.markdown("### 도움말")
            st.markdown(
                "- **시뮬레이션 모드** — `.env` 없이도 UI를 사용할 수 있으며, "
                "리포트는 샘플 데이터로 표시됩니다.\n"
                "- **보안** — `.env`는 `.gitignore`에 포함되어 Git에 올라가지 않습니다.\n"
                "- **키 발급** — [platform.openai.com/api-keys](https://platform.openai.com/api-keys)"
            )


if __name__ == "__main__":
    main()
