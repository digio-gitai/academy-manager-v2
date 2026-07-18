"""SQLite helpers for persisting grade analysis reports in students.db.

Public API (used by app.py):
  - ensure_grade_reports_table()  — create grade_reports table on startup
  - ensure_students_test_results_column() — add students.test_results JSON column
  - seed_test_classroom()         — demo class + students A,B,C,D
  - save_grade_report(report, ...) — INSERT after AI report generation
  - append_student_test_result(...) — append wrong-answer record to students.test_results
  - get_student_test_results(...) — load accumulated test_results for one student
  - get_all_student_test_results(...) — flatten test_results rows
  - get_class_test_catalog(class_id) — distinct tests for a class
  - get_class_exam_scores(class_id, test_name, test_date) — scores + class average
  - get_class_average_for_exam(...) — DB mean for one class exam (None if no data)
  - get_student_test_entry(...) — one test_results record for a student
  - get_grade_report_for_exam(...) — AI analysis JSON for an exam
  - get_student_profile(student_id) — name + class info
  - get_student_grade_history(name) — SELECT past scores for one student
  - get_all_grade_records(...)    — SELECT all stored grade rows
  - get_grade_report_by_id(id)      — reload full report JSON by row id
"""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pandas as pd

DB_PATH = Path(__file__).resolve().parent / "students.db"

TEST_CLASS_NAME = "테스트 반"
TEST_STUDENT_NAMES = ("A", "B", "C", "D")
TEST_TEACHER_NAME = "테스트 강사"

_INVALID_NUMERIC_STRINGS = frozenset(
    {
        "",
        "-",
        "—",
        "–",
        "−",
        "미응시",
        "n/a",
        "na",
        "none",
        "null",
        "none",
    }
)


def _is_invalid_numeric_token(value: Any) -> bool:
    if value is None:
        return True
    try:
        if pd.isna(value):
            return True
    except (TypeError, ValueError):
        pass
    if isinstance(value, str):
        return value.strip().lower() in _INVALID_NUMERIC_STRINGS or value.strip() in {
            "—",
            "-",
            "–",
        }
    return False


def coerce_numeric(value: Any, *, default: float = 0.0) -> float:
    """Convert value to float; map ``-``, ``—``, empty, etc. to ``default``."""
    if _is_invalid_numeric_token(value):
        return float(default)
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if text.lower() in _INVALID_NUMERIC_STRINGS or text in {"—", "-", "–"}:
        return float(default)
    num = pd.to_numeric(text, errors="coerce")
    if pd.isna(num):
        return float(default)
    return float(num)


def coerce_optional_numeric(value: Any) -> float | None:
    """Like :func:`coerce_numeric` but returns ``None`` for invalid/missing."""
    if _is_invalid_numeric_token(value):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    num = pd.to_numeric(str(value).strip(), errors="coerce")
    if pd.isna(num):
        return None
    return float(num)


def sanitize_numeric_columns(
    df: pd.DataFrame,
    *,
    int_columns: tuple[str, ...] = ("wrong_count",),
    float_columns: tuple[str, ...] = (
        "score",
        "avg_score",
        "student_score",
        "class_average",
        "score_gap",
        "overall_pct",
    ),
    int_default: float = 0.0,
    float_keep_nan: bool = True,
) -> pd.DataFrame:
    """Normalize numeric columns for pandas / PyArrow (``errors='coerce'``)."""
    if df.empty:
        return df
    out = df.copy()
    token_pat = list(_INVALID_NUMERIC_STRINGS | {"—", "-", "–"})

    for col in int_columns:
        if col not in out.columns:
            continue
        series = out[col].replace(token_pat, pd.NA)
        out[col] = (
            pd.to_numeric(series, errors="coerce").fillna(int_default).astype(int)
        )

    for col in float_columns:
        if col not in out.columns:
            continue
        series = out[col].replace(token_pat, pd.NA)
        converted = pd.to_numeric(series, errors="coerce")
        out[col] = converted if float_keep_nan else converted.fillna(int_default)

    return out


_GRADE_REPORTS_DDL = """
CREATE TABLE IF NOT EXISTS grade_reports (
    id             SERIAL PRIMARY KEY,
    student_id     INTEGER REFERENCES students(id) ON DELETE SET NULL,
    student_name   TEXT NOT NULL,
    exam_date      TEXT NOT NULL,
    exam_name      TEXT NOT NULL DEFAULT '',
    student_score  REAL NOT NULL,
    class_average  REAL NOT NULL,
    score_gap      REAL NOT NULL,
    report_mode    TEXT NOT NULL DEFAULT 'ai',
    report_json    TEXT NOT NULL,
    created_at     TEXT NOT NULL
)
"""


def ensure_students_test_results_column(conn: sqlite3.Connection | None = None) -> None:
    """Add ``students.test_results`` JSON column if missing (legacy DB migration)."""
    own_conn = conn is None
    if own_conn:
        conn = get_conn()
    try:
        cols = [
            row[1] for row in conn.execute(
                "SELECT ordinal_position, column_name FROM information_schema.columns WHERE table_name = 'students'"
            ).fetchall()
        ]
        if "test_results" not in cols:
            conn.execute(
                "ALTER TABLE students ADD COLUMN test_results TEXT DEFAULT '[]'"
            )
        if own_conn:
            conn.commit()
    finally:
        if own_conn:
            conn.close()


def _parse_test_results_json(raw: str | None) -> list[dict[str, Any]]:
    """Parse ``students.test_results`` JSON array; invalid/empty → ``[]``."""
    if not raw or not str(raw).strip():
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    return [item for item in data if isinstance(item, dict)]


def _normalize_wrong_numbers(wrong_numbers: list[int] | tuple[int, ...]) -> list[int]:
    seen: set[int] = set()
    normalized: list[int] = []
    for n in wrong_numbers:
        try:
            num = int(n)
        except (TypeError, ValueError):
            continue
        if num < 1 or num in seen:
            continue
        seen.add(num)
        normalized.append(num)
    return sorted(normalized)


def _resolve_student_row(
    conn: sqlite3.Connection,
    *,
    student_id: int | None,
    student_name: str | None,
) -> tuple[int, str] | None:
    if student_id is not None:
        row = conn.execute(
            "SELECT id, name FROM students WHERE id = ?",
            (int(student_id),),
        ).fetchone()
        if row:
            return int(row[0]), str(row[1])
    if student_name and student_name.strip():
        row = conn.execute(
            "SELECT id, name FROM students WHERE name = ? COLLATE NOCASE LIMIT 1",
            (student_name.strip(),),
        ).fetchone()
        if row:
            return int(row[0]), str(row[1])
    return None


def append_student_test_result(
    *,
    student_id: int | None = None,
    student_name: str | None = None,
    test_name: str,
    wrong_numbers: list[int] | tuple[int, ...],
    score: float,
    test_date: str | None = None,
) -> dict[str, Any]:
    """Append one test record to ``students.test_results`` (never overwrites history).

    Each entry: ``{test_name, date, wrong_numbers, score, recorded_at}``.
    Returns ``{student_id, student_name, entry, total_records}``.
    """
    ensure_students_test_results_column()

    test_date = (test_date or date.today().isoformat()).strip()
    recorded_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    entry: dict[str, Any] = {
        "test_name": (test_name or "").strip() or "테스트",
        "date": test_date,
        "wrong_numbers": _normalize_wrong_numbers(wrong_numbers),
        "score": float(score),
        "recorded_at": recorded_at,
    }

    conn = get_conn()
    try:
        resolved = _resolve_student_row(
            conn,
            student_id=student_id,
            student_name=student_name,
        )
        if not resolved:
            raise ValueError(
                "학생을 찾을 수 없습니다. student_id 또는 student_name을 확인해 주세요."
            )
        sid, sname = resolved

        row = conn.execute(
            "SELECT test_results FROM students WHERE id = ?",
            (sid,),
        ).fetchone()
        history = _parse_test_results_json(row[0] if row else None)
        history.append(entry)

        conn.execute(
            "UPDATE students SET test_results = ? WHERE id = ?",
            (json.dumps(history, ensure_ascii=False), sid),
        )
        conn.commit()
        return {
            "student_id": sid,
            "student_name": sname,
            "entry": entry,
            "total_records": len(history),
        }
    finally:
        conn.close()


def get_student_test_results(
    *,
    student_id: int | None = None,
    student_name: str | None = None,
) -> list[dict[str, Any]]:
    """Load accumulated ``test_results`` for one student (oldest → newest)."""
    ensure_students_test_results_column()

    conn = get_conn()
    try:
        resolved = _resolve_student_row(
            conn,
            student_id=student_id,
            student_name=student_name,
        )
        if not resolved:
            return []
        sid, _ = resolved
        row = conn.execute(
            "SELECT test_results FROM students WHERE id = ?",
            (sid,),
        ).fetchone()
        return _parse_test_results_json(row[0] if row else None)
    finally:
        conn.close()


