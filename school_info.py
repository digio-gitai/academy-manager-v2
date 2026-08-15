"""학사정보 — 학교·학년·연도별 학사일정 + 교과서 목록 관리.

⚠️ 완전히 새로 추가된 모듈입니다. 기존 app.py / database.py의 어떤 함수·
   테이블도 수정하지 않습니다(순수 추가). 테이블 2개(school_calendar_events,
   school_textbooks)는 database.py의 ensure_school_info_tables()로 만듭니다.

이 모듈이 하는 일
  - 학사일정: 학교(학생명부의 학교명 그대로) + 학년 + 연도 단위로 중간고사·
    기말고사·여름방학·겨울방학·기타(수련회, 체육대회 등 자유 입력) 일정을
    등록/수정/삭제.
  - 교과서 목록: 같은 단위(학교+학년+연도)로 교과서명·출판사를 기록해서
    출판사가 매년 바뀌어도 이력을 남길 수 있게 함.
  - 학교마다·학년마다 시험 일정이 다르므로 항상 "학교 + 연도"를 먼저 고른
    뒤, 그 안에서 학년별로 묶어서 한 화면에 다 보여준다(한눈에 보기).
    항목(행) 단위로 수정/삭제 가능.

Public API:
  - render_school_info_page(teacher_id)
"""

from __future__ import annotations

from datetime import date, datetime

import pandas as pd
import streamlit as st

from database import ensure_school_info_tables
from db_connect import get_conn

GRADE_OPTIONS: list[str] = [
    "초등학교 1학년", "초등학교 2학년", "초등학교 3학년",
    "초등학교 4학년", "초등학교 5학년", "초등학교 6학년",
    "중학교 1학년", "중학교 2학년", "중학교 3학년",
    "고등학교 1학년", "고등학교 2학년", "고등학교 3학년",
]
_GRADE_SORT_KEY = {g: i for i, g in enumerate(GRADE_OPTIONS)}

EVENT_TYPE_OPTIONS: list[str] = ["중간고사", "기말고사", "여름방학", "겨울방학", "기타"]


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def _read_sql_df(query: str, params: tuple | list = ()) -> pd.DataFrame:
    """pd.read_sql_query() 대신 쓰는 안전한 대체 함수.

    이 프로젝트 DB 연결은 pandas 표준 DBAPI2/SQLAlchemy가 아니라서 legacy
    파서를 타는데, 그 경로에서 NULL이 문자열 "nan"으로 잘못 바뀌는 버그가
    있다(hw_assign.py / hw_upload.py에서 실사용 중 발견해 이미 이 방식으로
    고쳐둔 패턴 — 여기서도 동일하게 적용).
    """
    conn = get_conn()
    cur = conn.execute(query, tuple(params))
    rows = cur.fetchall()
    cols = [d[0] for d in cur.description]
    conn.close()
    return pd.DataFrame(rows, columns=cols, dtype=object)


def _year_options() -> list[int]:
    this_year = date.today().year
    return list(range(this_year - 2, this_year + 2))


# ═══════════════════════════════════════════════════════════════
# 조회
# ═══════════════════════════════════════════════════════════════


def get_school_options() -> list[str]:
    """학생명부(students.school)에 등록된 학교명 목록(중복 제거, 정렬)."""
    df = _read_sql_df(
        "SELECT DISTINCT school FROM students "
        "WHERE school IS NOT NULL AND school <> '' ORDER BY school"
    )
    if df.empty:
        return []
    return [str(v) for v in df["school"].tolist()]


def get_calendar_events(school: str, year: int) -> pd.DataFrame:
    ensure_school_info_tables()
    df = _read_sql_df(
        "SELECT id, school, grade, year, event_type, event_name, start_date, "
        "end_date, note FROM school_calendar_events "
        "WHERE school = ? AND year = ? ORDER BY start_date",
        (school, int(year)),
    )
    if df.empty:
        return df
    df["_grade_order"] = df["grade"].map(lambda g: _GRADE_SORT_KEY.get(g, 999))
    return df.sort_values(["_grade_order", "start_date"]).drop(columns=["_grade_order"])


