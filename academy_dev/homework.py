"""과제 관리 — 출석 체크 화면에 붙는 신규 기능 모듈.

⚠️ 이 파일은 완전히 새로 추가된 모듈입니다. 기존 app.py / database.py의
   어떤 함수·테이블도 수정하지 않습니다. (테이블은 CREATE TABLE IF NOT EXISTS로
   새로 추가되는 것뿐이고, 기존 테이블에는 손대지 않습니다.)

제공 기능
  - 반 공통 과제 저장/조회 (수업일 단위, 1개)
  - 학생별 개별 추가 과제 저장/조회 (선택 사항)
  - 학생별 "과제 수행도" 상/중/하 체크 저장/조회 (2026-08-06 추가)
  - 출석 체크 화면 하단에 붙는 "오늘 과제" 입력 UI
    (직전 수업 과제를 참고용으로 함께 보여줌)
  - 전체 과제 이력을 반/학생/키워드/기간으로 검색하는 UI

Public API:
  - ensure_homework_tables()
  - save_class_homework(class_id, session_date, content)
  - get_class_homework(class_id, session_date) -> str
  - get_hw_assignment_summary(class_id, session_date) -> dict | None  [신규 2026-08-08]
  - get_previous_class_homework(class_id, before_date) -> dict | None
  - save_student_homework_note(student_id, class_id, session_date, note)
  - get_student_homework_notes(class_id, session_date) -> dict[int, str]
  - save_student_homework_performance(student_id, class_id, session_date, level)
  - get_student_homework_performance(class_id, session_date) -> dict[int, str]
  - get_student_homework_performance_stats(student_id, from_date, to_date) -> dict
  - search_homework_history(...) -> pandas.DataFrame
  - render_homework_section(class_id, class_name, session_date_str, students_df)
  - render_homework_history_section(classes_df)
"""

from __future__ import annotations

from datetime import datetime

import pandas as pd
import streamlit as st

from db_connect import get_conn

_TABLES_READY = False


# ═══════════════════════════════════════════════════════════════
# 테이블 준비 (기존 테이블은 절대 건드리지 않음 — 새 테이블만 추가)
# ═══════════════════════════════════════════════════════════════


def ensure_homework_tables() -> None:
    """class_homework / student_homework_notes 테이블이 없으면 생성한다.

    여러 번 호출해도 안전(CREATE TABLE IF NOT EXISTS). 화면이 로드될 때마다
    호출해도 되도록 가볍게 만들어져 있다 (기존 코드의 ensure_ai_test_tables()와
    동일한 패턴).
    """
    global _TABLES_READY
    if _TABLES_READY:
        return
    conn = get_conn()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS class_homework (
            id           SERIAL PRIMARY KEY,
            class_id     INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
            session_date TEXT NOT NULL,
            content      TEXT NOT NULL DEFAULT '',
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL,
            UNIQUE(class_id, session_date)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS student_homework_notes (
            id           SERIAL PRIMARY KEY,
            student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            class_id     INTEGER REFERENCES classes(id) ON DELETE SET NULL,
            session_date TEXT NOT NULL,
            note         TEXT NOT NULL DEFAULT '',
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL,
            UNIQUE(student_id, session_date)
        )
        """
    )
    # [신규 추가 2026-08-06] 학생별 "과제 수행도(상/중/하)" — 오늘 수업에서
    # 직전 과제를 얼마나 해왔는지 체크. student_homework_notes(과제 내용 메모)와는
    # 별개 테이블로 둔다 (의미가 다르므로 섞지 않음).
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS student_homework_performance (
            id           SERIAL PRIMARY KEY,
            student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
            class_id     INTEGER REFERENCES classes(id) ON DELETE SET NULL,
            session_date TEXT NOT NULL,
            level        TEXT NOT NULL DEFAULT '중',
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL,
            UNIQUE(student_id, session_date)
        )
        """
    )
    conn.commit()
    conn.close()
    _TABLES_READY = True


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