def get_all_student_test_results(
    *,
    class_id: int | None = None,
    class_name: str | None = None,
    student_names: tuple[str, ...] | None = None,
) -> pd.DataFrame:
    """Flatten ``students.test_results`` into rows (one row per test record)."""
    ensure_students_test_results_column()

    sql = """
        SELECT
            s.id AS student_id,
            s.name AS student_name,
            COALESCE(c.name, '—') AS class_name,
            c.id AS class_id,
            s.test_results
        FROM students s
        LEFT JOIN classes c ON c.id = s.class_id
        WHERE 1 = 1
    """
    params: list[Any] = []

    if class_id is not None:
        sql += " AND c.id = ?"
        params.append(int(class_id))

    if class_name:
        sql += " AND c.name = ?"
        params.append(class_name)

    if student_names:
        placeholders = ", ".join("?" for _ in student_names)
        sql += f" AND s.name IN ({placeholders})"
        params.extend(student_names)

    sql += " ORDER BY s.name ASC"

    conn = get_conn()
    try:
        rows = conn.execute(sql, params or []).fetchall()
    finally:
        conn.close()

    flat: list[dict[str, Any]] = []
    for sid, sname, cname, cid, raw in rows:
        for item in _parse_test_results_json(raw):
            flat.append(
                {
                    "student_id": sid,
                    "student_name": sname,
                    "class_name": cname,
                    "class_id": cid,
                    "test_name": item.get("test_name", ""),
                    "date": item.get("date", ""),
                    "wrong_numbers": json.dumps(
                        item.get("wrong_numbers") or [],
                        ensure_ascii=False,
                    ),
                    "wrong_count": len(item.get("wrong_numbers") or []),
                    "score": item.get("score"),
                    "recorded_at": item.get("recorded_at", ""),
                }
            )
    df = pd.DataFrame(flat)
    return sanitize_numeric_columns(
        df,
        int_columns=("wrong_count",),
        float_columns=("score",),
        float_keep_nan=True,
    )


def get_class_test_catalog(class_id: int) -> pd.DataFrame:
    """List distinct tests recorded for students in a class (newest first)."""
    df = get_all_student_test_results(class_id=int(class_id))
    if df.empty:
        return pd.DataFrame(
            columns=[
                "test_name",
                "date",
                "student_count",
                "avg_score",
                "latest_recorded",
            ]
        )

    catalog = (
        df.groupby(["test_name", "date"], as_index=False)
        .agg(
            student_count=("student_id", "nunique"),
            avg_score=("score", "mean"),
            latest_recorded=("recorded_at", "max"),
        )
        .sort_values(["date", "test_name"], ascending=[False, False])
        .reset_index(drop=True)
    )
    return catalog


def get_class_exam_scores(
    class_id: int,
    test_name: str,
    test_date: str,
) -> dict[str, Any]:
    """Load all students in a class for one exam; compute class average from recorded scores.

    Returns:
        {
            "class_id", "class_name", "test_name", "test_date",
            "class_average", "recorded_count", "total_students",
            "scores": DataFrame[student_id, student_name, score, wrong_count, has_record],
        }
    """
    ensure_students_test_results_column()

    conn = get_conn()
    try:
        class_row = conn.execute(
            "SELECT name FROM classes WHERE id = ?",
            (int(class_id),),
        ).fetchone()
        class_name = str(class_row[0]) if class_row else "—"

        students = conn.execute(
            "SELECT id, name FROM students WHERE class_id = ? ORDER BY name",
            (int(class_id),),
        ).fetchall()
    finally:
        conn.close()

    student_ids = [int(s[0]) for s in students]
    results = get_all_student_test_results(class_id=int(class_id))
    exam_rows = results[
        (results["test_name"] == test_name.strip())
        & (results["date"] == test_date.strip())
    ].copy()

    if not exam_rows.empty:
        exam_rows = (
            exam_rows.sort_values("recorded_at")
            .groupby("student_id", as_index=False)
            .last()
        )

    score_rows: list[dict[str, Any]] = []
    for sid, sname in students:
        sid = int(sid)
        match = exam_rows[exam_rows["student_id"] == sid]
        if match.empty:
            score_rows.append(
                {
                    "student_id": sid,
                    "student_name": str(sname),
                    "score": None,
                    "wrong_count": 0,
                    "has_record": False,
                }
            )
        else:
            row = match.iloc[0]
            score_rows.append(
                {
                    "student_id": sid,
                    "student_name": str(sname),
                    "score": coerce_optional_numeric(row.get("score")),
                    "wrong_count": int(
                        coerce_numeric(row.get("wrong_count"), default=0)
                    ),
                    "has_record": True,
                }
            )

    scores_df = sanitize_numeric_columns(
        pd.DataFrame(score_rows),
        int_columns=("wrong_count",),
        float_columns=("score",),
        float_keep_nan=True,
    )
    recorded = scores_df[scores_df["has_record"] & scores_df["score"].notna()]
    class_average = float(recorded["score"].mean()) if not recorded.empty else None

    return {
        "class_id": int(class_id),
        "class_name": class_name,
        "test_name": test_name.strip(),
        "test_date": test_date.strip(),
        "class_average": class_average,
        "recorded_count": int(len(recorded)),
        "total_students": len(students),
        "scores": scores_df,
    }


def get_class_average_for_exam(
    class_id: int,
    test_name: str,
    test_date: str,
    *,
    extra_scores: dict[int, float] | None = None,
) -> float | None:
    """Compute class mean for one exam from ``test_results``.

    ``extra_scores`` merges in not-yet-saved scores ``{student_id: score}``.
    Returns ``None`` when no score records exist (never returns 0 as a fake average).
    """
    data = get_class_exam_scores(class_id, test_name, test_date)
    scores_df = data["scores"].copy()

    if extra_scores:
        for sid, score in extra_scores.items():
            if score is None:
                continue
            mask = scores_df["student_id"] == int(sid)
            if mask.any():
                scores_df.loc[mask, "score"] = float(score)
                scores_df.loc[mask, "has_record"] = True

    recorded = scores_df[scores_df["has_record"] & scores_df["score"].notna()]
    if recorded.empty:
        return None
    return float(recorded["score"].mean())


def get_conn():
    from db_connect import get_conn as _get_supabase_conn
    return _get_supabase_conn()


def ensure_grade_reports_table(conn: sqlite3.Connection | None = None) -> None:
    """Create grade_reports table if it does not exist."""
    own_conn = conn is None
    if own_conn:
        conn = get_conn()
    try:
        conn.execute(_GRADE_REPORTS_DDL)
        if own_conn:
            conn.commit()
    finally:
        if own_conn:
            conn.close()