def get_textbooks(school: str, year: int) -> pd.DataFrame:
    ensure_school_info_tables()
    df = _read_sql_df(
        "SELECT id, school, grade, year, textbook_name, publisher, note "
        "FROM school_textbooks WHERE school = ? AND year = ? "
        "ORDER BY grade, textbook_name",
        (school, int(year)),
    )
    if df.empty:
        return df
    df["_grade_order"] = df["grade"].map(lambda g: _GRADE_SORT_KEY.get(g, 999))
    return df.sort_values(["_grade_order", "textbook_name"]).drop(columns=["_grade_order"])


def get_calendar_event_by_id(event_id: int) -> dict | None:
    df = _read_sql_df(
        "SELECT id, school, grade, year, event_type, event_name, start_date, "
        "end_date, note FROM school_calendar_events WHERE id = ?",
        (event_id,),
    )
    if df.empty:
        return None
    return df.iloc[0].to_dict()


def get_textbook_by_id(textbook_id: int) -> dict | None:
    df = _read_sql_df(
        "SELECT id, school, grade, year, textbook_name, publisher, note "
        "FROM school_textbooks WHERE id = ?",
        (textbook_id,),
    )
    if df.empty:
        return None
    return df.iloc[0].to_dict()


# ═══════════════════════════════════════════════════════════════
# 저장 / 삭제
# ═══════════════════════════════════════════════════════════════