# ═══════════════════════════════════════════════════════════════
# 반 공통 과제
# ═══════════════════════════════════════════════════════════════


def save_class_homework(class_id: int, session_date: str, content: str) -> None:
    ensure_homework_tables()
    conn = get_conn()
    ts = _now()
    conn.execute(
        """
        INSERT INTO class_homework (class_id, session_date, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(class_id, session_date)
        DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
        """,
        (class_id, session_date, content.strip(), ts, ts),
    )
    conn.commit()
    conn.close()


def get_class_homework(class_id: int, session_date: str) -> str:
    ensure_homework_tables()
    conn = get_conn()
    row = conn.execute(
        "SELECT content FROM class_homework WHERE class_id = ? AND session_date = ?",
        (class_id, session_date),
    ).fetchone()
    conn.close()
    return row[0] if row and row[0] else ""


def get_hw_assignment_summary(class_id: int, session_date: str) -> dict | None:
    """이 반·날짜에 '과제 인증'(hw_assign.py) 메뉴에서 등록한 과제가 있으면
    제목과 항목 요약을 반환한다(없으면 None). {"title": str, "summary": str}

    [신규 추가 2026-08-08] 과제인증 쪽에서 과제를 등록하면 출석부의 "오늘
    과제"에도 자동으로 항목 요약이 채워지는데(hw_assign.save_assignment()가
    save_class_homework()를 호출), 여기서 또 수동으로 고쳐 쓸 수 있으면
    두 화면의 내용이 어긋날 수 있다. render_homework_section()이 이 함수로
    "출처가 과제인증인지"를 확인해서, 그런 경우엔 반 공통 과제 입력칸을
    읽기 전용으로 바꾼다 — 수정은 '과제 인증' 메뉴에서만 하도록 통일.

    class_homework에 복사돼 있는 값(save_assignment() 저장 시점에 채워짐)을
    그대로 믿지 않고, hw_assignments/hw_items를 매번 직접 조회해서 항목
    요약을 실시간으로 다시 만든다 — 이 동기화 기능이 생기기 전에 이미
    등록해 둔 과제(class_homework에 복사분이 없는 경우)도 여기서 바로
    보이게 하기 위해서다.

    hw_assignments/hw_items 테이블은 이 모듈이 만드는 게 아니라 database.py의
    ensure_hw_tables()가 만든다. 아직 그 테이블이 없는 상태(과제인증 기능을
    한 번도 안 쓴 환경)에서 조회하면 에러가 날 수 있으므로, 실패하면 그냥
    "과제인증에서 등록된 과제 없음"으로 간주하고 기존처럼 수동 입력을
    허용한다(안전한 기본값).
    """
    conn = get_conn()
    try:
        arow = conn.execute(
            "SELECT id, title FROM hw_assignments WHERE class_id = ? AND assigned_date = ?",
            (class_id, session_date),
        ).fetchone()
        if not arow:
            return None
        assignment_id, title = int(arow[0]), arow[1]
        items = conn.execute(
            """
            SELECT item_type, material_name, page_start, page_end, description
            FROM hw_items WHERE assignment_id = ? ORDER BY sort_order
            """,
            (assignment_id,),
        ).fetchall()
    except Exception:
        return None
    finally:
        conn.close()

    parts: list[str] = []
    for item_type, material_name, page_start, page_end, description in items:
        name = (material_name or "").strip()
        if not name:
            continue
        if item_type == "page_range" and page_start and page_end:
            parts.append(f"{name} ({page_start}~{page_end}쪽)")
        else:
            desc = (description or "").strip()
            parts.append(f"{name} 오답정리 ({desc})" if desc else f"{name} 오답정리")
    return {"title": title, "summary": ", ".join(parts)}