def seed_test_classroom(conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Ensure demo class '테스트 반'exists with students A, B, C, D."""
    own_conn = conn is None
    if own_conn:
        conn = get_conn()
    try:
        ensure_students_test_results_column(conn)
        trow = conn.execute(
            "SELECT id FROM teachers WHERE name = ?",
            (TEST_TEACHER_NAME,),
        ).fetchone()
        if trow:
            teacher_id = int(trow[0])
        else:
            cur = conn.execute(
                """
                INSERT INTO teachers (name, created_at)
                VALUES (?, ?) RETURNING id
                """,
                (TEST_TEACHER_NAME, datetime.now().strftime("%Y-%m-%d %H:%M")),
            )
            teacher_id = int(cur.fetchone()[0])

        row = conn.execute(
            "SELECT id FROM classes WHERE name = ?",
            (TEST_CLASS_NAME,),
        ).fetchone()
        if row:
            class_id = int(row[0])
            conn.execute(
                "UPDATE classes SET teacher_id = ? WHERE id = ?",
                (teacher_id, class_id),
            )
        else:
            cur = conn.execute(
                """
                INSERT INTO classes (name, description, teacher_id)
                VALUES (?, ?, ?) RETURNING id
                """,
                (TEST_CLASS_NAME, "데모·테스트용 반 (자동 생성)", teacher_id),
            )
            class_id = int(cur.fetchone()[0])

        student_ids: dict[str, int] = {}
        registered_at = datetime.now().strftime("%Y-%m-%d %H:%M")
        for name in TEST_STUDENT_NAMES:
            existing = conn.execute(
                """
                SELECT id FROM students
                WHERE name = ? AND class_id = ?
                """,
                (name, class_id),
            ).fetchone()
            if existing:
                student_ids[name] = int(existing[0])
            else:
                cur = conn.execute(
                    """
                    INSERT INTO students (name, parent_phone, class_id, registered_at)
                    VALUES (?, ?, ?, ?) RETURNING id
                    """,
                    (name, "010-0000-0000", class_id, registered_at),
                )
                student_ids[name] = int(cur.fetchone()[0])

        if own_conn:
            conn.commit()
        return {
            "class_id": class_id,
            "class_name": TEST_CLASS_NAME,
            "teacher_id": teacher_id,
            "teacher_name": TEST_TEACHER_NAME,
            "student_ids": student_ids,
        }
    finally:
        if own_conn:
            conn.close()


def _student_name_by_id(conn: sqlite3.Connection, student_id: int) -> str | None:
    row = conn.execute(
        "SELECT name FROM students WHERE id = ?",
        (int(student_id),),
    ).fetchone()
    return str(row[0]) if row else None


def _resolve_student_id(conn: sqlite3.Connection, student_name: str) -> int | None:
    row = conn.execute(
        "SELECT id FROM students WHERE name = ? COLLATE NOCASE LIMIT 1",
        (student_name.strip(),),
    ).fetchone()
    return int(row[0]) if row else None


def _extract_scores(report: dict[str, Any]) -> tuple[str, float, float, float, str]:
    student_name = (report.get("student_name") or "학생").strip() or "학생"
    sc = report.get("score_comparison") or {}
    student_score = float(sc.get("student_score", 0))
    class_average = float(sc.get("class_average", 0))
    score_gap = student_score - class_average
    report_mode = str(report.get("mode") or "ai")
    return student_name, student_score, class_average, score_gap, report_mode


def save_grade_report(
    report: dict[str, Any],
    *,
    exam_name: str = "",
    exam_date: str | None = None,
    student_id: int | None = None,
) -> int:
    """Insert a grade analysis report. Returns the new row id."""
    ensure_grade_reports_table()

    student_name, student_score, class_average, score_gap, report_mode = (
        _extract_scores(report)
    )
    exam_date = exam_date or date.today().isoformat()
    created_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    report_json = json.dumps(report, ensure_ascii=False)

    conn = get_conn()
    try:
        if student_id is not None:
            canonical = _student_name_by_id(conn, student_id)
            if canonical:
                student_name = canonical
        elif student_id is None:
            student_id = _resolve_student_id(conn, student_name)

        cur = conn.execute(
            """
            INSERT INTO grade_reports (
                student_id, student_name, exam_date, exam_name,
                student_score, class_average, score_gap,
                report_mode, report_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
            """,
            (
                student_id,
                student_name,
                exam_date,
                exam_name.strip(),
                student_score,
                class_average,
                score_gap,
                report_mode,
                report_json,
                created_at,
            ),
        )
        new_id = int(cur.fetchone()[0])
        conn.commit()
        return new_id
    finally:
        conn.close()


def get_student_grade_history(
    student_name: str,
    *,
    limit: int | None = None,
) -> pd.DataFrame:
    """Load past grade reports for a student, newest first."""
    ensure_grade_reports_table()

    name = student_name.strip()
    sql = """
        SELECT
            id,
            student_id,
            student_name,
            exam_date,
            exam_name,
            student_score,
            class_average,
            score_gap,
            report_mode,
            created_at
        FROM grade_reports
        WHERE student_name = ? COLLATE NOCASE
        ORDER BY exam_date DESC, created_at DESC
    """
    params: tuple[Any, ...] = (name,)
    if limit is not None and limit > 0:
        sql += "LIMIT ?"
        params = (name, int(limit))

    conn = get_conn()
    try:
        df = pd.read_sql_query(sql, conn, params=params)
    finally:
        conn.close()
    return sanitize_numeric_columns(
        df,
        int_columns=(),
        float_columns=("student_score", "class_average", "score_gap"),
        float_keep_nan=True,
    )


def get_all_grade_records(
    *,
    class_name: str | None = None,
    student_names: tuple[str, ...] | None = None,
    teacher_id: int | None = None,
) -> pd.DataFrame:
    """Load grade_reports joined with class info, newest first."""
    ensure_grade_reports_table()

    sql = """
        SELECT
            g.id,
            g.student_id,
            g.student_name,
            COALESCE(c.name, '—') AS class_name,
            g.exam_date,
            g.exam_name,
            g.student_score,
            g.class_average,
            g.score_gap,
            g.report_mode,
            g.created_at
        FROM grade_reports g
        LEFT JOIN students s ON s.id = g.student_id
        LEFT JOIN classes c ON c.id = s.class_id
        WHERE 1 = 1
    """
    params: list[Any] = []

    if class_name:
        sql += " AND c.name = ?"
        params.append(class_name)

    if student_names:
        placeholders = ", ".join("?" for _ in student_names)
        sql += f" AND g.student_name IN ({placeholders})"
        params.extend(student_names)

    if teacher_id is not None:
        sql += " AND c.teacher_id = ?"
        params.append(teacher_id)

    sql += " ORDER BY g.exam_date DESC, g.created_at DESC, g.student_name ASC"

    conn = get_conn()
    try:
        df = pd.read_sql_query(sql, conn, params=params or None)
    finally:
        conn.close()
    return sanitize_numeric_columns(
        df,
        int_columns=(),
        float_columns=("student_score", "class_average", "score_gap"),
        float_keep_nan=True,
    )


def get_grade_report_by_id(report_id: int) -> dict[str, Any] | None:
    """Load a single stored report by id."""
    ensure_grade_reports_table()

    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT report_json FROM grade_reports WHERE id = ?",
            (int(report_id),),
        ).fetchone()
    finally:
        conn.close()

    if not row:
        return None
    return json.loads(row[0])


def get_student_profile(student_id: int) -> dict[str, Any] | None:
    """Return student name and class metadata."""
    conn = get_conn()
    try:
        row = conn.execute(
            """
            SELECT s.id, s.name, s.class_id, COALESCE(c.name, '—') AS class_name,
                   COALESCE(c.description, '') AS class_description,
                   COALESCE(s.parent_phone, '') AS parent_phone
            FROM students s
            LEFT JOIN classes c ON c.id = s.class_id
            WHERE s.id = ?
            """,
            (int(student_id),),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return None
    return {
        "student_id": int(row[0]),
        "student_name": str(row[1]),
        "class_id": row[2],
        "class_name": str(row[3]),
        "class_description": str(row[4]),
        "parent_phone": str(row[5] or ""),
    }


def ensure_report_links_table(conn: sqlite3.Connection | None = None) -> None:
    """학부모에게 문자로 보내는 보고서 링크 저장용 테이블."""
    own_conn = conn is None
    if own_conn:
        conn = get_conn()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS report_links (
                token        TEXT PRIMARY KEY,
                html_content TEXT NOT NULL,
                student_name TEXT DEFAULT '',
                created_at   TEXT NOT NULL
            )
            """
        )
        if own_conn:
            conn.commit()
    finally:
        if own_conn:
            conn.close()


def save_report_link(html_content: str, student_name: str = "") -> str:
    """보고서 HTML을 DB에 저장하고, 조회용 토큰(짧은 문자열)을 반환합니다."""
    import uuid

    token = uuid.uuid4().hex[:16]
    conn = get_conn()
    try:
        ensure_report_links_table(conn)
        conn.execute(
            """INSERT INTO report_links (token, html_content, student_name, created_at)
               VALUES (?, ?, ?, ?)""",
            (token, html_content, student_name, datetime.now().strftime("%Y-%m-%d %H:%M")),
        )
        conn.commit()
    finally:
        conn.close()
    return token


def get_report_link(token: str) -> str | None:
    """토큰으로 저장된 보고서 HTML을 가져옵니다. 없으면 None."""
    conn = get_conn()
    try:
        ensure_report_links_table(conn)
        row = conn.execute(
            "SELECT html_content FROM report_links WHERE token = ?",
            (token,),
        ).fetchone()
    finally:
        conn.close()
    return str(row[0]) if row else None


def get_student_test_entry(
    student_id: int,
    test_name: str,
    test_date: str,
) -> dict[str, Any] | None:
    """Return the latest ``test_results`` entry matching test name and date."""
    history = get_student_test_results(student_id=int(student_id))
    matches = [
        item
        for item in history
        if str(item.get("test_name", "")).strip() == test_name.strip()
        and str(item.get("date", "")).strip() == test_date.strip()
    ]
    return matches[-1] if matches else None


def get_grade_report_for_exam(
    student_id: int,
    exam_name: str,
    exam_date: str,
) -> dict[str, Any] | None:
    """Load the newest grade_reports JSON for a student + exam."""
    ensure_grade_reports_table()
    conn = get_conn()
    try:
        row = conn.execute(
            """
            SELECT report_json
            FROM grade_reports
            WHERE student_id = ?
              AND exam_name = ?
              AND exam_date = ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (int(student_id), exam_name.strip(), exam_date.strip()),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return None
    return json.loads(row[0])


# ── AI TEST tables (tests / test_questions / student_results) ───────

_TESTS_DDL = """
CREATE TABLE IF NOT EXISTS tests (
    test_id         SERIAL PRIMARY KEY,
    test_name       TEXT NOT NULL,
    date            TEXT NOT NULL,
    total_questions INTEGER NOT NULL DEFAULT 0,
    analysis_data   TEXT NOT NULL DEFAULT '{}',
    created_at      TEXT NOT NULL
)
"""

_TEST_QUESTIONS_DDL = """
CREATE TABLE IF NOT EXISTS test_questions (
    question_id     SERIAL PRIMARY KEY,
    test_id         INTEGER NOT NULL REFERENCES tests(test_id) ON DELETE CASCADE,
    question_number TEXT NOT NULL,
    topic           TEXT NOT NULL DEFAULT '미분류',
    question_type   TEXT NOT NULL DEFAULT '객관식',
    difficulty      TEXT NOT NULL DEFAULT 'C',
    UNIQUE(test_id, question_number)
)
"""

_STUDENT_RESULTS_DDL = """
CREATE TABLE IF NOT EXISTS student_results (
    id              SERIAL PRIMARY KEY,
    student_id      INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    test_id         INTEGER NOT NULL REFERENCES tests(test_id) ON DELETE CASCADE,
    wrong_numbers   TEXT NOT NULL DEFAULT '[]',
    wrong_count     INTEGER NOT NULL DEFAULT 0,
    score           REAL NOT NULL,
    recorded_at     TEXT NOT NULL,
    UNIQUE(student_id, test_id)
)
"""


def ensure_ai_test_tables(conn: sqlite3.Connection | None = None) -> None:
    """Create ``tests``, ``test_questions``, ``student_results`` if missing."""
    own_conn = conn is None
    if own_conn:
        conn = get_conn()
    try:
        conn.execute(_TESTS_DDL)
        conn.execute(_TEST_QUESTIONS_DDL)
        conn.execute(_STUDENT_RESULTS_DDL)
        cols = [row[1] for row in conn.execute(
            "SELECT ordinal_position, column_name FROM information_schema.columns WHERE table_name = 'tests'"
        ).fetchall()]
        if "file_name" not in cols:
            conn.execute(
                "ALTER TABLE tests ADD COLUMN file_name TEXT NOT NULL DEFAULT ''"
            )
        if "test_type" not in cols:
            conn.execute(
                "ALTER TABLE tests ADD COLUMN test_type TEXT NOT NULL DEFAULT '일일테스트'"
            )
        # test_questions 마이그레이션
        tq_cols = [row[1] for row in conn.execute(
            "SELECT ordinal_position, column_name FROM information_schema.columns WHERE table_name = 'test_questions'"
        ).fetchall()]
        if "question_type" not in tq_cols:
            conn.execute(
                "ALTER TABLE test_questions ADD COLUMN question_type TEXT NOT NULL DEFAULT '객관식'"
            )
        if "question_method" not in tq_cols:
            conn.execute(
                "ALTER TABLE test_questions ADD COLUMN question_method TEXT NOT NULL DEFAULT ''"
            )
        # (참고: 예전 SQLite CHECK 제약 우회용 임시테이블 마이그레이션은
        #  Supabase(PostgreSQL) 신규 DB에는 필요 없어서 제거함)
        if own_conn:
            conn.commit()
    finally:
        if own_conn:
            conn.close()


def compute_score_from_wrong(
    total_questions: int,
    wrong_numbers: list[int] | tuple[int, ...],
) -> float:
    """Score = (total - wrong) / total * 100."""
    total = max(int(total_questions), 1)
    wrong = len(_normalize_wrong_numbers(wrong_numbers))
    correct = max(total - wrong, 0)
    return round(correct / total * 100.0, 1)


def save_test_with_questions(
    *,
    test_name: str,
    test_date: str,
    questions: list[dict[str, Any]],
    analysis_data: dict[str, Any] | None = None,
    file_name: str = "",
    test_type: str = "일일테스트",
) -> int:
    """Insert ``tests`` + ``test_questions`` after user confirms editor. Returns ``test_id``."""
    ensure_ai_test_tables()
    test_name = (test_name or "").strip() or "테스트"
    test_date = (test_date or date.today().isoformat()).strip()
    test_type = (test_type or "일일테스트").strip()
    total = len(questions)
    created_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    payload = dict(analysis_data or {})
    if file_name:
        payload["file_name"] = file_name
    payload_json = json.dumps(payload, ensure_ascii=False)

    conn = get_conn()
    try:
        cur = conn.execute(
            """
            INSERT INTO tests (test_name, date, total_questions, analysis_data, created_at, file_name, test_type)
            VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING test_id
            """,
            (test_name, test_date, total, payload_json, created_at, file_name or "", test_type),
        )
        test_id = int(cur.fetchone()[0])
        for q in questions:
            qnum = str(q.get("question_number") or "").strip()
            conn.execute(
                """
                INSERT INTO test_questions (test_id, question_number, topic, question_type, difficulty, question_method)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    test_id,
                    qnum,
                    str(q.get("topic") or "미분류").strip() or "미분류",
                    str(q.get("question_type") or "객관식").strip() or "객관식",
                    str(q.get("difficulty") or "C").strip() or "C",
                    str(q.get("question_method") or "").strip(),
                ),
            )
        conn.commit()
        return test_id
    finally:
        conn.close()