def save_calendar_event(
    *,
    event_id: int | None,
    school: str,
    grade: str,
    year: int,
    event_type: str,
    event_name: str,
    start_date: str,
    end_date: str,
    note: str,
    created_by: int | None,
) -> int:
    ensure_school_info_tables()
    conn = get_conn()
    ts = _now()
    try:
        if event_id is None:
            cur = conn.execute(
                """
                INSERT INTO school_calendar_events
                    (school, grade, year, event_type, event_name, start_date,
                     end_date, note, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
                """,
                (school, grade, int(year), event_type, event_name.strip(),
                 start_date, end_date, note.strip(), created_by, ts, ts),
            )
            new_id = int(cur.fetchone()[0])
        else:
            conn.execute(
                """
                UPDATE school_calendar_events
                SET school = ?, grade = ?, year = ?, event_type = ?,
                    event_name = ?, start_date = ?, end_date = ?, note = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (school, grade, int(year), event_type, event_name.strip(),
                 start_date, end_date, note.strip(), ts, event_id),
            )
            new_id = event_id
        conn.commit()
        return new_id
    finally:
        conn.close()


def delete_calendar_event(event_id: int) -> None:
    ensure_school_info_tables()
    conn = get_conn()
    conn.execute("DELETE FROM school_calendar_events WHERE id = ?", (event_id,))
    conn.commit()
    conn.close()


def save_textbook(
    *,
    textbook_id: int | None,
    school: str,
    grade: str,
    year: int,
    textbook_name: str,
    publisher: str,
    note: str,
    created_by: int | None,
) -> int:
    ensure_school_info_tables()
    conn = get_conn()
    ts = _now()
    try:
        if textbook_id is None:
            cur = conn.execute(
                """
                INSERT INTO school_textbooks
                    (school, grade, year, textbook_name, publisher, note,
                     created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
                """,
                (school, grade, int(year), textbook_name.strip(),
                 publisher.strip(), note.strip(), created_by, ts, ts),
            )
            new_id = int(cur.fetchone()[0])
        else:
            conn.execute(
                """
                UPDATE school_textbooks
                SET school = ?, grade = ?, year = ?, textbook_name = ?,
                    publisher = ?, note = ?, updated_at = ?
                WHERE id = ?
                """,
                (school, grade, int(year), textbook_name.strip(),
                 publisher.strip(), note.strip(), ts, textbook_id),
            )
            new_id = textbook_id
        conn.commit()
        return new_id
    finally:
        conn.close()


def delete_textbook(textbook_id: int) -> None:
    ensure_school_info_tables()
    conn = get_conn()
    conn.execute("DELETE FROM school_textbooks WHERE id = ?", (textbook_id,))
    conn.commit()
    conn.close()


# ═══════════════════════════════════════════════════════════════
# 화면
# ═══════════════════════════════════════════════════════════════


def _school_year_picker(*, key_prefix: str) -> tuple[str, int] | None:
    """학교 + 연도 선택 위젯. (school, year) 반환, 학교가 없으면 None."""
    roster_schools = get_school_options()
    c1, c2, c3 = st.columns([2.4, 1, 1.2])
    with c1:
        use_manual = st.checkbox(
            "목록에 없는 학교명 직접 입력",
            key=f"{key_prefix}_manual_toggle",
            help="학생명부에 아직 이 학교 학생이 없어도, 미리 학사일정/교과서를 등록해두고 싶을 때 체크하세요.",
        )
        if use_manual or not roster_schools:
            school = st.text_input(
                "학교명", key=f"{key_prefix}_school_manual", placeholder="예) 장충고등학교"
            ).strip()
        else:
            school = st.selectbox(
                "학교 (학생명부 기준)", roster_schools, key=f"{key_prefix}_school_select"
            )
    with c2:
        years = _year_options()
        year = st.selectbox(
            "연도", years, index=years.index(date.today().year), key=f"{key_prefix}_year"
        )
    with c3:
        st.write("")
        st.write("")
        st.caption(f"학생명부 등록 학교 {len(roster_schools)}곳")
    if not school:
        st.info("학교명을 선택하거나 입력해 주세요.")
        return None
    return school, int(year)


def _render_calendar_tab(teacher_id: int | None) -> None:
    st.caption("학교 · 학년 · 연도별로 중간고사 / 기말고사 / 여름방학 / 겨울방학 / 기타 일정을 등록합니다. 학년마다 시험 일정이 다르므로 학년을 꼭 선택해 주세요.")
    picked = _school_year_picker(key_prefix="cal")
    if not picked:
        return
    school, year = picked

    edit_id = st.session_state.get("cal_edit_id")
    edit_row = get_calendar_event_by_id(edit_id) if edit_id else None

    with st.container(border=True):
        st.markdown(f"#### {'✏️ 일정 수정' if edit_row is not None else '➕ 새 일정 추가'}")
        if edit_row is not None:
            default_grades = [edit_row["grade"]]
            default_type = edit_row["event_type"]
            default_event_name = edit_row["event_name"] or ""
            default_start = edit_row["start_date"]
            default_end = edit_row["end_date"] or ""
            default_note = edit_row["note"] or ""
        else:
            default_grades = []
            default_type = EVENT_TYPE_OPTIONS[0]
            default_event_name = ""
            default_start = ""
            default_end = ""
            default_note = ""

        grades = st.multiselect(
            "학년 (여러 학년에 같은 일정을 한 번에 등록할 수 있어요)",
            GRADE_OPTIONS,
            default=default_grades,
            key="cal_form_grades",
            disabled=edit_row is not None,
        )
        if edit_row is not None:
            st.caption(f"수정 중인 항목은 학년을 바꿀 수 없습니다 (학년: {edit_row['grade']}). 학년을 바꾸려면 삭제 후 새로 등록해 주세요.")

        event_type = st.radio(
            "유형", EVENT_TYPE_OPTIONS, horizontal=True,
            index=EVENT_TYPE_OPTIONS.index(default_type) if default_type in EVENT_TYPE_OPTIONS else 0,
            key="cal_form_type",
        )
        event_name = ""
        if event_type == "기타":
            event_name = st.text_input(
                "일정 이름 (예: 수련회, 체육대회)", value=default_event_name, key="cal_form_name"
            )

        c1, c2 = st.columns(2)
        with c1:
            start_val = date.fromisoformat(default_start) if default_start else date.today()
            start_date = st.date_input("시작일", value=start_val, key="cal_form_start")
        with c2:
            end_val = date.fromisoformat(default_end) if default_end else start_val
            has_range = st.checkbox("기간이 있는 일정 (종료일 지정)", value=bool(default_end), key="cal_form_has_range")
            end_date_val = st.date_input("종료일", value=end_val, key="cal_form_end", disabled=not has_range)

        note = st.text_area("비고 (선택)", value=default_note, key="cal_form_note", height=70)

        bc1, bc2 = st.columns([1, 1])
        save_clicked = bc1.button(
            "수정 저장" if edit_row is not None else "저장",
            type="primary", use_container_width=True, key="cal_form_save",
        )
        cancel_clicked = False
        if edit_row is not None:
            cancel_clicked = bc2.button("취소", use_container_width=True, key="cal_form_cancel")

        if cancel_clicked:
            st.session_state["cal_edit_id"] = None
            st.rerun()

        if save_clicked:
            if event_type == "기타" and not event_name.strip():
                st.error("기타 일정은 이름을 입력해 주세요. (예: 수련회)")
            elif edit_row is None and not grades:
                st.error("학년을 1개 이상 선택해 주세요.")
            else:
                end_str = end_date_val.isoformat() if has_range else ""
                if edit_row is not None:
                    save_calendar_event(
                        event_id=int(edit_row["id"]), school=school, grade=edit_row["grade"],
                        year=year, event_type=event_type, event_name=event_name,
                        start_date=start_date.isoformat(), end_date=end_str, note=note,
                        created_by=teacher_id,
                    )
                    st.session_state["cal_edit_id"] = None
                    st.success("수정했습니다.")
                else:
                    for g in grades:
                        save_calendar_event(
                            event_id=None, school=school, grade=g, year=year,
                            event_type=event_type, event_name=event_name,
                            start_date=start_date.isoformat(), end_date=end_str, note=note,
                            created_by=teacher_id,
                        )
                    st.success(f"{len(grades)}개 학년에 일정을 등록했습니다.")
                st.rerun()

    st.markdown(f"#### 📅 {school} · {year}년 학사일정")
    df = get_calendar_events(school, year)
    if df.empty:
        st.info("등록된 학사일정이 없습니다. 위에서 추가해 주세요.")
        return

    for grade in GRADE_OPTIONS:
        g_df = df[df["grade"] == grade]
        if g_df.empty:
            continue
        with st.expander(f"{grade} ({len(g_df)}건)", expanded=True):
            for _, row in g_df.iterrows():
                label = row["event_name"] if row["event_type"] == "기타" and row["event_name"] else row["event_type"]
                date_range = row["start_date"]
                if row["end_date"]:
                    date_range += f" ~ {row['end_date']}"
                rc1, rc2, rc3 = st.columns([3, 1, 1])
                with rc1:
                    st.markdown(f"**{label}** · {date_range}" + (f"  \n💬 {row['note']}" if row["note"] else ""))
                with rc2:
                    if st.button("수정", key=f"cal_edit_{row['id']}", use_container_width=True):
                        st.session_state["cal_edit_id"] = int(row["id"])
                        st.rerun()
                with rc3:
                    if st.button("삭제", key=f"cal_del_{row['id']}", use_container_width=True):
                        delete_calendar_event(int(row["id"]))
                        st.rerun()
                st.divider()


def _render_textbook_tab(teacher_id: int | None) -> None:
    st.caption("학교 · 학년 · 연도별로 사용 중인 교과서(출판사 포함)를 기록합니다. 출판사가 해마다 바뀌어도 이력이 남습니다.")
    picked = _school_year_picker(key_prefix="tb")
    if not picked:
        return
    school, year = picked

    edit_id = st.session_state.get("tb_edit_id")
    edit_row = get_textbook_by_id(edit_id) if edit_id else None

    with st.container(border=True):
        st.markdown(f"#### {'✏️ 교과서 정보 수정' if edit_row is not None else '➕ 새 교과서 추가'}")
        if edit_row is not None:
            default_grades = [edit_row["grade"]]
            default_name = edit_row["textbook_name"] or ""
            default_publisher = edit_row["publisher"] or ""
            default_note = edit_row["note"] or ""
        else:
            default_grades = []
            default_name = ""
            default_publisher = ""
            default_note = ""

        grades = st.multiselect(
            "학년 (여러 학년에 같은 교과서를 한 번에 등록할 수 있어요)",
            GRADE_OPTIONS,
            default=default_grades,
            key="tb_form_grades",
            disabled=edit_row is not None,
        )
        if edit_row is not None:
            st.caption(f"수정 중인 항목은 학년을 바꿀 수 없습니다 (학년: {edit_row['grade']}).")

        c1, c2 = st.columns(2)
        with c1:
            textbook_name = st.text_input("교과서명", value=default_name, key="tb_form_name", placeholder="예) 수학2")
        with c2:
            publisher = st.text_input("출판사", value=default_publisher, key="tb_form_publisher", placeholder="예) 미래엔")
        note = st.text_area("비고 (선택)", value=default_note, key="tb_form_note", height=70)

        bc1, bc2 = st.columns([1, 1])
        save_clicked = bc1.button(
            "수정 저장" if edit_row is not None else "저장",
            type="primary", use_container_width=True, key="tb_form_save",
        )
        cancel_clicked = False
        if edit_row is not None:
            cancel_clicked = bc2.button("취소", use_container_width=True, key="tb_form_cancel")

        if cancel_clicked:
            st.session_state["tb_edit_id"] = None
            st.rerun()

        if save_clicked:
            if not textbook_name.strip():
                st.error("교과서명을 입력해 주세요.")
            elif edit_row is None and not grades:
                st.error("학년을 1개 이상 선택해 주세요.")
            else:
                if edit_row is not None:
                    save_textbook(
                        textbook_id=int(edit_row["id"]), school=school, grade=edit_row["grade"],
                        year=year, textbook_name=textbook_name, publisher=publisher,
                        note=note, created_by=teacher_id,
                    )
                    st.session_state["tb_edit_id"] = None
                    st.success("수정했습니다.")
                else:
                    for g in grades:
                        save_textbook(
                            textbook_id=None, school=school, grade=g, year=year,
                            textbook_name=textbook_name, publisher=publisher,
                            note=note, created_by=teacher_id,
                        )
                    st.success(f"{len(grades)}개 학년에 교과서를 등록했습니다.")
                st.rerun()

    st.markdown(f"#### 📚 {school} · {year}년 교과서 목록")
    df = get_textbooks(school, year)
    if df.empty:
        st.info("등록된 교과서가 없습니다. 위에서 추가해 주세요.")
        return

    for grade in GRADE_OPTIONS:
        g_df = df[df["grade"] == grade]
        if g_df.empty:
            continue
        with st.expander(f"{grade} ({len(g_df)}건)", expanded=True):
            for _, row in g_df.iterrows():
                rc1, rc2, rc3 = st.columns([3, 1, 1])
                with rc1:
                    pub = f" ({row['publisher']})" if row["publisher"] else ""
                    st.markdown(f"**{row['textbook_name']}**{pub}" + (f"  \n💬 {row['note']}" if row["note"] else ""))
                with rc2:
                    if st.button("수정", key=f"tb_edit_{row['id']}", use_container_width=True):
                        st.session_state["tb_edit_id"] = int(row["id"])
                        st.rerun()
                with rc3:
                    if st.button("삭제", key=f"tb_del_{row['id']}", use_container_width=True):
                        delete_textbook(int(row["id"]))
                        st.rerun()
                st.divider()


def render_school_info_page(teacher_id: int | None) -> None:
    """학사정보 메뉴 진입점 — 학사일정 / 교과서 목록 탭."""
    ensure_school_info_tables()
    tab_cal, tab_tb = st.tabs(["📅 학사일정", "📚 교과서 목록"])
    with tab_cal:
        _render_calendar_tab(teacher_id)
    with tab_tb:
        _render_textbook_tab(teacher_id)