def get_previous_class_homework(class_id: int, before_date: str) -> dict | None:
    """지정한 날짜보다 이전 세션 중 가장 최근에 저장된 반 공통 과제를 반환한다."""
    ensure_homework_tables()
    conn = get_conn()
    row = conn.execute(
        """
        SELECT session_date, content FROM class_homework
        WHERE class_id = ? AND session_date < ? AND content <> ''
        ORDER BY session_date DESC
        LIMIT 1
        """,
        (class_id, before_date),
    ).fetchone()
    conn.close()
    if not row:
        return None
    return {"session_date": row[0], "content": row[1]}


# ═══════════════════════════════════════════════════════════════
# 학생별 개별 추가 과제
# ═══════════════════════════════════════════════════════════════


def save_student_homework_note(
    student_id: int, class_id: int | None, session_date: str, note: str
) -> None:
    ensure_homework_tables()
    conn = get_conn()
    ts = _now()
    conn.execute(
        """
        INSERT INTO student_homework_notes
            (student_id, class_id, session_date, note, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, session_date)
        DO UPDATE SET note = excluded.note, class_id = excluded.class_id,
                      updated_at = excluded.updated_at
        """,
        (student_id, class_id, session_date, note.strip(), ts, ts),
    )
    conn.commit()
    conn.close()


def get_student_homework_notes(class_id: int, session_date: str) -> dict[int, str]:
    ensure_homework_tables()
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT student_id, note FROM student_homework_notes
        WHERE class_id = ? AND session_date = ?
        """,
        (class_id, session_date),
    ).fetchall()
    conn.close()
    return {r[0]: r[1] for r in rows if r[1]}


# ═══════════════════════════════════════════════════════════════
# 학생별 과제 수행도 (상/중/하) — [신규 추가 2026-08-06]
# ═══════════════════════════════════════════════════════════════

HOMEWORK_PERFORMANCE_LEVELS = ["상", "중", "하"]


def save_student_homework_performance(
    student_id: int, class_id: int | None, session_date: str, level: str
) -> None:
    ensure_homework_tables()
    if level not in HOMEWORK_PERFORMANCE_LEVELS:
        level = "중"
    conn = get_conn()
    ts = _now()
    conn.execute(
        """
        INSERT INTO student_homework_performance
            (student_id, class_id, session_date, level, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(student_id, session_date)
        DO UPDATE SET level = excluded.level, class_id = excluded.class_id,
                      updated_at = excluded.updated_at
        """,
        (student_id, class_id, session_date, level, ts, ts),
    )
    conn.commit()
    conn.close()


def get_student_homework_performance(class_id: int, session_date: str) -> dict[int, str]:
    """오늘 세션에 이미 저장된 학생별 과제 수행도 {student_id: '상'|'중'|'하'}."""
    ensure_homework_tables()
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT student_id, level FROM student_homework_performance
        WHERE class_id = ? AND session_date = ?
        """,
        (class_id, session_date),
    ).fetchall()
    conn.close()
    return {r[0]: r[1] for r in rows if r[1]}


# 보고서용 환산 점수: 상=100, 중=50, 하=0
HOMEWORK_PERFORMANCE_SCORES = {"상": 100, "중": 50, "하": 0}