def update_test_with_questions(
    *,
    test_id: int,
    test_name: str,
    test_date: str,
    questions: list[dict[str, Any]],
    analysis_data: dict[str, Any] | None = None,
    file_name: str = "",
    test_type: str = "일일테스트",
) -> None:
    """Replace ``test_questions`` and update ``tests`` row (re-confirm flow)."""
    ensure_ai_test_tables()
    test_name = (test_name or "").strip() or "테스트"
    test_date = (test_date or date.today().isoformat()).strip()
    test_type = (test_type or "일일테스트").strip()
    total = len(questions)
    payload = dict(analysis_data or {})
    if file_name:
        payload["file_name"] = file_name
    payload_json = json.dumps(payload, ensure_ascii=False)

    conn = get_conn()
    try:
        conn.execute(
            """
            UPDATE tests
            SET test_name = ?, date = ?, total_questions = ?, analysis_data = ?, file_name = ?, test_type = ?
            WHERE test_id = ?
            """,
            (test_name, test_date, total, payload_json, file_name or "", test_type, int(test_id)),
        )
        conn.execute("DELETE FROM test_questions WHERE test_id = ?", (int(test_id),))
        for q in questions:
            qnum = str(q.get("question_number") or "").strip()
            conn.execute(
                """
                INSERT INTO test_questions (test_id, question_number, topic, question_type, difficulty, question_method)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    int(test_id),
                    qnum,
                    str(q.get("topic") or "미분류").strip() or "미분류",
                    str(q.get("question_type") or "객관식").strip() or "객관식",
                    str(q.get("difficulty") or "C").strip() or "C",
                    str(q.get("question_method") or "").strip(),
                ),
            )
        conn.commit()
    finally:
        conn.close()


def get_test_by_id(test_id: int) -> dict[str, Any] | None:
    ensure_ai_test_tables()
    conn = get_conn()
    try:
        row = conn.execute(
            """
            SELECT test_id, test_name, date, total_questions, analysis_data, created_at, file_name
            FROM tests WHERE test_id = ?
            """,
            (int(test_id),),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return None
    analysis = json.loads(row[4] or "{}")
    file_name = str(row[6] or "") or str(analysis.get("file_name") or "")
    return {
        "test_id": int(row[0]),
        "test_name": str(row[1]),
        "date": str(row[2]),
        "total_questions": int(row[3]),
        "analysis_data": analysis,
        "created_at": str(row[5]),
        "file_name": file_name,
    }


def get_test_questions(test_id: int) -> list[dict[str, Any]]:
    ensure_ai_test_tables()
    conn = get_conn()
    try:
        rows = conn.execute(
            """
            SELECT question_id, question_number, topic, difficulty,
                   COALESCE(question_type, '객관식') AS question_type,
                   COALESCE(question_method, '') AS question_method
            FROM test_questions
            WHERE test_id = ?
            ORDER BY CAST(question_number AS INTEGER), question_number
            """,
            (int(test_id),),
        ).fetchall()
    finally:
        conn.close()
    result = []
    for r in rows:
        qnum_raw = str(r[1])
        try:
            qnum = int(qnum_raw)
        except (ValueError, TypeError):
            qnum = qnum_raw
        result.append({
            "question_id": int(r[0]),
            "question_number": qnum,
            "topic": str(r[2]),
            "difficulty": str(r[3]),
            "question_type": str(r[4]),
            "question_method": str(r[5]),
        })
    return result


def list_tests(limit: int = 50, teacher_id: int | None = None) -> pd.DataFrame:
    """List saved AI test sheets. When ``teacher_id`` is set, include unused tests
    and tests linked to that teacher's students via ``student_results``."""
    ensure_ai_test_tables()
    conn = get_conn()
    try:
        if teacher_id is None:
            return pd.read_sql_query(
                """
                SELECT test_id, test_name, date, total_questions, file_name, created_at
                FROM tests
                ORDER BY date DESC, created_at DESC
                LIMIT ?
                """,
                conn,
                params=(int(limit),),
            )
        return pd.read_sql_query(
            """
            SELECT DISTINCT
                t.test_id, t.test_name, t.date, t.total_questions, t.file_name, t.created_at
            FROM tests t
            WHERE NOT EXISTS (
                SELECT 1 FROM student_results sr WHERE sr.test_id = t.test_id
            )
            OR EXISTS (
                SELECT 1
                FROM student_results sr
                INNER JOIN students s ON s.id = sr.student_id
                INNER JOIN classes c ON c.id = s.class_id
                WHERE sr.test_id = t.test_id AND c.teacher_id = ?
            )
            ORDER BY t.date DESC, t.created_at DESC
            LIMIT ?
            """,
            conn,
            params=(int(teacher_id), int(limit)),
        )
    finally:
        conn.close()


def format_test_option_label(row: dict[str, Any] | pd.Series) -> str:
    """Dropdown label for one saved test row."""
    name = str(row.get("test_name") or row["test_name"])
    dt = str(row.get("date") or row["date"])
    n = int(row.get("total_questions") or row["total_questions"])
    return f"{name} · {dt} · {n}문항"


def get_student_result_record(
    *,
    student_id: int,
    test_id: int | None = None,
    test_name: str | None = None,
    test_date: str | None = None,
) -> dict[str, Any] | None:
    """Load one ``student_results`` row joined with ``tests`` metadata."""
    ensure_ai_test_tables()
    conn = get_conn()
    try:
        if test_id is not None:
            row = conn.execute(
                """
                SELECT
                    sr.student_id,
                    sr.test_id,
                    sr.wrong_numbers,
                    sr.wrong_count,
                    sr.score,
                    sr.recorded_at,
                    t.test_name,
                    t.date,
                    t.total_questions,
                    t.file_name
                FROM student_results sr
                JOIN tests t ON t.test_id = sr.test_id
                WHERE sr.student_id = ? AND sr.test_id = ?
                """,
                (int(student_id), int(test_id)),
            ).fetchone()
        elif test_name and test_date:
            row = conn.execute(
                """
                SELECT
                    sr.student_id,
                    sr.test_id,
                    sr.wrong_numbers,
                    sr.wrong_count,
                    sr.score,
                    sr.recorded_at,
                    t.test_name,
                    t.date,
                    t.total_questions,
                    t.file_name
                FROM student_results sr
                JOIN tests t ON t.test_id = sr.test_id
                WHERE sr.student_id = ?
                  AND t.test_name = ?
                  AND t.date = ?
                ORDER BY sr.recorded_at DESC
                LIMIT 1
                """,
                (int(student_id), test_name.strip(), test_date.strip()),
            ).fetchone()
        else:
            return None
    finally:
        conn.close()

    if not row:
        return None

    wrong_raw = row[2]
    try:
        wrong_numbers = json.loads(wrong_raw or "[]")
    except json.JSONDecodeError:
        wrong_numbers = []

    return {
        "student_id": int(row[0]),
        "test_id": int(row[1]),
        "wrong_numbers": _normalize_wrong_numbers(wrong_numbers),
        "wrong_count": int(row[3]),
        "score": float(row[4]),
        "recorded_at": str(row[5]),
        "test_name": str(row[6]),
        "date": str(row[7]),
        "total_questions": int(row[8]),
        "file_name": str(row[9] or ""),
    }


def get_test_average_score(
    test_id: int,
    *,
    extra_scores: dict[int, float] | None = None,
) -> float | None:
    """Mean score for **all students** who took this test (``student_results``).

    ``extra_scores`` merges not-yet-persisted scores ``{student_id: score}``.
    Returns ``None`` when no records exist.
    """
    ensure_ai_test_tables()
    conn = get_conn()
    try:
        rows = conn.execute(
            """
            SELECT student_id, score
            FROM student_results
            WHERE test_id = ?
            """,
            (int(test_id),),
        ).fetchall()
    finally:
        conn.close()

    scores: dict[int, float] = {int(r[0]): float(r[1]) for r in rows}
    if extra_scores:
        for sid, sc in extra_scores.items():
            if sc is not None:
                scores[int(sid)] = float(sc)

    if not scores:
        return None
    return round(sum(scores.values()) / len(scores), 1)


def get_student_test_score_history(student_id: int) -> list[dict[str, Any]]:
    """Chronological test scores for one student (``student_results`` + ``tests``)."""
    ensure_ai_test_tables()
    conn = get_conn()
    try:
        rows = conn.execute(
            """
            SELECT t.test_name, t.date, sr.score, sr.test_id, sr.recorded_at
            FROM student_results sr
            JOIN tests t ON t.test_id = sr.test_id
            WHERE sr.student_id = ?
            ORDER BY t.date ASC, sr.recorded_at ASC
            """,
            (int(student_id),),
        ).fetchall()
    finally:
        conn.close()
    return [
        {
            "test_name": str(r[0]),
            "date": str(r[1]),
            "score": float(r[2]),
            "test_id": int(r[3]),
            "recorded_at": str(r[4]),
        }
        for r in rows
    ]


def save_student_result(
    *,
    student_id: int,
    test_id: int,
    wrong_numbers: list[int] | tuple[int, ...],
) -> dict[str, Any]:
    """Save to ``student_results`` with auto-calculated score."""
    ensure_ai_test_tables()
    test = get_test_by_id(test_id)
    if not test:
        raise ValueError(f"test_id {test_id} 를 찾을 수 없습니다.")

    normalized = _normalize_wrong_numbers(wrong_numbers)
    wrong_count = len(normalized)
    score = compute_score_from_wrong(test["total_questions"], normalized)
    recorded_at = datetime.now().strftime("%Y-%m-%d %H:%M")

    conn = get_conn()
    result_row_id: int | None = None
    try:
        conn.execute(
            """
            INSERT INTO student_results
                (student_id, test_id, wrong_numbers, wrong_count, score, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(student_id, test_id) DO UPDATE SET
                wrong_numbers = excluded.wrong_numbers,
                wrong_count = excluded.wrong_count,
                score = excluded.score,
                recorded_at = excluded.recorded_at
            """,
            (
                int(student_id),
                int(test_id),
                json.dumps(normalized, ensure_ascii=False),
                wrong_count,
                score,
                recorded_at,
            ),
        )
        row = conn.execute(
            """
            SELECT id FROM student_results
            WHERE student_id = ? AND test_id = ?
            """,
            (int(student_id), int(test_id)),
        ).fetchone()
        if row:
            result_row_id = int(row[0])
        conn.commit()
    finally:
        conn.close()

    append_student_test_result(
        student_id=student_id,
        test_name=test["test_name"],
        wrong_numbers=normalized,
        score=score,
        test_date=test["date"],
    )

    if result_row_id is not None:
        sync_student_grade_unified(int(student_id))

    return {
        "student_id": int(student_id),
        "test_id": int(test_id),
        "test_name": test["test_name"],
        "date": test["date"],
        "wrong_numbers": normalized,
        "wrong_count": wrong_count,
        "score": score,
        "total_questions": test["total_questions"],
        "recorded_at": recorded_at,
    }


# ── Question bank (workbook OCR → similar-question source) ──────────

_QUESTION_BANK_EXTRA_COLUMNS: tuple[tuple[str, str], ...] = (
    ("question_number", "INTEGER NOT NULL DEFAULT 0"),
    ("answer", "TEXT NOT NULL DEFAULT ''"),
    ("explanation", "TEXT NOT NULL DEFAULT ''"),
    ("source_workbook", "TEXT NOT NULL DEFAULT ''"),
    ("page_number", "INTEGER NOT NULL DEFAULT 0"),
)


def ensure_question_bank_extended(conn: sqlite3.Connection | None = None) -> None:
    """Ensure ``question_bank`` exists and has workbook OCR columns."""
    own_conn = conn is None
    if own_conn:
        conn = get_conn()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS question_bank (
                id              SERIAL PRIMARY KEY,
                topic           TEXT NOT NULL,
                level           TEXT NOT NULL CHECK(level IN ('High','Mid','Low')),
                question        TEXT NOT NULL,
                answer_hint     TEXT DEFAULT '',
                created_at      TEXT NOT NULL
            )
            """
        )
        cols = {
            row[1]
            for row in conn.execute(
                "SELECT ordinal_position, column_name FROM information_schema.columns WHERE table_name = 'question_bank'"
            ).fetchall()
        }
        for col_name, col_ddl in _QUESTION_BANK_EXTRA_COLUMNS:
            if col_name not in cols:
                conn.execute(
                    f"ALTER TABLE question_bank ADD COLUMN {col_name} {col_ddl}"
                )
        conn.execute(
            """
            UPDATE question_bank
            SET answer = answer_hint
            WHERE (answer IS NULL OR answer = '')
              AND answer_hint IS NOT NULL
              AND answer_hint != ''
            """
        )
        if own_conn:
            conn.commit()
    finally:
        if own_conn:
            conn.close()


def bulk_insert_question_bank(rows: list[dict[str, Any]]) -> int:
    """Insert many workbook questions. Returns inserted count."""
    if not rows:
        return 0
    ensure_question_bank_extended()
    conn = get_conn()
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    inserted = 0
    level_map = {
        "high": "High",
        "mid": "Mid",
        "low": "Low",
        "상": "High",
        "중": "Mid",
        "하": "Low",
        "어려움": "High",
        "보통": "Mid",
        "쉬움": "Low",
    }
    try:
        for row in rows:
            topic = str(row.get("topic") or "미분류").strip() or "미분류"
            raw_level = str(row.get("difficulty") or row.get("level") or "Mid").strip()
            level = level_map.get(raw_level.lower(), raw_level)
            if level not in ("High", "Mid", "Low"):
                level = "Mid"
            question = str(row.get("question") or "").strip()
            if not question:
                continue
            answer = str(row.get("answer") or row.get("answer_hint") or "").strip()
            explanation = str(row.get("explanation") or "").strip()
            qnum = int(row.get("question_number") or 0)
            workbook = str(row.get("source_workbook") or "").strip()
            page_num = int(row.get("page_number") or 0)
            conn.execute(
                """
                INSERT INTO question_bank (
                    topic, level, question, answer_hint,
                    question_number, answer, explanation,
                    source_workbook, page_number, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    topic,
                    level,
                    question,
                    answer,
                    qnum,
                    answer,
                    explanation,
                    workbook,
                    page_num,
                    now,
                ),
            )
            inserted += 1
        conn.commit()
    finally:
        conn.close()
    return inserted


def list_question_bank(
    *,
    topics: list[str] | None = None,
    levels: list[str] | None = None,
    source_workbook: str | None = None,
    limit: int = 5000,
) -> pd.DataFrame:
    """Return question bank rows for UI filters."""
    ensure_question_bank_extended()
    conn = get_conn()
    q = """
        SELECT
            id,
            question_number,
            question,
            answer,
            explanation,
            topic,
            level,
            source_workbook,
            page_number,
            answer_hint,
            created_at
        FROM question_bank
        WHERE 1=1
    """
    params: list[Any] = []
    if topics:
        q += f" AND topic IN ({','.join(['?'] * len(topics))})"
        params.extend(topics)
    if levels:
        q += f" AND level IN ({','.join(['?'] * len(levels))})"
        params.extend(levels)
    if source_workbook:
        q += " AND source_workbook = ?"
        params.append(source_workbook)
    q += " ORDER BY source_workbook, page_number, question_number, id LIMIT ?"
    params.append(int(limit))
    df = pd.read_sql_query(q, conn, params=params)
    conn.close()
    return df


def get_question_bank_stats() -> dict[str, Any]:
    """Summary for data-integrity checks (topic/level distribution)."""
    ensure_question_bank_extended()
    conn = get_conn()
    try:
        total = int(conn.execute("SELECT COUNT(*) FROM question_bank").fetchone()[0])
        topic_rows = conn.execute(
            "SELECT topic, COUNT(*) FROM question_bank GROUP BY topic ORDER BY COUNT(*) DESC"
        ).fetchall()
        level_rows = conn.execute(
            "SELECT level, COUNT(*) FROM question_bank GROUP BY level ORDER BY level"
        ).fetchall()
        invalid_level = int(
            conn.execute(
                "SELECT COUNT(*) FROM question_bank WHERE level NOT IN ('High','Mid','Low')"
            ).fetchone()[0]
        )
        empty_topic = int(
            conn.execute(
                "SELECT COUNT(*) FROM question_bank WHERE topic IS NULL OR TRIM(topic) = ''"
            ).fetchone()[0]
        )
        empty_question = int(
            conn.execute(
                "SELECT COUNT(*) FROM question_bank WHERE question IS NULL OR TRIM(question) = ''"
            ).fetchone()[0]
        )
        sample = conn.execute(
            """
            SELECT id, question_number, topic, level,
                   substr(question, 1, 40) AS question_preview
            FROM question_bank
            ORDER BY id DESC
            LIMIT 5
            """
        ).fetchall()
        return {
            "total": total,
            "topics": {str(r[0]): int(r[1]) for r in topic_rows},
            "levels": {str(r[0]): int(r[1]) for r in level_rows},
            "invalid_level_count": invalid_level,
            "empty_topic_count": empty_topic,
            "empty_question_count": empty_question,
            "recent_samples": [
                {
                    "id": r[0],
                    "question_number": r[1],
                    "topic": r[2],
                    "level": r[3],
                    "question_preview": r[4],
                }
                for r in sample
            ],
            "db_path": str(DB_PATH),
        }
    finally:
        conn.close()