def get_student_homework_performance_stats(
    student_id: int, from_date: str, to_date: str
) -> dict:
    """보고서용 — 특정 학생의 기간 과제 수행도 요약(반 무관, 학생 기준).

    반환: {"high": 상 횟수, "mid": 중 횟수, "low": 하 횟수, "total": 전체 횟수,
           "rate": 수행률(%) | None(기록 없음)}
    """
    ensure_homework_tables()
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT level FROM student_homework_performance
        WHERE student_id = ? AND session_date BETWEEN ? AND ?
        """,
        (student_id, from_date, to_date),
    ).fetchall()
    conn.close()
    high = sum(1 for r in rows if r[0] == "상")
    mid = sum(1 for r in rows if r[0] == "중")
    low = sum(1 for r in rows if r[0] == "하")
    total = high + mid + low
    rate = round((high * 100 + mid * 50) / total, 1) if total else None
    return {"high": high, "mid": mid, "low": low, "total": total, "rate": rate}


# ═══════════════════════════════════════════════════════════════
# 과제 이력 검색
# ═══════════════════════════════════════════════════════════════


def search_homework_history(
    class_id: int | None = None,
    student_id: int | None = None,
    keyword: str = "",
    from_date: str | None = None,
    to_date: str | None = None,
) -> pd.DataFrame:
    """반 공통 과제 + 학생별 개별 과제를 합쳐서 최신순으로 검색한다."""
    ensure_homework_tables()
    conn = get_conn()

    q = """
        SELECT ch.session_date, c.name AS class_name, ch.class_id,
               NULL AS student_name, NULL AS student_id,
               ch.content AS homework_text, '반 공통' AS kind
        FROM class_homework ch
        LEFT JOIN classes c ON c.id = ch.class_id
        WHERE ch.content <> ''
    """
    params: list = []
    if class_id is not None:
        q += " AND ch.class_id = ?"
        params.append(class_id)
    if from_date:
        q += " AND ch.session_date >= ?"
        params.append(from_date)
    if to_date:
        q += " AND ch.session_date <= ?"
        params.append(to_date)
    if keyword:
        q += " AND ch.content ILIKE ?"
        params.append(f"%{keyword}%")

    common_df = pd.read_sql_query(q, conn, params=params)

    q2 = """
        SELECT shn.session_date, c.name AS class_name, shn.class_id,
               s.name AS student_name, shn.student_id,
               shn.note AS homework_text, '개별 추가' AS kind
        FROM student_homework_notes shn
        JOIN students s ON s.id = shn.student_id
        LEFT JOIN classes c ON c.id = shn.class_id
        WHERE shn.note <> ''
    """
    params2: list = []
    if class_id is not None:
        q2 += " AND shn.class_id = ?"
        params2.append(class_id)
    if student_id is not None:
        q2 += " AND shn.student_id = ?"
        params2.append(student_id)
    if from_date:
        q2 += " AND shn.session_date >= ?"
        params2.append(from_date)
    if to_date:
        q2 += " AND shn.session_date <= ?"
        params2.append(to_date)
    if keyword:
        q2 += " AND shn.note ILIKE ?"
        params2.append(f"%{keyword}%")

    indiv_df = pd.read_sql_query(q2, conn, params=params2)

    # [신규 추가 2026-08-06] 과제 수행도(상/중/하) — 일단 간단히 같은 표에
    # '과제 수행도' 구분으로 얹어서 보여준다. 자유 텍스트가 아니라 상/중/하
    # 값이라 키워드 검색은 적용하지 않는다(키워드 있으면 이 결과는 제외).
    if keyword:
        perf_df = pd.DataFrame(
            columns=["session_date", "class_name", "class_id", "student_name",
                     "student_id", "homework_text", "kind"]
        )
    else:
        q3 = """
            SELECT shp.session_date, c.name AS class_name, shp.class_id,
                   s.name AS student_name, shp.student_id,
                   shp.level AS homework_text, '과제 수행도' AS kind
            FROM student_homework_performance shp
            JOIN students s ON s.id = shp.student_id
            LEFT JOIN classes c ON c.id = shp.class_id
            WHERE 1=1
        """
        params3: list = []
        if class_id is not None:
            q3 += " AND shp.class_id = ?"
            params3.append(class_id)
        if student_id is not None:
            q3 += " AND shp.student_id = ?"
            params3.append(student_id)
        if from_date:
            q3 += " AND shp.session_date >= ?"
            params3.append(from_date)
        if to_date:
            q3 += " AND shp.session_date <= ?"
            params3.append(to_date)
        perf_df = pd.read_sql_query(q3, conn, params=params3)

    conn.close()

    combined = pd.concat([common_df, indiv_df, perf_df], ignore_index=True)

    if combined.empty:
        return combined
    combined = combined.sort_values("session_date", ascending=False).reset_index(drop=True)
    return combined


# ═══════════════════════════════════════════════════════════════
# Streamlit UI — 출석 체크 화면 하단에 삽입
# ═══════════════════════════════════════════════════════════════


def render_homework_section(
    class_id: int, class_name: str, session_date_str: str, students_df: pd.DataFrame
) -> None:
    """출석 체크 탭 맨 아래에 붙이는 '오늘 과제' 입력 영역.

    - 직전 수업에 등록된 반 공통 과제를 참고용으로 먼저 보여준다. (유지)
    - 오늘 날짜의 반 공통 과제를 입력/수정할 수 있다.
    - 학생별로 "과제 수행도(상/중/하)"를 체크할 수 있다. (2026-08-06 추가)
    - 필요할 때만 펼쳐서 학생별 개별 추가 과제를 넣을 수 있다.
    """
    ensure_homework_tables()

    with st.container(border=True):
        st.markdown("#### 오늘 과제")

        # ── 직전 수업 과제 참고 표시 — 그대로 유지 ──
        prev = get_previous_class_homework(class_id, session_date_str)
        if prev:
            st.caption(f"직전 수업 과제 ({prev['session_date']}) — 참고용")
            st.text_area(
                "직전 수업 과제",
                value=prev["content"],
                height=90,
                disabled=True,
                label_visibility="collapsed",
                key=f"hw_prev_{class_id}_{session_date_str}",
            )
        else:
            st.caption("직전 수업에 등록된 과제가 없습니다.")

        current_common = get_class_homework(class_id, session_date_str)
        current_notes = get_student_homework_notes(class_id, session_date_str)
        current_perf = get_student_homework_performance(class_id, session_date_str)

        # [신규 2026-08-08] 과제인증(hw_assign.py)에서 이 반·날짜에 이미 과제를
        # 등록했으면, 반 공통 과제는 거기가 원본이다 — 여기서는 확인만 하고
        # 수정은 막는다(두 화면 내용이 어긋나는 것을 방지). 학생별 개별 추가
        # 과제·과제 수행도 체크는 과제인증과 무관한 별개 기능이라 그대로 둔다.
        # class_homework 복사본이 아니라 hw_assignments/hw_items를 매번 직접
        # 조회해서 보여준다 — 이 동기화가 생기기 전에 등록해 둔 과제도 바로
        # 보이게 하기 위해서(복사본에만 의존하면 옛날 과제는 빈칸으로 보임).
        hw_assignment = get_hw_assignment_summary(class_id, session_date_str)
        common_locked = hw_assignment is not None

        with st.form(f"homework_form_{class_id}_{session_date_str}"):
            if common_locked:
                st.caption(
                    f"📌 이 과제는 '과제 인증' 메뉴에서 등록된 과제입니다("
                    f"{hw_assignment['title']}). 내용 확인만 가능하며, 수정은 "
                    f"'과제 인증' 메뉴에서 해주세요."
                )
                display_val = hw_assignment["summary"] or "(등록된 과제 항목이 없습니다 — '과제 인증' 메뉴에서 확인해주세요.)"
                st.text_area(
                    f"오늘({session_date_str}) 과제 — {class_name} 공통",
                    value=display_val,
                    height=110,
                    disabled=True,
                )
                common_val = hw_assignment["summary"]
            else:
                common_val = st.text_area(
                    f"오늘({session_date_str}) 과제 — {class_name} 공통",
                    value=current_common,
                    height=110,
                    placeholder="예: 문제집 p.30~35, 오답 3문제 오답노트 정리",
                )

            st.markdown("##### 과제 수행도 체크 (직전 과제 기준, 상/중/하)")
            perf_inputs: dict[int, str] = {}
            if students_df.empty:
                st.caption("배정된 학생이 없습니다.")
            else:
                for _, student in students_df.iterrows():
                    sid = int(student["id"])
                    current_level = current_perf.get(sid, "중")
                    if current_level not in HOMEWORK_PERFORMANCE_LEVELS:
                        current_level = "중"
                    prc = st.columns([2, 3])
                    prc[0].markdown(f"**{student['name']}**")
                    perf_inputs[sid] = prc[1].radio(
                        "과제 수행도",
                        HOMEWORK_PERFORMANCE_LEVELS,
                        index=HOMEWORK_PERFORMANCE_LEVELS.index(current_level),
                        horizontal=True,
                        key=f"hw_perf_{class_id}_{session_date_str}_{sid}",
                        label_visibility="collapsed",
                    )

            indiv_inputs: dict[int, str] = {}
            with st.expander("학생별 개별 추가 과제 (필요한 학생만 작성)"):
                if students_df.empty:
                    st.caption("배정된 학생이 없습니다.")
                else:
                    for _, student in students_df.iterrows():
                        sid = int(student["id"])
                        indiv_inputs[sid] = st.text_input(
                            student["name"],
                            value=current_notes.get(sid, ""),
                            key=f"hw_indiv_{class_id}_{session_date_str}_{sid}",
                            placeholder="예: 보강분 추가로 p.20~22",
                        )

            hw_save_btn = st.form_submit_button(
                "과제 저장", width="stretch", type="primary"
            )

        if hw_save_btn:
            if not common_locked:
                save_class_homework(class_id, session_date_str, common_val)
            for sid, note_val in indiv_inputs.items():
                save_student_homework_note(sid, class_id, session_date_str, note_val)
            for sid, level_val in perf_inputs.items():
                save_student_homework_performance(sid, class_id, session_date_str, level_val)
            st.success("과제가 저장되었습니다.")
            st.rerun()


# ═══════════════════════════════════════════════════════════════
# Streamlit UI — 과제 이력 검색 (별도 탭)
# ═══════════════════════════════════════════════════════════════


def render_homework_history_section(classes_df: pd.DataFrame) -> None:
    ensure_homework_tables()

    with st.container(border=True):
        st.markdown("#### 과제 이력 검색")
        class_opts: dict[str, int | None] = {"전체 수업": None}
        for _, row in classes_df.iterrows():
            class_opts[row["name"]] = int(row["id"])

        c1, c2 = st.columns(2)
        with c1:
            sel_cls_name = st.selectbox(
                "수업", list(class_opts.keys()), key="hw_hist_class"
            )
        with c2:
            keyword = st.text_input(
                "검색어 (과제 내용)", key="hw_hist_keyword", placeholder="예: 오답노트"
            )

        d1, d2 = st.columns(2)
        with d1:
            from_d = st.date_input("시작일", value=None, key="hw_hist_from")
        with d2:
            to_d = st.date_input("종료일", value=None, key="hw_hist_to")

        search_btn = st.button("검색", type="primary", key="hw_hist_search_btn")

    if search_btn or "hw_hist_last_result" in st.session_state:
        result_df = search_homework_history(
            class_id=class_opts[sel_cls_name],
            keyword=keyword.strip(),
            from_date=from_d.strftime("%Y-%m-%d") if from_d else None,
            to_date=to_d.strftime("%Y-%m-%d") if to_d else None,
        )
        st.session_state["hw_hist_last_result"] = True

        with st.container(border=True):
            if result_df.empty:
                st.info("검색 결과가 없습니다.")
            else:
                disp = result_df.copy()
                disp["student_name"] = disp["student_name"].fillna("—")
                disp = disp[
                    ["session_date", "class_name", "kind", "student_name", "homework_text"]
                ]
                disp.columns = ["날짜", "수업", "구분", "학생", "과제 내용"]
                disp = disp.reset_index(drop=True)
                disp.index += 1
                st.dataframe(disp, width="stretch")