_DIFF_RANK = {"Low": 0, "Mid": 1, "High": 2}


def _normalize_bank_difficulty(difficulty: str) -> str:
    diff = (difficulty or "Mid").strip()
    if diff not in _DIFF_RANK:
        return "Mid"
    return diff


def _difficulty_neighbors(difficulty: str) -> list[str]:
    """Allow ±1 difficulty step (Low ↔ Mid ↔ High)."""
    base = _normalize_bank_difficulty(difficulty)
    rank = _DIFF_RANK[base]
    return [name for name, r in _DIFF_RANK.items() if abs(r - rank) <= 1]


def _topic_search_tokens(topic: str) -> list[str]:
    """Build partial-match tokens for topic contains search."""
    raw = (topic or "").strip()
    if not raw or raw == "미분류":
        return []
    tokens: list[str] = []
    if raw not in tokens:
        tokens.append(raw)
    for part in re.split(r"[\s/·\-,、]+ ", raw):
        part = part.strip()
        if len(part) >= 2 and part not in tokens:
            tokens.append(part)
    return tokens


def _similar_q_log(msg: str, *, debug_logs: list[str] | None) -> None:
    line = f"[similar-q] {msg}"
    try:
        print(line, flush=True)
    except UnicodeEncodeError:
        import sys

        sys.stdout.buffer.write((line + "\n").encode("utf-8", errors="replace"))
        sys.stdout.flush()
    if debug_logs is not None:
        debug_logs.append(msg)


def fetch_similar_questions_from_bank(
    *,
    topic: str,
    difficulty: str = "Mid",
    limit: int = 1,
    exclude_ids: set[int] | None = None,
    debug_logs: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Pick similar problems — partial topic match + ±1 difficulty tolerance."""
    ensure_question_bank_extended()
    topic = (topic or "미분류").strip() or "미분류"
    difficulty = _normalize_bank_difficulty(difficulty)
    limit = max(1, min(int(limit), 10))
    exclude_ids = exclude_ids or set()
    level_neighbors = _difficulty_neighbors(difficulty)
    tokens = _topic_search_tokens(topic)

    _similar_q_log(
        f"검색 기준(단원: {topic!r}, 난이도: {difficulty}) - "
        f"허용 난이도: {level_neighbors}, 단원 토큰: {tokens or ['(미분류->전체)']}",
        debug_logs=debug_logs,
    )

    conn = get_conn()
    try:
        bank_total = int(
            conn.execute("SELECT COUNT(*) FROM question_bank").fetchone()[0]
        )
        _similar_q_log(
            f"문제은행 DB 총 {bank_total}건 (path={DB_PATH})", debug_logs=debug_logs
        )

        def _rows_to_dicts(rows) -> list[dict[str, Any]]:
            out: list[dict[str, Any]] = []
            for row in rows:
                rid = int(row[0])
                if rid in exclude_ids:
                    continue
                out.append(
                    {
                        "problem_id": rid,
                        "stem": row[4] or "",
                        "answer": row[5] or "",
                        "explanation": row[6] or "",
                        "topic": row[2],
                        "difficulty": row[3],
                        "question_number": row[1],
                    }
                )
                if len(out) >= limit:
                    break
            return out

        def _run_stage(label: str, sql: str, params: list[Any]) -> list[dict[str, Any]]:
            fetch_limit = max(limit * 5, limit)
            rows = conn.execute(sql, params + [fetch_limit]).fetchall()
            picked = _rows_to_dicts(rows)
            _similar_q_log(f"  -> {label}: {len(picked)}건", debug_logs=debug_logs)
            return picked

        level_ph = ",".join("?" * len(level_neighbors))
        picked: list[dict[str, Any]] = []

        if tokens:
            topic_clauses = "OR ".join(["topic LIKE ?"] * len(tokens))
            topic_params = [f"%{tok}%" for tok in tokens]
            picked = _run_stage(
                f"단원 contains ({', '.join(tokens)}) + 난이도 ±1",
                f"""
                SELECT id, question_number, topic, level, question, answer, explanation
                FROM question_bank
                WHERE ({topic_clauses}) AND level IN ({level_ph})
                ORDER BY RANDOM()
                LIMIT ?
                """,
                topic_params + level_neighbors,
            )

        if len(picked) < limit and tokens:
            topic_clauses = "OR ".join(["topic LIKE ?"] * len(tokens))
            topic_params = [f"%{tok}%" for tok in tokens]
            for row in _run_stage(
                f"단원 contains ({', '.join(tokens)}) - 난이도 무시",
                f"""
                SELECT id, question_number, topic, level, question, answer, explanation
                FROM question_bank
                WHERE {topic_clauses}
                ORDER BY RANDOM()
                LIMIT ?
                """,
                topic_params,
            ):
                if (
                    row["problem_id"]
                    not in {p["problem_id"] for p in picked} | exclude_ids
                ):
                    picked.append(row)
                if len(picked) >= limit:
                    break

        if len(picked) < limit:
            for row in _run_stage(
                f"난이도 ±1 ({level_neighbors}) - 단원 무시",
                f"""
                SELECT id, question_number, topic, level, question, answer, explanation
                FROM question_bank
                WHERE level IN ({level_ph})
                ORDER BY RANDOM()
                LIMIT ?
                """,
                level_neighbors,
            ):
                if (
                    row["problem_id"]
                    not in {p["problem_id"] for p in picked} | exclude_ids
                ):
                    picked.append(row)
                if len(picked) >= limit:
                    break

        if len(picked) < limit:
            for row in _run_stage(
                "전체 문제 (최후 fallback)",
                """
                SELECT id, question_number, topic, level, question, answer, explanation
                FROM question_bank
                ORDER BY RANDOM()
                LIMIT ?
                """,
                [],
            ):
                if (
                    row["problem_id"]
                    not in {p["problem_id"] for p in picked} | exclude_ids
                ):
                    picked.append(row)
                if len(picked) >= limit:
                    break

        _similar_q_log(f"최종 결과: {len(picked[:limit])}건", debug_logs=debug_logs)
        return picked[:limit]
    finally:
        conn.close()


def delete_question_bank_ids(ids: list[int]) -> int:
    """Delete question bank rows by primary key."""
    if not ids:
        return 0
    conn = get_conn()
    try:
        placeholders = ",".join("?" * len(ids))
        cur = conn.execute(
            f"DELETE FROM question_bank WHERE id IN ({placeholders})",
            [int(i) for i in ids],
        )
        conn.commit()
        return int(cur.rowcount)
    finally:
        conn.close()


# ── Unified grade registry (school / mock / AI / manual) ─────────────

MATH_SUBJECT = "수학"

EXAM_SOURCE_SCHOOL = "school_exam"
EXAM_SOURCE_MOCK = "mock_exam"
EXAM_SOURCE_AI_TEST = "ai_test"
EXAM_SOURCE_ACADEMY_MANUAL = "academy_manual"

EXAM_SOURCE_LABELS: dict[str, str] = {
    EXAM_SOURCE_SCHOOL: "학교 시험",
    EXAM_SOURCE_MOCK: "모의고사",
    EXAM_SOURCE_AI_TEST: "AI 테스트",
    EXAM_SOURCE_ACADEMY_MANUAL: "수기 입력 시험",
}

GRADE_LEVEL_OPTIONS = ["중1", "중2", "중3", "고1", "고2", "고3"]
SEMESTER_OPTIONS = ["1학기", "2학기"]
SCHOOL_EXAM_KIND_OPTIONS = ["중간고사", "기말고사"]
MOCK_MONTH_OPTIONS = [3, 4, 6, 9, 11]

_STUDENT_GRADE_UNIFIED_DDL = """
CREATE TABLE IF NOT EXISTS student_grade_unified (
    id           SERIAL PRIMARY KEY,
    student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    exam_source  TEXT NOT NULL CHECK(exam_source IN (
        'school_exam', 'mock_exam', 'ai_test', 'academy_manual'
    )),
    subject      TEXT NOT NULL DEFAULT '수학',
    score        REAL NOT NULL,
    exam_label   TEXT NOT NULL,
    exam_date    TEXT NOT NULL,
    school_year  INTEGER,
    grade_level  TEXT,
    semester     TEXT,
    exam_kind    TEXT,
    exam_month   INTEGER,
    origin_table TEXT NOT NULL,
    origin_id    INTEGER NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    UNIQUE(origin_table, origin_id)
)
"""


def ensure_student_grade_unified_table(conn: sqlite3.Connection | None = None) -> None:
    own_conn = conn is None
    if own_conn:
        conn = get_conn()
    try:
        conn.execute(_STUDENT_GRADE_UNIFIED_DDL)
        if own_conn:
            conn.commit()
    finally:
        if own_conn:
            conn.close()


def ensure_external_grade_exam_month(conn: sqlite3.Connection | None = None) -> None:
    """Add ``exam_month`` to ``external_grade_sessions`` for mock-exam filters."""
    own_conn = conn is None
    if own_conn:
        conn = get_conn()
    try:
        cols = [
            row[1]
            for row in conn.execute(
                "SELECT ordinal_position, column_name FROM information_schema.columns WHERE table_name = 'external_grade_sessions'"
            ).fetchall()
        ]
        if cols and "exam_month" not in cols:
            conn.execute(
                "ALTER TABLE external_grade_sessions ADD COLUMN exam_month INTEGER"
            )
        if own_conn:
            conn.commit()
    finally:
        if own_conn:
            conn.close()


def _upsert_unified_grade(
    conn: sqlite3.Connection,
    *,
    student_id: int,
    exam_source: str,
    score: float,
    exam_label: str,
    exam_date: str,
    origin_table: str,
    origin_id: int,
    school_year: int | None = None,
    grade_level: str | None = None,
    semester: str | None = None,
    exam_kind: str | None = None,
    exam_month: int | None = None,
) -> None:
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    conn.execute(
        """
        INSERT INTO student_grade_unified (
            student_id, exam_source, subject, score, exam_label, exam_date,
            school_year, grade_level, semester, exam_kind, exam_month,
            origin_table, origin_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(origin_table, origin_id) DO UPDATE SET
            student_id = excluded.student_id,
            exam_source = excluded.exam_source,
            subject = excluded.subject,
            score = excluded.score,
            exam_label = excluded.exam_label,
            exam_date = excluded.exam_date,
            school_year = excluded.school_year,
            grade_level = excluded.grade_level,
            semester = excluded.semester,
            exam_kind = excluded.exam_kind,
            exam_month = excluded.exam_month,
            updated_at = excluded.updated_at
        """,
        (
            int(student_id),
            exam_source,
            MATH_SUBJECT,
            float(score),
            exam_label,
            exam_date,
            school_year,
            grade_level,
            semester,
            exam_kind,
            exam_month,
            origin_table,
            int(origin_id),
            now,
            now,
        ),
    )


def _get_or_create_school_session(
    conn: sqlite3.Connection,
    *,
    school_year: int,
    grade_level: str,
    semester: str,
    exam_kind: str,
) -> int:
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    row = conn.execute(
        """
        SELECT id FROM external_grade_sessions
        WHERE exam_source = ? AND school_year = ? AND grade_level = ?
          AND semester = ? AND exam_kind = ?
        """,
        (
            EXAM_SOURCE_SCHOOL,
            int(school_year),
            grade_level.strip(),
            semester.strip(),
            exam_kind.strip(),
        ),
    ).fetchone()
    if row:
        sid = int(row[0])
        conn.execute(
            "UPDATE external_grade_sessions SET updated_at = ? WHERE id = ?",
            (now, sid),
        )
        return sid
    cur = conn.execute(
        """
        INSERT INTO external_grade_sessions (
            exam_source, school_year, grade_level, semester, exam_kind,
            exam_month, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?) RETURNING id
        """,
        (
            EXAM_SOURCE_SCHOOL,
            int(school_year),
            grade_level.strip(),
            semester.strip(),
            exam_kind.strip(),
            now,
            now,
        ),
    )
    return int(cur.fetchone()[0])


def _get_or_create_mock_session(
    conn: sqlite3.Connection,
    *,
    school_year: int,
    grade_level: str,
    exam_month: int,
) -> int:
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    row = conn.execute(
        """
        SELECT id FROM external_grade_sessions
        WHERE exam_source = ? AND school_year = ? AND grade_level = ?
          AND exam_month = ?
        """,
        (
            EXAM_SOURCE_MOCK,
            int(school_year),
            grade_level.strip(),
            int(exam_month),
        ),
    ).fetchone()
    if row:
        sid = int(row[0])
        conn.execute(
            "UPDATE external_grade_sessions SET updated_at = ? WHERE id = ?",
            (now, sid),
        )
        return sid
    cur = conn.execute(
        """
        INSERT INTO external_grade_sessions (
            exam_source, school_year, grade_level, semester, exam_kind,
            exam_month, created_at, updated_at
        ) VALUES (?, ?, ?, '', '', ?, ?, ?) RETURNING id
        """,
        (
            EXAM_SOURCE_MOCK,
            int(school_year),
            grade_level.strip(),
            int(exam_month),
            now,
            now,
        ),
    )
    return int(cur.fetchone()[0])


def save_school_math_grade(
    *,
    student_id: int,
    school_year: int,
    grade_level: str,
    semester: str,
    exam_kind: str,
    score: float,
) -> int:
    """Save school-exam math score to external + unified tables."""
    ensure_student_grade_unified_table()
    ensure_external_grade_exam_month()
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    exam_date = f"{int(school_year)}-06-01"
    exam_label = f"{school_year} {grade_level} {semester} {exam_kind} · 수학"

    conn = get_conn()
    try:
        session_id = _get_or_create_school_session(
            conn,
            school_year=school_year,
            grade_level=grade_level,
            semester=semester,
            exam_kind=exam_kind,
        )
        conn.execute(
            """
            INSERT INTO external_grade_records (
                session_id, student_id, subject_name, score, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id, student_id, subject_name) DO UPDATE SET
                score = excluded.score,
                updated_at = excluded.updated_at
            """,
            (session_id, int(student_id), MATH_SUBJECT, float(score), now, now),
        )
        rec = conn.execute(
            """
            SELECT id FROM external_grade_records
            WHERE session_id = ? AND student_id = ? AND subject_name = ?
            """,
            (session_id, int(student_id), MATH_SUBJECT),
        ).fetchone()
        if rec:
            _upsert_unified_grade(
                conn,
                student_id=int(student_id),
                exam_source=EXAM_SOURCE_SCHOOL,
                score=float(score),
                exam_label=exam_label,
                exam_date=exam_date,
                origin_table="external_grade_records",
                origin_id=int(rec[0]),
                school_year=int(school_year),
                grade_level=grade_level,
                semester=semester,
                exam_kind=exam_kind,
            )
        conn.commit()
        return int(rec[0]) if rec else 0
    finally:
        conn.close()


def save_mock_math_grade(
    *,
    student_id: int,
    school_year: int,
    grade_level: str,
    exam_month: int,
    score: float,
) -> int:
    """Save mock-exam math score to external + unified tables."""
    ensure_student_grade_unified_table()
    ensure_external_grade_exam_month()
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    exam_date = f"{int(school_year)}-{int(exam_month):02d}-01"
    exam_label = f"{school_year} {grade_level} {exam_month}월 모의고사 · 수학"

    conn = get_conn()
    try:
        session_id = _get_or_create_mock_session(
            conn,
            school_year=school_year,
            grade_level=grade_level,
            exam_month=exam_month,
        )
        conn.execute(
            """
            INSERT INTO external_grade_records (
                session_id, student_id, subject_name, score, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id, student_id, subject_name) DO UPDATE SET
                score = excluded.score,
                updated_at = excluded.updated_at
            """,
            (session_id, int(student_id), MATH_SUBJECT, float(score), now, now),
        )
        rec = conn.execute(
            """
            SELECT id FROM external_grade_records
            WHERE session_id = ? AND student_id = ? AND subject_name = ?
            """,
            (session_id, int(student_id), MATH_SUBJECT),
        ).fetchone()
        if rec:
            _upsert_unified_grade(
                conn,
                student_id=int(student_id),
                exam_source=EXAM_SOURCE_MOCK,
                score=float(score),
                exam_label=exam_label,
                exam_date=exam_date,
                origin_table="external_grade_records",
                origin_id=int(rec[0]),
                school_year=int(school_year),
                grade_level=grade_level,
                exam_month=int(exam_month),
            )
        conn.commit()
        return int(rec[0]) if rec else 0
    finally:
        conn.close()


def sync_student_grade_unified(student_id: int) -> None:
    """Rebuild unified rows for one student from all legacy/source tables."""
    ensure_student_grade_unified_table()
    ensure_external_grade_exam_month()
    ensure_ai_test_tables()

    conn = get_conn()
    try:
        conn.execute(
            "DELETE FROM student_grade_unified WHERE student_id = ?",
            (int(student_id),),
        )

        ext_rows = conn.execute(
            """
            SELECT
                r.id, r.student_id, r.score, s.exam_source, s.school_year,
                s.grade_level, s.semester, s.exam_kind, s.exam_month, s.updated_at
            FROM external_grade_records r
            JOIN external_grade_sessions s ON s.id = r.session_id
            WHERE r.student_id = ? AND r.subject_name = ?
            """,
            (int(student_id), MATH_SUBJECT),
        ).fetchall()
        for row in ext_rows:
            rid, sid, score, src, yr, gl, sem, kind, month, upd = row
            if src == EXAM_SOURCE_SCHOOL:
                label = f"{yr} {gl} {sem} {kind} · 수학"
                exam_date = (
                    f"{int(yr)}-06-01"
                    if yr is not None
                    else str(date.today().isoformat())[:10]
                )
            else:
                if month is not None:
                    label = f"{yr} {gl} {int(month)}월 모의고사 · 수학"
                    exam_date = (
                        f"{int(yr)}-{int(month):02d}-01"
                        if yr is not None
                        else f"{date.today().year}-{int(month):02d}-01"
                    )
                else:
                    label = f"{yr} {gl} 모의고사 · 수학"
                    exam_date = (
                        f"{int(yr)}-01-01"
                        if yr is not None
                        else str(date.today().isoformat())[:10]
                    )
            _upsert_unified_grade(
                conn,
                student_id=int(sid),
                exam_source=str(src),
                score=float(score),
                exam_label=label,
                exam_date=exam_date,
                origin_table="external_grade_records",
                origin_id=int(rid),
                school_year=int(yr) if yr is not None else None,
                grade_level=str(gl or ""),
                semester=str(sem or "") or None,
                exam_kind=str(kind or "") or None,
                exam_month=int(month) if month is not None else None,
            )

        ai_rows = conn.execute(
            """
            SELECT sr.id, sr.student_id, sr.score, sr.recorded_at,
                   t.test_name, t.date
            FROM student_results sr
            JOIN tests t ON t.test_id = sr.test_id
            WHERE sr.student_id = ?
            """,
            (int(student_id),),
        ).fetchall()
        for row in ai_rows:
            rid, sid, score, recorded_at, test_name, test_date = row
            label = f"{test_name} · AI 테스트"
            exam_date = str(test_date or recorded_at or date.today().isoformat())[:10]
            _upsert_unified_grade(
                conn,
                student_id=int(sid),
                exam_source=EXAM_SOURCE_AI_TEST,
                score=float(score),
                exam_label=label,
                exam_date=exam_date,
                origin_table="student_results",
                origin_id=int(rid),
            )

        manual_rows = conn.execute(
            """
            SELECT MIN(sc.id) AS row_id, e.id AS exam_id, e.name, e.exam_date,
                   AVG(sc.score) AS avg_score
            FROM student_scores sc
            JOIN exams e ON e.id = sc.exam_id
            WHERE sc.student_id = ?
            GROUP BY e.id
            """,
            (int(student_id),),
        ).fetchall()
        for row in manual_rows:
            row_id, _exam_id, name, exam_date, avg_score = row
            if avg_score is None or row_id is None:
                continue
            label = f"{name} · 수기 입력"
            _upsert_unified_grade(
                conn,
                student_id=int(student_id),
                exam_source=EXAM_SOURCE_ACADEMY_MANUAL,
                score=float(avg_score),
                exam_label=label,
                exam_date=str(exam_date or date.today().isoformat())[:10],
                origin_table="student_scores",
                origin_id=int(row_id),
            )

        conn.commit()
    finally:
        conn.close()


def get_student_unified_grades(student_id: int) -> pd.DataFrame:
    """Return all unified math grades for a student, grouped-ready DataFrame."""
    if student_id is None:
        return pd.DataFrame()
    sync_student_grade_unified(int(student_id))
    conn = get_conn()
    df = pd.read_sql_query(
        """
        SELECT
            id, student_id, exam_source, subject, score, exam_label, exam_date,
            school_year, grade_level, semester, exam_kind, exam_month,
            origin_table, origin_id, updated_at
        FROM student_grade_unified
        WHERE student_id = ?
        ORDER BY exam_date DESC, updated_at DESC
        """,
        conn,
        params=(int(student_id),),
    )
    conn.close()
    if not df.empty:
        df["exam_source_label"] = (
            df["exam_source"].map(EXAM_SOURCE_LABELS).fillna(df["exam_source"])
        )
    return df


ACADEMY_EXAM_SOURCES = (EXAM_SOURCE_AI_TEST, EXAM_SOURCE_ACADEMY_MANUAL)

UNIFIED_GROUP_SCHOOL = "school"
UNIFIED_GROUP_MOCK = "mock"
UNIFIED_GROUP_ACADEMY = "academy"

UNIFIED_GROUP_LABELS: dict[str, str] = {
    UNIFIED_GROUP_SCHOOL: "학교시험",
    UNIFIED_GROUP_MOCK: "모의고사",
    UNIFIED_GROUP_ACADEMY: "학원시험",
}


def get_student_unified_grades_filtered(
    student_id: int,
    *,
    include_school: bool = True,
    include_mock: bool = True,
    include_academy: bool = True,
) -> pd.DataFrame:
    """Return unified grades filtered by report checkbox groups."""
    if student_id is None:
        return pd.DataFrame()
    df = get_student_unified_grades(student_id)
    if df.empty:
        return df
    allowed: list[str] = []
    if include_school:
        allowed.append(EXAM_SOURCE_SCHOOL)
    if include_mock:
        allowed.append(EXAM_SOURCE_MOCK)
    if include_academy:
        allowed.extend(list(ACADEMY_EXAM_SOURCES))
    if not allowed:
        return df.iloc[0:0].copy()
    return df[df["exam_source"].isin(allowed)].copy()


def split_unified_grades_by_group(df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Split unified dataframe into school / mock / academy sections."""
    if df.empty:
        return {
            UNIFIED_GROUP_SCHOOL: df,
            UNIFIED_GROUP_MOCK: df,
            UNIFIED_GROUP_ACADEMY: df,
        }
    return {
        UNIFIED_GROUP_SCHOOL: df[df["exam_source"] == EXAM_SOURCE_SCHOOL].copy(),
        UNIFIED_GROUP_MOCK: df[df["exam_source"] == EXAM_SOURCE_MOCK].copy(),
        UNIFIED_GROUP_ACADEMY: df[df["exam_source"].isin(ACADEMY_EXAM_SOURCES)].copy(),
    }


def format_unified_grade_report_markdown(
    student_name: str,
    df: pd.DataFrame,
) -> str:
    """Build markdown body for on-screen unified report preview."""
    lines = [
        f"# {student_name} — 통합 성적 보고서",
        f"생성일: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "",
    ]
    if df.empty:
        lines.append("_선택한 항목에 해당하는 성적 기록이 없습니다._")
        return "\n".join(lines)

    sections = split_unified_grades_by_group(df)
    for group_key, label in UNIFIED_GROUP_LABELS.items():
        sub = sections[group_key]
        if sub.empty:
            continue
        lines.append(f"## {label}")
        for _, row in sub.iterrows():
            lines.append(
                f"- **{row['exam_label']}** · {float(row['score']):.1f}점 "
                f"({row['exam_date']})"
            )
        lines.append("")
    return "\n".join(lines)


def get_student_result_by_result_id(result_id: int) -> dict[str, Any] | None:
    """Load ``student_results`` row by primary key (for AI TEST linkage)."""
    ensure_ai_test_tables()
    conn = get_conn()
    try:
        row = conn.execute(
            """
            SELECT
                sr.id,
                sr.student_id,
                sr.test_id,
                sr.wrong_numbers,
                sr.wrong_count,
                sr.score,
                sr.recorded_at,
                t.test_name,
                t.date,
                t.total_questions,
                t.file_name
            FROM student_results sr
            JOIN tests t ON t.test_id = sr.test_id
            WHERE sr.id = ?
            """,
            (int(result_id),),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return None
    cols = (
        "id",
        "student_id",
        "test_id",
        "wrong_numbers",
        "wrong_count",
        "score",
        "recorded_at",
        "test_name",
        "date",
        "total_questions",
        "file_name",
    )
    data = dict(zip(cols, row))
    try:
        data["wrong_numbers"] = json.loads(data.get("wrong_numbers") or "[]")
    except json.JSONDecodeError:
        data["wrong_numbers"] = []
    return data


def get_external_grade_records(
    *,
    exam_source: str,
    school_year: int | None = None,
    grade_level: str | None = None,
    semester: str | None = None,
    exam_kind: str | None = None,
    exam_month: int | None = None,
    student_id: int | None = None,
    teacher_id: int | None = None,
) -> pd.DataFrame:
    """Load external math grade rows for list views."""
    conn = get_conn()
    q = """
        SELECT
            r.id, s.exam_source, s.school_year, s.grade_level, s.semester,
            s.exam_kind, s.exam_month, r.student_id, st.name AS student_name,
            COALESCE(c.name, '—') AS class_name, r.subject_name, r.score, r.updated_at
        FROM external_grade_records r
        JOIN external_grade_sessions s ON s.id = r.session_id
        JOIN students st ON st.id = r.student_id
        LEFT JOIN classes c ON c.id = st.class_id
        WHERE s.exam_source = ? AND r.subject_name = ?
    """
    params: list[Any] = [exam_source, MATH_SUBJECT]
    if school_year is not None:
        q += " AND s.school_year = ?"
        params.append(int(school_year))
    if grade_level:
        q += " AND s.grade_level = ?"
        params.append(grade_level)
    if semester:
        q += " AND s.semester = ?"
        params.append(semester)
    if exam_kind:
        q += " AND s.exam_kind = ?"
        params.append(exam_kind)
    if exam_month is not None:
        q += " AND s.exam_month = ?"
        params.append(int(exam_month))
    if student_id is not None:
        q += " AND r.student_id = ?"
        params.append(int(student_id))
    if teacher_id is not None:
        q += " AND c.teacher_id = ?"
        params.append(int(teacher_id))
    q += " ORDER BY s.school_year DESC, s.exam_month DESC, st.name"
    df = pd.read_sql_query(q, conn, params=params)
    conn.close()
    return df
