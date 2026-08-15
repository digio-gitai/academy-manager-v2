"""abc 과제 인증 시스템 — 2단계+4단계: 선생님용 과제 부여·현황 화면.

⚠️ 완전히 새로 추가된 모듈입니다. 기존 app.py / database.py / homework.py의
   어떤 함수·테이블도 수정하지 않습니다. hw_* 테이블은 1단계에서
   database.py의 ensure_hw_tables()로 이미 만들어 둔 것을 그대로 씁니다.

이 모듈이 하는 일
  2단계: 반을 고르면 학생 목록이 뜨고, 과제를 받을 학생을 선택 → 문제집/프린트를
    항목 단위로 여러 개 등록(페이지 범위형 / 오답정리형) → 저장하면 과제 1건 +
    학생별 제출현황(업로드 링크 토큰 포함) + 항목들이 한 번에 생성됨.
  4단계(2026-08-03 추가): 학생별 "인증(사진 업로드) 필요/불필요" 체크 —
    체크된 학생은 hw_submissions(업로드 추적)를 안 만들어서 "미완료 학생"
    집계에서 자연히 빠진다. + "미완료 학생 명단" 섹션 — 이름을 누르면 그
    학생이 과거에 받은 과제들 중 아직 다 못한 것들을 날짜·기한·상태(완료/
    일부완료/열람 후 미완료/미열람 + 기한초과)와 함께, 항목별로 몇 쪽이
    남았는지까지 펼쳐서 보여준다(다음 수업 때 추가로 뭘 더 내줘야 할지
    바로 판단할 수 있게).

아직 안 만든 것 (다음 단계)
  - 6단계: dev 환경 통합 테스트 (실제 SMS 발송까지 브라우저로 눌러서 확인)

이미 만든 것 (추가)
  - 출석부 "전 수업 과제" 자동 연동 (2026-08-08): save_assignment() 끝에서
    homework.save_class_homework(class_id, assigned_date, 항목요약텍스트)를
    호출해서, 과제를 등록/수정하면 출석부의 "오늘 과제" 메모칸에도 항목
    목록이 자동으로 채워진다. homework.py는 건드리지 않았고 기존 함수를
    그대로 호출만 한다. 실패해도 과제 저장 자체는 성공하도록 예외를 감쌌다.
    단, 이 자동 채움은 출석부 메모를 "덮어쓴다" — 선생님이 출석부에서 직접
    수동으로 다르게 적어둔 내용이 있으면 다음 과제 저장 때 그 내용이 사라
    지고 자동 요약으로 대체된다.
  - 5단계: 학부모 SMS 발송 (2026-08-08): "최근 부여한 과제" 목록의 각 과제
    아래에 "학부모에게 완료/미완료 문자 발송" 버튼 추가. 기존 성적표 문자
    인프라(sms_sender.py)를 재사용하되, 성적표는 링크 전송용이라 새로
    send_text_sms(phone, text) 함수를 sms_sender.py에 추가해서 자유 문구를
    보낼 수 있게 했다(기존 send_report_sms()는 손 안 댐 — 순수 추가).
    문구는 항목별 완료/미완료를 요약한 텍스트(설계 메모대로 링크 아님) —
    _build_hw_sms_text()가 hw_upload.get_items_with_state()로 항목별 진행
    상태를 가져와 "- 문제집명: 완료" / "- 문제집명: 미완료(0/4쪽)" 형식으로
    조립한다. 발송 트리거는 교사가 직접 버튼을 누르는 수동 방식(기존 성적표
    일괄발송 화면과 동일한 UX — 진행률 표시, 성공/실패 집계, 연락처 없는
    학생 자동 제외)으로 정했다 — 제출 즉시 자동발송이나 마감시간 자동발송은
    다루지 않음(필요해지면 나중에 추가).
    아직 검증 안 됨: 실제 SOLAPI_API_KEY/SENDER가 dev .env에 비어있는 채로
    둔 상태라(운영 SMS 오발송 방지용, CLAUDE.md 참고) 지금 버튼을 눌러도
    "발신번호가 설정되지 않았습니다" 에러가 날 것이다. 실제 발송 테스트를
    하려면 본인 명의 테스트 계정/번호로 dev .env에 SOLAPI 키를 채워야 함
    (운영 발신번호를 그대로 쓰면 안 됨).

Public API:
  - render_hw_assign_page(classes_df, teacher_id)
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

import pandas as pd
import streamlit as st

import homework
from branding import SMS_GREETING
from database import ensure_hw_tables
from db_connect import get_conn
from hw_photo_review import has_unverified_photos, render_photo_review
from hw_reference import render_reference_upload_section
from hw_upload import (
    compute_display_status,
    format_page_ranges,
    get_items_with_state,
    parse_completed_pages,
)

_ITEM_TYPE_LABELS = {"page_range": "페이지 범위형", "wrong_note": "오답정리형"}

# [운영 병합 시 2026-08-14 수정] dev에서는 로컬 주소(http://localhost:8502)를
# 썼지만, 운영에서는 학부모/학생이 문자로 받는 링크가 실제로 열려야 하므로
# app.py와 동일한 배포 주소를 쓴다. app.py가 이 모듈을 import하기 때문에
# (역방향 import는 순환참조가 되어 여기서 "from app import APP_BASE_URL"을
# 쓸 수 없다) app.py의 APP_BASE_URL과 같은 값을 그대로 복제해서 상수로 둔다.
# 나중에 APP_BASE_URL 값이 바뀌면 app.py와 이 값 둘 다 같이 바꿔줘야 한다.
HW_UPLOAD_BASE_URL = "https://academy-manager-v2-36428o4i69sqpda2yc5xpg.streamlit.app"


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def _new_token() -> str:
    return uuid.uuid4().hex[:16]


def _read_sql_df(query: str, params: tuple | list = ()) -> pd.DataFrame:
    """pd.read_sql_query(query, conn, ...) 대신 쓰는 안전한 대체 함수.

    [버그 수정 2026-08-08] 이 프로젝트의 DB 연결(db_connect._CompatConnection)은
    sqlite3.Connection도 SQLAlchemy 엔진도 아니라서, pandas가 "지원 안 되는
    DBAPI2 커넥션"으로 보고 예전 방식(legacy) 파서로 처리한다. 실사용
    테스트에서 이 legacy 파서가 SQL NULL을 파이썬 None이 아니라 문자열
    "nan"으로 잘못 바꿔버리는 게 발견됐다 — 그래서 한 번도 열람 안 한 학생의
    hw_submissions.viewed_at(NULL)이 pandas를 거치면 문자열 "nan"이 되고,
    `if viewed_at:` 같은 참/거짓 검사에서 True로 잘못 판정돼 "열람함"으로
    표시되는 버그가 있었다(실제로는 한 번도 안 열어봤는데도 "열람 후
    미완료"로 표시됨).

    conn.execute()로 직접 커서를 얻어 fetchall()한 뒤 DataFrame을 만들면 이
    legacy 파서를 아예 거치지 않아서 NULL이 파이썬 None 그대로 유지된다.
    이 모듈의 모든 pd.read_sql_query() 호출을 이 함수로 바꿨다.
    """
    conn = get_conn()
    cur = conn.execute(query, tuple(params))
    rows = cur.fetchall()
    cols = [d[0] for d in cur.description]
    conn.close()
    # dtype=object을 강제로 지정한다. 사용자 환경의 pandas는
    # future.infer_string 옵션이 켜져 있어서(pandas 2.x의 신형 문자열 dtype
    # 자동 추론), 지정 안 하면 이 컬럼에 NaN과 실제 문자열이 섞여 있을 때
    # pandas가 통째로 "string" dtype으로 자동 변환하면서 NaN을 진짜 결측치가
    # 아니라 글자 그대로 "nan"이라는 문자열로 바꿔버린다(그러면
    # `if viewed_at:` 검사가 True로 잘못 판정됨 — 실사용 테스트에서 발견).
    # dtype=object로 강제하면 각 값이 원래 파이썬 타입(None 포함) 그대로
    # 유지된다.
    return pd.DataFrame(rows, columns=cols, dtype=object)


def _build_class_homework_summary(items: list[dict]) -> str:
    """과제 항목 목록을 출석부 "오늘 과제" 메모칸에 넣을 한 줄 요약으로 바꾼다.

    예: "쎈수학 (12~20쪽), 8/1 단원평가 오답정리"
    """
    parts: list[str] = []
    for item in items:
        name = (item.get("material_name") or "").strip()
        if not name:
            continue
        if (
            item.get("item_type") == "page_range"
            and item.get("page_start")
            and item.get("page_end")
        ):
            parts.append(f"{name} ({item['page_start']}~{item['page_end']}쪽)")
        else:
            desc = (item.get("description") or "").strip()
            parts.append(f"{name} 오답정리 ({desc})" if desc else f"{name} 오답정리")
    return ", ".join(parts)


def _build_hw_sms_text(
    *, student_name: str, assigned_date: str, title: str, item_states_df: pd.DataFrame
) -> tuple[str, bool]:
    """학부모에게 보낼 과제 완료/미완료 요약 문자 문구를 만든다.

    [5단계, 2026-08-08] 링크가 아니라 항목별 완료/미완료를 짧은 텍스트로
    요약해서 보낸다(설계 메모 그대로). 반환값의 두 번째 값(all_done)은
    이 과제를 전부 끝냈는지 — 발송 UI에서 "완료/미완료" 표시용.

    문자 요금(90바이트 = 단문) 안에 다 안 들어가는 경우가 많을 수 있는데,
    실제 발송은 sms_sender.send_text_sms()가 그대로 solapi에 넘기고,
    solapi가 길이에 맞춰 자동으로 장문(LMS)으로 바꿔서 보낸다(기존
    send_report_sms()도 같은 방식 — 명시적으로 type을 지정하지 않음).
    """
    lines: list[str] = []
    all_done = True
    for _, irow in item_states_df.iterrows():
        name = irow["material_name"]
        has_pages = (
            irow["item_type"] == "page_range"
            and pd.notna(irow["page_start"])
            and pd.notna(irow["page_end"])
        )
        if has_pages:
            page_start, page_end = int(irow["page_start"]), int(irow["page_end"])
            total_pages = page_end - page_start + 1
            completed = parse_completed_pages(irow["completed_pages"])
            full_range = set(range(page_start, page_end + 1))
            done_pages = completed & full_range
            if len(done_pages) >= total_pages and total_pages > 0:
                lines.append(f"- {name}: 완료")
            else:
                all_done = False
                lines.append(f"- {name}: 미완료({len(done_pages)}/{total_pages}쪽)")
        else:
            if irow["sub_status"] == "done":
                lines.append(f"- {name}: 완료")
            else:
                all_done = False
                lines.append(f"- {name}: 미완료")

    overall = "완료" if all_done else "미완료"
    text = (
        f"{SMS_GREETING}\n"
        f"{student_name} 학생 {assigned_date} 과제({title}) 현황 — {overall}\n"
        + "\n".join(lines)
    )
    return text, all_done


# ═══════════════════════════════════════════════════════════════
# 조회
# ═══════════════════════════════════════════════════════════════


def get_students_by_class(class_id: int) -> pd.DataFrame:
    return _read_sql_df(
        "SELECT id, name FROM students WHERE class_id = %s ORDER BY name",
        (class_id,),
    )


def get_recent_assignments(class_id: int | None = None, limit: int = 20) -> pd.DataFrame:
    ensure_hw_tables()
    q = """
        SELECT a.id, a.title, a.assigned_date, a.due_date, c.name AS class_name,
               COUNT(DISTINCT t.student_id) AS student_count,
               COUNT(DISTINCT i.id) AS item_count
        FROM hw_assignments a
        LEFT JOIN classes c ON c.id = a.class_id
        LEFT JOIN hw_assignment_targets t ON t.assignment_id = a.id
        LEFT JOIN hw_items i ON i.assignment_id = a.id
    """
    params: list = []
    if class_id is not None:
        q += " WHERE a.class_id = %s"
        params.append(class_id)
    q += " GROUP BY a.id, a.title, a.assigned_date, a.due_date, c.name ORDER BY a.id DESC LIMIT %s"
    params.append(limit)
    return _read_sql_df(q, params)


def get_items_for_assignment(assignment_id: int) -> pd.DataFrame:
    """이 과제의 항목 전체(공통 + 개별) — student_id가 NULL이면 공통 항목,
    아니면 그 학생 전용 개별 항목이다(2026-08-14 개별 과제 부여 추가).
    student_name은 개별 항목일 때만 채워진다(공통 항목은 NULL).

    [2026-08-15 추가] i.id도 item_id로 같이 가져온다 — "최근 부여한 과제"
    화면에서 항목을 하나씩 골라 삭제할 수 있게 하려면 각 행의 실제 id가
    필요하다(delete_hw_item() 참고).
    """
    ensure_hw_tables()
    return _read_sql_df(
        """
        SELECT i.id AS item_id, i.item_type, i.material_name, i.page_start, i.page_end,
               i.description, i.student_id, st.name AS student_name
        FROM hw_items i
        LEFT JOIN students st ON st.id = i.student_id
        WHERE i.assignment_id = %s
        ORDER BY (i.student_id IS NOT NULL), st.name, i.sort_order, i.id
        """,
        (assignment_id,),
    )


def get_individual_items(assignment_id: int, student_id: int) -> pd.DataFrame:
    """[개별 과제 부여, 2026-08-14] 이 학생 전용 개별 항목만 가져온다
    (공통 항목 제외) — 과제 부여 화면에서 학생별로 편집할 때 쓴다."""
    ensure_hw_tables()
    return _read_sql_df(
        """
        SELECT item_type, material_name, page_start, page_end, description
        FROM hw_items
        WHERE assignment_id = %s AND student_id = %s
        ORDER BY sort_order, id
        """,
        (assignment_id, student_id),
    )


def get_include_common(assignment_id: int, student_id: int) -> bool:
    """[개별 과제 부여, 2026-08-14] 이 학생이 공통 항목도 같이 인증해야
    하는지(기본값 True). hw_assignment_targets 행이 없으면(아직 이 과제의
    대상으로 저장된 적 없는 학생) 안전하게 True를 기본으로 돌려준다."""
    ensure_hw_tables()
    conn = get_conn()
    row = conn.execute(
        "SELECT include_common FROM hw_assignment_targets "
        "WHERE assignment_id = ? AND student_id = ?",
        (assignment_id, student_id),
    ).fetchone()
    conn.close()
    if row is None:
        return True
    return bool(row[0])


def get_assignment_for_class_date(class_id: int, assigned_date: str) -> dict | None:
    """같은 반 + 같은 날짜에 이미 만든 과제가 있으면 그 정보를 반환한다.

    한 반·한 날짜에는 과제가 하나만 있는 게 자연스럽다고 보고(같은 날 숙제를
    두 번 저장하면 "새 과제"가 아니라 "수정"으로 취급), 이 함수로 기존 과제를 찾아
    폼에 미리 채워주고, 저장 시 새로 만들지 않고 그 과제를 업데이트한다.
    """
    ensure_hw_tables()
    conn = get_conn()
    row = conn.execute(
        """
        SELECT id, title, due_date FROM hw_assignments
        WHERE class_id = ? AND assigned_date = ?
        ORDER BY id DESC LIMIT 1
        """,
        (class_id, assigned_date),
    ).fetchone()
    conn.close()
    if not row:
        return None
    return {"id": int(row[0]), "title": row[1] or "", "due_date": row[2] or ""}


def get_target_student_ids(assignment_id: int) -> list[int]:
    ensure_hw_tables()
    conn = get_conn()
    rows = conn.execute(
        "SELECT student_id FROM hw_assignment_targets WHERE assignment_id = ?",
        (assignment_id,),
    ).fetchall()
    conn.close()
    return [int(r[0]) for r in rows]


def get_no_certification_student_ids(assignment_id: int) -> list[int]:
    """이 과제에서 "인증(사진 업로드) 불필요"로 체크된 학생 id 목록."""
    ensure_hw_tables()
    conn = get_conn()
    rows = conn.execute(
        "SELECT student_id FROM hw_assignment_targets "
        "WHERE assignment_id = ? AND requires_certification = FALSE",
        (assignment_id,),
    ).fetchall()
    conn.close()
    return [int(r[0]) for r in rows]


def get_incomplete_students(class_id: int) -> pd.DataFrame:
    """이 반에서 인증이 필요한 과제 중 아직 다 못 끝낸 학생 목록(이름만, 중복 없이).

    requires_certification = FALSE로 체크된 학생은 애초에 hw_submissions가
    안 만들어지므로(save_assignment 참고) 자동으로 이 목록에서 빠진다.
    """
    ensure_hw_tables()
    return _read_sql_df(
        """
        SELECT DISTINCT st.id AS student_id, st.name AS student_name
        FROM hw_submissions s
        JOIN hw_assignments a ON a.id = s.assignment_id
        JOIN students st ON st.id = s.student_id
        WHERE a.class_id = %s AND s.status != 'done'
        ORDER BY st.name
        """,
        (class_id,),
    )


def get_student_assignment_history(student_id: int, class_id: int | None = None) -> pd.DataFrame:
    """이 학생이 받은 과제(인증 필요한 것만) 이력을 최신순으로 가져온다.

    "다음 수업시간에 조회 가능하게" — 학생을 눌렀을 때 언제 뭘 내줬고
    기한까지 어떻게 됐는지 한눈에 보려고 만든 함수.
    """
    ensure_hw_tables()
    q = """
        SELECT a.id AS assignment_id, a.title, a.assigned_date, a.due_date,
               c.name AS class_name, s.id AS submission_id, s.status, s.viewed_at
        FROM hw_submissions s
        JOIN hw_assignments a ON a.id = s.assignment_id
        LEFT JOIN classes c ON c.id = a.class_id
        WHERE s.student_id = %s
    """
    params: list = [student_id]
    if class_id is not None:
        q += " AND a.class_id = %s"
        params.append(class_id)
    q += " ORDER BY a.assigned_date DESC, a.id DESC"
    return _read_sql_df(q, params)


def get_submissions_for_assignment(assignment_id: int) -> pd.DataFrame:
    """이 과제를 받은 학생별 업로드 토큰·제출 상태를 가져온다 (3단계 링크 확인용).

    [2026-08-15 추가] student_phone(학생 본인 연락처)도 같이 가져온다 —
    "업로드 링크 문자 발송" 버튼이 실제로는 항상 parent_phone(보호자
    번호)으로만 나가고 있었는데, 버튼 문구는 "학생에게 발송"이라 학생
    본인에게 가는 줄 알았다는 혼선이 있어서(학생용 링크는 학생이 직접
    받아야 자연스러움) — 학생 연락처가 등록돼 있으면 그쪽으로 보내도록
    고친다.
    """
    ensure_hw_tables()
    return _read_sql_df(
        """
        SELECT st.id AS student_id, st.name AS student_name, st.parent_phone,
               COALESCE(st.student_phone, '') AS student_phone,
               s.id AS submission_id, s.upload_token, s.status, s.viewed_at, s.notified_at
        FROM hw_submissions s
        JOIN students st ON st.id = s.student_id
        WHERE s.assignment_id = %s
        ORDER BY st.name
        """,
        (assignment_id,),
    )


def mark_notified(submission_id: int) -> None:
    """이 제출건에 학부모 문자를 보냈다고 기록한다(hw_submissions.notified_at).

    [야간 자동발송, 2026-08-11] hw_submissions 테이블에는 1단계 설계 때부터
    이미 notified_at 컬럼이 있었지만(용도만 예약돼 있었고 실제로 쓰인 적은
    없었다) 지금까지 아무 데도 안 채워지고 있었다. 이걸 그대로 재사용해서
    "오늘 이미 문자를 보냈는지" 판단 기준으로 쓴다 — 수동 발송(교사가 버튼
    누름)과 야간 자동발송이 서로 겹쳐서 같은 학부모에게 문자가 두 번 가는
    걸 막기 위함. 별도 로그 테이블을 새로 안 만들고 기존 컬럼을 활용한다.
    """
    ensure_hw_tables()
    conn = get_conn()
    conn.execute(
        "UPDATE hw_submissions SET notified_at = ? WHERE id = ?",
        (_now(), submission_id),
    )
    conn.commit()
    conn.close()


def was_notified_today(notified_at: str | None) -> bool:
    """notified_at 값이 '오늘'인지 확인한다 (야간 자동발송의 중복 방지 조건)."""
    if not notified_at:
        return False
    return str(notified_at)[:10] == date.today().strftime("%Y-%m-%d")


def delete_assignment(assignment_id: int) -> None:
    """과제 1건을 통째로 삭제한다 (대상 학생·제출현황·항목도 함께 삭제됨)."""
    ensure_hw_tables()
    conn = get_conn()
    conn.execute("DELETE FROM hw_assignments WHERE id = ?", (assignment_id,))
    conn.commit()
    conn.close()


def delete_hw_item(item_id: int) -> None:
    """[2026-08-15 추가] 항목 1개만 삭제한다(과제 전체는 그대로 둠).

    잘못 중복 등록된 항목을 골라서 지우거나, 개별 항목 하나만 취소하고
    싶을 때 쓴다. hw_items → hw_item_submissions → hw_photos가 전부
    ON DELETE CASCADE로 걸려 있어서, 이 항목에 학생이 이미 올린 인증
    기록·사진이 있었다면 그것도 같이 지워진다 — 항목 자체가 없어지는
    것이므로 자연스러운 동작이다(save_assignment()에서 항목이 빠질 때와
    동일한 동작).
    """
    ensure_hw_tables()
    conn = get_conn()
    conn.execute("DELETE FROM hw_items WHERE id = ?", (item_id,))
    conn.commit()
    conn.close()


# ═══════════════════════════════════════════════════════════════
# 저장
# ═══════════════════════════════════════════════════════════════


def save_assignment(
    *,
    assignment_id: int | None,
    class_id: int | None,
    title: str,
    assigned_date: str,
    due_date: str,
    created_by: int | None,
    student_ids: list[int],
    items: list[dict],
    no_cert_student_ids: set[int] | frozenset[int] = frozenset(),
) -> tuple[int, bool]:
    """과제를 저장한다.

    assignment_id가 주어지면(=같은 반·같은 날짜에 이미 과제가 있으면) 그 과제를
    수정한다 — 선택에서 빠진 학생은 대상·제출현황에서 제거한다.
    assignment_id가 없으면 새로 만든다.

    항목(item_type + material_name이 같은 것)은 지우고 다시 만들지 않고
    그 자리에서 업데이트한다. **중요**: 예전엔 항목을 통째로 지우고 다시
    만들었는데, hw_item_submissions가 item_id를 FK로 물고 있어서(ON DELETE
    CASCADE) 항목이 삭제되는 순간 학생이 이미 인증한 페이지·사진 기록까지
    같이 삭제돼버리는 버그가 있었다(실사용 테스트에서 발견 — 학생이 일부
    제출한 뒤 선생님이 항목을 추가/수정하면 그 진행 기록이 통째로 날아갔음).
    이제는 이름이 같은 항목은 그대로 두고 페이지 범위·설명만 갱신하므로
    안전하다. 이름이 아예 바뀌었거나 빠진 항목만 실제로 삭제된다(그 경우엔
    그 항목의 진행 기록도 같이 없어지는 게 맞다 — 항목 자체가 없어졌으니까).

    no_cert_student_ids: student_ids 중 "인증(사진 업로드) 불필요"로 체크된
    학생 — 이 학생들은 hw_assignment_targets에는 남지만(과제를 받았다는
    기록은 유지) hw_submissions(업로드 링크·완료 추적)는 만들지 않는다.
    반환값: (assignment_id, is_new)
    """
    ensure_hw_tables()
    conn = get_conn()
    ts = _now()
    try:
        is_new = assignment_id is None
        if is_new:
            cur = conn.execute(
                """
                INSERT INTO hw_assignments (class_id, title, assigned_date, due_date, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
                """,
                (class_id, title.strip(), assigned_date, due_date, created_by, ts, ts),
            )
            assignment_id = int(cur.fetchone()[0])
        else:
            conn.execute(
                "UPDATE hw_assignments SET title = ?, due_date = ?, updated_at = ? WHERE id = ?",
                (title.strip(), due_date, ts, assignment_id),
            )
            existing_targets = {
                int(r[0])
                for r in conn.execute(
                    "SELECT student_id FROM hw_assignment_targets WHERE assignment_id = ?",
                    (assignment_id,),
                ).fetchall()
            }
            for sid in existing_targets - set(student_ids):
                conn.execute(
                    "DELETE FROM hw_submissions WHERE assignment_id = ? AND student_id = ?",
                    (assignment_id, sid),
                )
                conn.execute(
                    "DELETE FROM hw_assignment_targets WHERE assignment_id = ? AND student_id = ?",
                    (assignment_id, sid),
                )
                # [2026-08-14] 대상에서 빠진 학생의 개별 항목(있었다면)도 같이
                # 정리한다 — 안 지우면 아무도 안 쓰는 항목으로 DB에 계속 남는다.
                conn.execute(
                    "DELETE FROM hw_items WHERE assignment_id = ? AND student_id = ?",
                    (assignment_id, sid),
                )
        for sid in student_ids:
            requires_cert = sid not in no_cert_student_ids
            conn.execute(
                """
                INSERT INTO hw_assignment_targets (assignment_id, student_id, requires_certification)
                VALUES (?, ?, ?)
                ON CONFLICT (assignment_id, student_id)
                DO UPDATE SET requires_certification = EXCLUDED.requires_certification
                """,
                (assignment_id, sid, requires_cert),
            )
            if requires_cert:
                conn.execute(
                    """
                    INSERT INTO hw_submissions (assignment_id, student_id, upload_token, status, created_at)
                    VALUES (?, ?, ?, 'pending', ?)
                    ON CONFLICT (assignment_id, student_id) DO NOTHING
                    """,
                    (assignment_id, sid, _new_token(), ts),
                )

        # (item_type, material_name)이 같은 기존 항목은 업데이트해서 id를
        # 유지하고 — id가 유지돼야 hw_item_submissions(학생이 인증한 페이지)가
        # 안 끊긴다.
        # [2026-08-14 중요] 반드시 student_id IS NULL(공통 항목)로만 범위를
        # 좁혀야 한다 — 이 함수는 공통 항목만 다루는데, 범위를 안 좁히면
        # 특정 학생의 개별 항목(save_individual_items로 저장된 것)까지 같이
        # 조회돼서, 아래 "새 목록에 없는 기존 항목 삭제" 단계에서 개별
        # 항목이 매번 공통 과제 저장 때마다 통째로 지워지는 심각한 버그가
        # 생긴다.
        # [2026-08-15 버그 수정] 같은 문제집 이름이 페이지 범위만 다르게
        # 두 번 이상 등록되는 건 정상적인 사용(예: "기본정석 74쪽" +
        # "기본정석 78~81쪽"을 별개 항목 2개로 등록)인데, 예전 코드는
        # (item_type, material_name)당 id를 "하나만" 딕셔너리에 담을 수
        # 있어서 두 번째 이후 항목의 기존 id를 잃어버렸다. 그러면 저장할
        # 때마다 잃어버린 항목은 그대로 안 지워지고 남아있는 채로 새 항목이
        # 하나씩 더 생겨서, 저장을 반복할수록 같은 항목이 계속 늘어나는
        # 버그가 있었다(실사용에서 발견). 이제는 이름이 같은 기존 항목들을
        # 리스트로 다 모아두고, 새로 들어온 항목 순서대로 하나씩 꺼내
        # 매칭한다 — 그러면 몇 개가 겹치든 정확히 1:1로 짝지어지고, 새
        # 목록에 없는 나머지(진짜 중복)만 정리(삭제)된다.
        existing_items: dict[tuple[str, str], list[int]] = {}
        for r in conn.execute(
            "SELECT id, item_type, material_name FROM hw_items "
            "WHERE assignment_id = ? AND student_id IS NULL "
            "ORDER BY sort_order, id",
            (assignment_id,),
        ).fetchall():
            existing_items.setdefault((r[1], r[2]), []).append(int(r[0]))

        matched_ids: set[int] = set()
        for idx, item in enumerate(items):
            name = item["material_name"].strip()
            bucket = existing_items.get((item["item_type"], name))
            existing_id = bucket.pop(0) if bucket else None
            if existing_id is not None:
                matched_ids.add(existing_id)
                conn.execute(
                    """
                    UPDATE hw_items
                    SET page_start = ?, page_end = ?, description = ?, sort_order = ?
                    WHERE id = ?
                    """,
                    (
                        item.get("page_start"),
                        item.get("page_end"),
                        item.get("description", "").strip(),
                        idx,
                        existing_id,
                    ),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO hw_items
                        (assignment_id, item_type, material_name, page_start, page_end, description, sort_order, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        assignment_id,
                        item["item_type"],
                        name,
                        item.get("page_start"),
                        item.get("page_end"),
                        item.get("description", "").strip(),
                        idx,
                        ts,
                    ),
                )

        # 새 목록에서 매칭이 안 되고 남은 기존 항목(이름이 바뀌었거나 진짜로
        # 빠진 것, 또는 예전 버그로 쌓인 중복)은 여기서 정리(삭제)된다.
        # 이 경우엔 그 항목에 딸린 학생 인증 기록도 같이 없어지는 게 맞다 —
        # 항목 자체가 더 이상 존재하지 않으니까.
        for _key, ids in existing_items.items():
            for eid in ids:
                if eid not in matched_ids:
                    conn.execute("DELETE FROM hw_items WHERE id = ?", (eid,))

        conn.commit()

        # 출석부 "전 수업 과제" 자동 연동 — 과제를 등록/수정하면 출석부의
        # "오늘 과제" 메모칸에도 항목 요약이 자동으로 채워진다. homework.py는
        # 완전히 별도 모듈이라 여기서 손대지 않고 기존 함수만 호출한다.
        # 이 연동이 실패해도 과제 저장 자체(위 commit)는 이미 끝난 상태를
        # 유지하도록 예외를 감싼다.
        if class_id is not None:
            try:
                homework.save_class_homework(
                    class_id, assigned_date, _build_class_homework_summary(items)
                )
            except Exception as exc:  # noqa: BLE001
                st.warning(f"⚠️ 출석부 연동에 실패했습니다(과제 저장은 정상 완료됨): {exc}")

        return assignment_id, is_new
    finally:
        conn.close()


def save_individual_items(
    *,
    assignment_id: int,
    student_id: int,
    items: list[dict],
    include_common: bool,
) -> None:
    """[개별 과제 부여, 2026-08-14] 이 학생 한 명에게만 해당하는 개별 항목을
    저장하고, "공통 항목도 같이 인증할지" 여부를 hw_assignment_targets에
    기록한다.

    save_assignment()과 똑같은 이유로, 이름이 같은 기존 개별 항목은 지우고
    다시 만들지 않고 그 자리에서 업데이트한다 — hw_item_submissions가
    item_id를 참조하고 있어서, 항목을 삭제하면 학생이 이미 인증한 기록도
    같이 사라지기 때문이다. 다른 학생의 개별 항목이나 공통 항목(student_id
    IS NULL)은 이 함수가 절대 건드리지 않는다 — WHERE 절에 항상
    student_id = %s를 명시해서 범위를 이 학생으로만 한정한다.

    [2026-08-14 변경] 예전엔 이 학생이 hw_assignment_targets에 이미 있어야만
    (=공통 과제를 먼저 저장해야만) 동작했는데, "공통 과제가 없는 날도 있다"는
    요청으로 이제는 대상이 없으면 여기서 직접 등록한다(업로드 토큰 발급까지
    포함) — 공통 과제를 저장하지 않고 개별 과제만 먼저 저장해도 된다.
    """
    ensure_hw_tables()
    conn = get_conn()
    ts = _now()
    try:
        conn.execute(
            """
            INSERT INTO hw_assignment_targets (assignment_id, student_id, requires_certification, include_common)
            VALUES (?, ?, TRUE, ?)
            ON CONFLICT (assignment_id, student_id)
            DO UPDATE SET include_common = EXCLUDED.include_common
            """,
            (assignment_id, student_id, include_common),
        )
        conn.execute(
            """
            INSERT INTO hw_submissions (assignment_id, student_id, upload_token, status, created_at)
            VALUES (?, ?, ?, 'pending', ?)
            ON CONFLICT (assignment_id, student_id) DO NOTHING
            """,
            (assignment_id, student_id, _new_token(), ts),
        )

        # [2026-08-15 버그 수정] save_assignment()와 같은 이유로, 같은
        # 문제집 이름이 페이지 범위만 다르게 두 번 이상 등록될 수 있으므로
        # id를 리스트로 모아뒀다가 입력 순서대로 하나씩 매칭한다(자세한
        # 설명은 save_assignment()의 주석 참고).
        existing_items: dict[tuple[str, str], list[int]] = {}
        for r in conn.execute(
            "SELECT id, item_type, material_name FROM hw_items "
            "WHERE assignment_id = ? AND student_id = ? "
            "ORDER BY sort_order, id",
            (assignment_id, student_id),
        ).fetchall():
            existing_items.setdefault((r[1], r[2]), []).append(int(r[0]))

        matched_ids: set[int] = set()
        for idx, item in enumerate(items):
            name = item["material_name"].strip()
            bucket = existing_items.get((item["item_type"], name))
            existing_id = bucket.pop(0) if bucket else None
            if existing_id is not None:
                matched_ids.add(existing_id)
                conn.execute(
                    """
                    UPDATE hw_items
                    SET page_start = ?, page_end = ?, description = ?, sort_order = ?
                    WHERE id = ?
                    """,
                    (
                        item.get("page_start"),
                        item.get("page_end"),
                        item.get("description", "").strip(),
                        idx,
                        existing_id,
                    ),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO hw_items
                        (assignment_id, item_type, material_name, page_start, page_end,
                         description, sort_order, created_at, student_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        assignment_id,
                        item["item_type"],
                        name,
                        item.get("page_start"),
                        item.get("page_end"),
                        item.get("description", "").strip(),
                        idx,
                        ts,
                        student_id,
                    ),
                )

        # 새 목록에 더는 없는 이 학생의 기존 개별 항목만 삭제(다른 학생·공통
        # 항목은 WHERE의 student_id = ? 조건 덕분에 애초에 조회 대상이 아님).
        for _key, ids in existing_items.items():
            for eid in ids:
                if eid not in matched_ids:
                    conn.execute("DELETE FROM hw_items WHERE id = ?", (eid,))

        conn.commit()
    finally:
        conn.close()


def _get_or_create_assignment_shell(
    *, class_id: int, assigned_date: str, title: str, due_date: str, created_by: int | None
) -> int:
    """[개별 과제 부여, 2026-08-14] 공통 과제를 아직 저장하지 않은 채로
    개별 과제부터 저장하려는 경우를 위해, hw_assignments 행이 없으면
    만들어서 id를 돌려준다.

    이미 그 반·날짜에 과제가 있으면(공통이든 개별이든 한 번이라도 저장된
    적 있으면) 그 id를 그대로 쓰고 아무 것도 바꾸지 않는다 — 제목·기한
    갱신은 공통 저장 버튼의 책임으로 남겨둔다(여기서 같이 덮어쓰면 "개별만
    저장"했는데 공통 쪽 제목이 의도치 않게 바뀔 수 있어서).
    """
    existing = get_assignment_for_class_date(class_id, assigned_date)
    if existing:
        return int(existing["id"])
    ensure_hw_tables()
    conn = get_conn()
    ts = _now()
    try:
        cur = conn.execute(
            """
            INSERT INTO hw_assignments (class_id, title, assigned_date, due_date, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
            """,
            (class_id, title.strip() or f"{assigned_date} 숙제", assigned_date, due_date, created_by, ts, ts),
        )
        new_id = int(cur.fetchone()[0])
        conn.commit()
        return new_id
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════
# Streamlit UI
# ═══════════════════════════════════════════════════════════════


def _render_item_rows(
    key_ctx: str, item_count: int, existing_items_df: pd.DataFrame
) -> list[dict]:
    """문제집/프린트 항목 입력칸 여러 개를 그리고, 입력된 값들을 리스트로
    반환한다. 공통 항목 입력(반 전체 대상)과 개별 항목 입력(학생 1명 전용,
    2026-08-14 추가) 양쪽에서 재사용한다 — key_ctx만 서로 다르게 주면
    위젯 key가 겹치지 않는다.
    """
    item_inputs: list[dict] = []
    for i in range(item_count):
        prev = (
            existing_items_df.iloc[i]
            if i < len(existing_items_df)
            else None
        )
        with st.container(border=True):
            ic1, ic2 = st.columns([2, 1])
            with ic1:
                material_name = st.text_input(
                    f"항목 {i + 1} — 문제집/프린트 이름",
                    value=str(prev["material_name"]) if prev is not None else "",
                    key=f"hw_item_name_{key_ctx}_{i}",
                    placeholder="예: 쎈 수학(상)",
                )
            with ic2:
                default_type_idx = 0
                if prev is not None and prev["item_type"] == "wrong_note":
                    default_type_idx = 1
                item_type_label = st.radio(
                    "유형",
                    list(_ITEM_TYPE_LABELS.values()),
                    index=default_type_idx,
                    key=f"hw_item_type_{key_ctx}_{i}",
                    horizontal=True,
                )
            item_type = (
                "page_range" if item_type_label == "페이지 범위형" else "wrong_note"
            )

            pc1, pc2 = st.columns(2)
            if item_type == "page_range":
                ps_label, pe_label = "시작 페이지", "끝 페이지"
                desc_label, desc_ph = "추가 설명 (선택)", "예: 홀수 번호만"
            else:
                ps_label, pe_label = "시작 페이지 (선택)", "끝 페이지 (선택)"
                desc_label, desc_ph = "오답정리 대상", "예: 8/1 단원평가 오답정리"

            prev_ps = int(prev["page_start"]) if prev is not None and pd.notna(prev["page_start"]) else 0
            prev_pe = int(prev["page_end"]) if prev is not None and pd.notna(prev["page_end"]) else 0
            prev_desc = str(prev["description"]) if prev is not None and pd.notna(prev["description"]) else ""

            with pc1:
                page_start = st.number_input(
                    ps_label, min_value=0, step=1, value=prev_ps, key=f"hw_item_ps_{key_ctx}_{i}"
                )
            with pc2:
                page_end = st.number_input(
                    pe_label, min_value=0, step=1, value=prev_pe, key=f"hw_item_pe_{key_ctx}_{i}"
                )
            description = st.text_input(
                desc_label, value=prev_desc, key=f"hw_item_desc_{key_ctx}_{i}", placeholder=desc_ph
            )
            item_inputs.append(
                {
                    "item_type": item_type,
                    "material_name": material_name,
                    "page_start": int(page_start) or None,
                    "page_end": int(page_end) or None,
                    "description": description,
                }
            )
    return item_inputs


def render_incomplete_students_section(class_id: int) -> None:
    """"미완료 학생" 명단 — 이름을 누르면 그 학생이 아직 다 못한 과제들을
    날짜·기한·상태와 함께, 항목별로 몇 쪽이 남았는지까지 펼쳐서 보여준다.

    다음 수업 때 이걸 보고 추가로 뭘 더 내줄지 판단하는 용도. 완료된 과제는
    여기 안 뜬다 — 새 수업일이 오면 새 과제가 또 나갈 테니, 지난 과제 완료
    이력까지 계속 보여줄 필요는 없다는 판단.
    """
    st.markdown("#### 미완료 학생")
    incomplete_df = get_incomplete_students(class_id)
    if incomplete_df.empty:
        st.caption("현재 미완료 과제가 있는 학생이 없습니다.")
        return

    st.caption(f"{len(incomplete_df)}명 — 이름을 눌러 어떤 과제를 얼마나 안 했는지 확인하세요.")
    for _, srow in incomplete_df.iterrows():
        sid = int(srow["student_id"])
        with st.expander(f"🔴 {srow['student_name']}"):
            hist_df = get_student_assignment_history(sid, class_id=class_id)
            incomplete_hist = hist_df[hist_df["status"] != "done"]
            if incomplete_hist.empty:
                st.caption("미완료 과제가 없습니다.")
                continue

            for _, hrow in incomplete_hist.iterrows():
                due_txt = f" · 기한 {hrow['due_date']}" if hrow["due_date"] else ""
                status_label = compute_display_status(
                    status=hrow["status"], viewed_at=hrow["viewed_at"], due_date=hrow["due_date"]
                )
                st.markdown(f"**{hrow['assigned_date']} · {hrow['title']}**{due_txt} — {status_label}")

                item_states_df = get_items_with_state(
                    int(hrow["assignment_id"]), int(hrow["submission_id"])
                )
                for _, irow in item_states_df.iterrows():
                    has_pages = (
                        irow["item_type"] == "page_range"
                        and pd.notna(irow["page_start"])
                        and pd.notna(irow["page_end"])
                    )
                    if has_pages:
                        page_start, page_end = int(irow["page_start"]), int(irow["page_end"])
                        total_pages = page_end - page_start + 1
                        full_range = set(range(page_start, page_end + 1))
                        completed = parse_completed_pages(irow["completed_pages"])
                        done_pages = completed & full_range
                        remaining = sorted(full_range - completed)
                        frac = (len(done_pages) / total_pages) if total_pages > 0 else 0.0
                        # "~"를 그대로 쓰면 마크다운이 취소선으로 오해해서 물결표가
                        # 사라지고 숫자가 붙어 보이는 버그가 있었다(예: "1~2쪽"이
                        # "12쪽"처럼 보임) — "\~"로 이스케이프해서 방지.
                        label = f"{irow['material_name']} ({page_start}\\~{page_end}쪽)"
                        if remaining:
                            st.caption(
                                f"　· {label} — :orange[{len(done_pages)}/{total_pages}쪽] · "
                                f"남은 페이지: :red[{format_page_ranges(remaining)}]"
                            )
                        else:
                            st.caption(f"　· {label} — :green[완료]")
                        st.progress(frac)
                    else:
                        if irow["sub_status"] == "done":
                            st.caption(f"　· {irow['material_name']} — :green[완료]")
                        else:
                            st.caption(f"　· {irow['material_name']} — :red[미완료]")
            st.divider()


def render_hw_assign_page(classes_df: pd.DataFrame, teacher_id: int | None) -> None:
    ensure_hw_tables()

    st.markdown("### 과제 부여")
    st.caption(
        "반을 고르고 학생과 문제집/프린트 항목을 등록하면, 학생별 제출 현황이 자동으로 만들어집니다. "
        "(학생 업로드 화면·자동 알림은 다음 단계에서 연결됩니다)"
    )

    if classes_df.empty:
        st.info("등록된 수업이 없습니다. 먼저 '내 수업 관리'에서 수업을 만들어 주세요.")
        return

    class_opts = {row["name"]: int(row["id"]) for _, row in classes_df.iterrows()}
    sel_cls_name = st.selectbox("반 선택", list(class_opts.keys()), key="hw_assign_class")
    sel_cls_id = class_opts[sel_cls_name]

    # [2026-08-13 추가] 문제집/프린트 PDF를 미리 올려두면, 학생 사진 속 페이지
    # 번호를 AI가 손글씨로 읽는 대신 실제 페이지 이미지와 직접 비교해서 찾는다
    # (더 정확함). 등록 안 해도 기존 방식 그대로 동작하는 선택 기능이다.
    render_reference_upload_section(sel_cls_id)

    students_df = get_students_by_class(sel_cls_id)
    if students_df.empty:
        st.warning("이 반에 등록된 학생이 없습니다.")
        return

    # 부여일도 폼 밖에 둔다 — 날짜를 바꾸는 순간 "이 반·이 날짜에 이미 과제가
    # 있는지" 바로 조회해서 폼에 미리 채워줘야 하기 때문 (폼 안에서는 즉시
    # 리렌더가 안 됨).
    assigned_d = st.date_input("부여일", value=date.today(), key="hw_assign_date")
    assigned_date_str = assigned_d.strftime("%Y-%m-%d")

    existing = get_assignment_for_class_date(sel_cls_id, assigned_date_str)
    editing_id = existing["id"] if existing else None
    # 반·날짜 조합마다 고유한 위젯 key를 써서, 반/날짜를 바꾸면 자동으로
    # 그 조합에 저장된 값(또는 빈 값)이 뜨게 한다. → 같은 날짜에 여러 번
    # 저장해도 "새 과제"가 아니라 "그 과제 수정"이 된다.
    ctx = f"{sel_cls_id}_{assigned_date_str}"

    if existing:
        st.info(
            f"📌 이 반은 {assigned_date_str}에 이미 '{existing['title']}' 과제가 있습니다. "
            "그대로 저장하면 새로 만들지 않고 이 과제를 수정합니다."
        )
        # [2026-08-14] get_items_for_assignment()는 이제 공통+개별 항목을
        # 다 같이 반환한다(최근 부여한 과제 표시용) — 이 편집 폼에는 공통
        # 항목(student_id가 비어있는 것)만 채워야 한다. 개별 항목은 이
        # 폼이 아니라 아래 "개별 과제 부여" 섹션에서 학생별로 따로 편집한다.
        _all_items_df = get_items_for_assignment(existing["id"])
        existing_items_df = _all_items_df[
            _all_items_df["student_id"].isna()
        ].reset_index(drop=True)
        default_target_ids = set(get_target_student_ids(existing["id"]))
        default_no_cert_ids = set(get_no_certification_student_ids(existing["id"]))
    else:
        existing_items_df = pd.DataFrame()
        default_target_ids = set(int(x) for x in students_df["id"])  # 기본: 반 전체
        default_no_cert_ids = set()

    # ── 받을 학생 선택 (폼 밖) ─────────────────────────────────────────
    # [2026-08-14 변경] 예전엔 이 선택이 "공통 과제 저장 폼" 안에 있어서,
    # 폼을 실제로 저장하기 전까진 값이 확정되지 않았다(Streamlit 폼은
    # 제출 전까지 즉시 반영이 안 됨). 그런데 아래 "개별 과제 부여" 섹션이
    # 이제 이 학생 목록을 그 자리에서 바로 써야 해서(공통 과제를 저장하지
    # 않아도 개별 항목만 먼저 등록할 수 있게 하려고) 폼 밖으로 옮겼다 —
    # 부여일(assigned_d)과 같은 이유.
    st.markdown("**받을 학생 선택**")
    student_names = list(students_df["name"])
    id_to_name = {int(r["id"]): r["name"] for _, r in students_df.iterrows()}
    name_to_id = {r["name"]: int(r["id"]) for _, r in students_df.iterrows()}
    default_names = [id_to_name[sid] for sid in default_target_ids if sid in id_to_name]
    sel_student_names = st.multiselect(
        "학생",
        student_names,
        default=default_names,
        key=f"hw_assign_students_{ctx}",
        label_visibility="collapsed",
    )
    student_ids = [name_to_id[n] for n in sel_student_names]

    no_cert_default_names = [
        id_to_name[sid]
        for sid in default_no_cert_ids
        if sid in id_to_name and id_to_name[sid] in sel_student_names
    ]
    no_cert_names = st.multiselect(
        "이 중 인증(사진 업로드) 불필요한 학생 (선택)",
        sel_student_names,
        default=no_cert_default_names,
        key=f"hw_assign_nocert_{ctx}",
        help="체크한 학생은 과제는 받지만 업로드 링크·완료 추적 없이 진행됩니다.",
    )
    no_cert_ids = {name_to_id[n] for n in no_cert_names if n in name_to_id} & set(student_ids)

    st.divider()
    st.markdown("#### 공통 과제 (반 전체)")
    st.caption(
        "반 전체에게 공통으로 나갈 문제집/프린트입니다. "
        "[2026-08-14] 항목 없이 학생만 등록해도 저장할 수 있어요 — "
        "그날 개별 과제만 내줄 때는 아래 항목을 0개로 두고 저장하면 됩니다."
    )

    # +/- 버튼은 폼 밖에 있어야 클릭 즉시 반영된다(Streamlit 폼 제약: 폼
    # 안에서는 form_submit_button 전까지 리렌더가 안 됨). 대신 버튼을
    # "문제집 / 프린트 항목" 줄의 오른쪽에 나란히 두고, 실제 입력칸은 바로
    # 아래 폼에서 그린다 — 사용자 입장에서는 한 줄로 이어져 보인다.
    item_count_key = f"hw_assign_item_count_{ctx}"
    if item_count_key not in st.session_state:
        st.session_state[item_count_key] = len(existing_items_df)

    head_col, add_col, remove_col = st.columns([3, 1, 1])
    with head_col:
        st.markdown("**문제집 / 프린트 항목**")
    with add_col:
        if st.button("+ 항목 추가", key=f"hw_assign_item_add_{ctx}", width="stretch"):
            st.session_state[item_count_key] += 1
    with remove_col:
        if st.button("- 항목 제거", key=f"hw_assign_item_remove_{ctx}", width="stretch"):
            st.session_state[item_count_key] = max(0, st.session_state[item_count_key] - 1)

    item_count = st.session_state[item_count_key]

    with st.form(f"hw_assign_form_{ctx}"):
        default_title = existing["title"] if existing else f"{assigned_d.month}/{assigned_d.day} 숙제"
        title = st.text_input(
            "과제 이름", value=default_title, key=f"hw_assign_title_{ctx}"
        )
        due_default = None
        if existing and existing["due_date"]:
            try:
                due_default = datetime.strptime(existing["due_date"], "%Y-%m-%d").date()
            except ValueError:
                due_default = None
        due_d = st.date_input(
            "제출 기한 (선택)", value=due_default, key=f"hw_assign_due_{ctx}"
        )

        if item_count == 0:
            st.caption("공통 항목이 없습니다. 이대로 저장하면 '개별 과제만' 부여하는 과제가 됩니다.")
        item_inputs = _render_item_rows(ctx, item_count, existing_items_df)

        save_label = "과제 수정 저장" if existing else "과제 저장"
        save_btn = st.form_submit_button(save_label, width="stretch", type="primary")

    if save_btn:
        if not title.strip():
            st.error("과제 이름을 입력해주세요.")
            return
        if not sel_student_names:
            st.error("학생을 최소 1명 선택해주세요.")
            return
        valid_items = [it for it in item_inputs if it["material_name"].strip()]
        # [2026-08-14] 공통 항목 0개도 허용 — "가끔은 공통과제가 없을 때도
        # 있다"는 요청으로, 학생 등록만 하고 항목은 비워둔 채 저장할 수 있다
        # (그 학생들에게는 아래 개별 과제로만 내주면 됨).

        _assignment_id, is_new = save_assignment(
            assignment_id=editing_id,
            class_id=sel_cls_id,
            title=title,
            assigned_date=assigned_date_str,
            due_date=due_d.strftime("%Y-%m-%d") if due_d else "",
            created_by=teacher_id,
            student_ids=student_ids,
            items=valid_items,
            no_cert_student_ids=no_cert_ids,
        )
        msg = "새 과제가 저장되었습니다!" if is_new else "과제가 수정되었습니다!"
        item_txt = f"항목 {len(valid_items)}개" if valid_items else "공통 항목 없음(개별 과제만)"
        st.success(f"{msg} (학생 {len(student_ids)}명, {item_txt})")
        st.rerun()

    # ── [2026-08-14 추가/개편] 개별 과제 부여 ──────────────────────────
    # 원칙은 위의 통합부여(반 전체 공통 과제)이고, 이 섹션은 특정 학생
    # 한 명에게만 항목을 추가로(또는 공통 대신) 얹는 선택 기능이다.
    #   - 개별 항목이 있고 "공통 과제도 포함" 체크가 켜져 있으면(기본값)
    #     → 공통 항목 + 개별 항목 둘 다 인증
    #   - 개별 항목이 있는데 체크를 끄면 → 개별 항목만 인증(공통 과제 제외)
    #   - 개별 항목을 아예 안 만들면 → 공통 항목만 인증(변화 없음)
    # [2026-08-14 개편] 예전엔 공통 과제를 먼저 저장해야만(existing이 있어야)
    # 이 섹션이 나타났는데, "공통 과제 없는 날도 있다"는 요청으로 이제는
    # 위에서 학생을 고르는 순간 바로 학생별로 펼쳐서 쓸 수 있다 — 위 공통
    # 폼을 저장하지 않아도 된다(저장 시점에 필요하면 과제 뼈대를 알아서
    # 만든다. _get_or_create_assignment_shell 참고).
    st.divider()
    st.markdown("#### 개별 과제 부여 (선택)")
    st.caption(
        "특정 학생에게만 문제집/프린트를 추가로(또는 공통 대신) 내줄 때 씁니다. "
        "학생 이름을 눌러 펼치면 그 학생만의 항목을 등록할 수 있어요 — "
        "위 공통 과제를 먼저 저장하지 않아도 바로 쓸 수 있습니다."
    )

    if not student_ids:
        st.caption("위에서 먼저 학생을 선택해주세요.")
    else:
        for sid in student_ids:
            sname = id_to_name[sid]
            indiv_ctx = f"{ctx}_indiv_{sid}"
            with st.expander(f"👤 {sname}"):
                indiv_existing_df = get_individual_items(editing_id, sid)
                indiv_count_key = f"hw_indiv_item_count_{indiv_ctx}"
                if indiv_count_key not in st.session_state:
                    st.session_state[indiv_count_key] = len(indiv_existing_df)

                ic_head, ic_add, ic_remove = st.columns([3, 1, 1])
                with ic_head:
                    st.markdown("**개별 문제집 / 프린트 항목**")
                with ic_add:
                    if st.button("+ 항목 추가", key=f"hw_indiv_item_add_{indiv_ctx}", width="stretch"):
                        st.session_state[indiv_count_key] += 1
                with ic_remove:
                    if st.button("- 항목 제거", key=f"hw_indiv_item_remove_{indiv_ctx}", width="stretch"):
                        st.session_state[indiv_count_key] = max(0, st.session_state[indiv_count_key] - 1)

                indiv_item_count = st.session_state[indiv_count_key]

                with st.form(f"hw_indiv_form_{indiv_ctx}"):
                    include_common_default = get_include_common(editing_id, sid)
                    include_common_val = st.checkbox(
                        f"공통 과제도 함께 인증 ({sname} 학생)",
                        value=include_common_default,
                        key=f"hw_indiv_include_common_{indiv_ctx}",
                        help="꺼두면 이 학생은 공통 항목은 빼고 아래 개별 항목만 인증하면 됩니다.",
                    )
                    if indiv_item_count == 0:
                        st.caption("아직 개별 항목이 없습니다. '+ 항목 추가'를 눌러 추가해주세요.")
                    indiv_item_inputs = _render_item_rows(indiv_ctx, indiv_item_count, indiv_existing_df)
                    indiv_save_btn = st.form_submit_button(
                        f"{sname} 학생 개별 과제 저장", width="stretch"
                    )

                if indiv_save_btn:
                    valid_indiv_items = [
                        it for it in indiv_item_inputs if it["material_name"].strip()
                    ]
                    shell_id = editing_id or _get_or_create_assignment_shell(
                        class_id=sel_cls_id,
                        assigned_date=assigned_date_str,
                        title=title,
                        due_date=due_d.strftime("%Y-%m-%d") if due_d else "",
                        created_by=teacher_id,
                    )
                    save_individual_items(
                        assignment_id=shell_id,
                        student_id=sid,
                        items=valid_indiv_items,
                        include_common=include_common_val,
                    )
                    if valid_indiv_items:
                        st.success(
                            f"{sname} 학생 개별 과제 저장 완료 "
                            f"(항목 {len(valid_indiv_items)}개, "
                            f"공통 과제 {'포함' if include_common_val else '제외'})"
                        )
                    else:
                        st.success(f"{sname} 학생 개별 과제를 모두 지웠습니다.")
                    st.rerun()

    st.divider()
    render_incomplete_students_section(sel_cls_id)

    st.divider()
    st.markdown("#### 최근 부여한 과제")
    recent_df = get_recent_assignments(class_id=sel_cls_id)
    if recent_df.empty:
        st.caption("아직 이 반에 부여한 과제가 없습니다.")
        return

    for _, row in recent_df.iterrows():
        due_txt = f" · 기한 {row['due_date']}" if row["due_date"] else ""
        with st.expander(
            f"{row['assigned_date']} · {row['title']} — 학생 {row['student_count']}명, "
            f"항목 {row['item_count']}개{due_txt}"
        ):
            items_df = get_items_for_assignment(int(row["id"]))
            if items_df.empty:
                st.caption("항목 없음")
            else:
                disp = items_df.copy()
                disp["item_type"] = disp["item_type"].map(_ITEM_TYPE_LABELS)
                # [2026-08-14] 대상 열 추가 — 공통 항목(student_id 없음)은
                # "공통", 개별 항목은 그 학생 이름을 보여준다.
                disp["대상"] = disp["student_name"].apply(lambda v: v if pd.notna(v) else "공통")
                disp = disp[["item_type", "material_name", "page_start", "page_end", "description", "대상"]]
                disp.columns = ["유형", "문제집/프린트", "시작p", "끝p", "설명", "대상"]
                st.dataframe(disp, width="stretch", hide_index=True)

                # [2026-08-15 추가] 항목을 하나씩 골라서 삭제할 수 있는 기능 —
                # 잘못 중복 등록된 항목을 지우거나, 특정 학생의 개별 항목
                # 하나만 취소하고 싶을 때 과제 전체를 안 지우고 그 항목만
                # 지운다. 이미 학생이 그 항목에 올린 인증 사진이 있으면 그
                # 기록도 같이 지워진다는 걸 미리 알려준다.
                st.caption("항목별로 삭제하려면 아래에서 골라 지우세요.")
                for _, item_row in items_df.iterrows():
                    iid = int(item_row["item_id"])
                    type_label = _ITEM_TYPE_LABELS.get(item_row["item_type"], item_row["item_type"])
                    target_label = (
                        item_row["student_name"] if pd.notna(item_row["student_name"]) else "공통"
                    )
                    if pd.notna(item_row["page_start"]) and pd.notna(item_row["page_end"]):
                        page_txt = f" ({int(item_row['page_start'])}~{int(item_row['page_end'])}쪽)"
                    else:
                        page_txt = ""
                    desc_txt = f" · {item_row['description']}" if item_row.get("description") else ""

                    dc1, dc2 = st.columns([5, 1])
                    with dc1:
                        st.caption(
                            f"[{target_label}] {type_label} · {item_row['material_name']}"
                            f"{page_txt}{desc_txt}"
                        )
                    with dc2:
                        if st.button("삭제", key=f"hw_item_del_{iid}", width="stretch"):
                            delete_hw_item(iid)
                            st.success("항목을 삭제했습니다.")
                            st.rerun()

            subs_df = get_submissions_for_assignment(int(row["id"]))
            if not subs_df.empty:
                st.markdown("**학생별 업로드 링크**")
                for _, srow in subs_df.iterrows():
                    link = f"{HW_UPLOAD_BASE_URL}/?hw={srow['upload_token']}"
                    status_label = compute_display_status(
                        status=srow["status"], viewed_at=srow["viewed_at"], due_date=row["due_date"]
                    )
                    notified_txt = " · 📨 오늘 문자 발송함" if was_notified_today(srow.get("notified_at")) else ""
                    st.caption(f"{srow['student_name']} — {status_label}{notified_txt}")
                    st.code(link, language=None)

                    # [2026-08-13] 업로드 링크 자체를 문자로 보내는 버튼.
                    # 기존 "완료/미완료 문자 발송"과는 다른 문구(요약 아님, 링크 포함).
                    # [2026-08-15 버그 수정] 버튼 문구는 "학생에게 발송"인데
                    # 실제로는 항상 parent_phone(보호자 번호)으로만 나가고
                    # 있었다 — 업로드는 학생이 직접 하는 거라 학생 번호로
                    # 가는 게 맞는데, 학생 본인에게 안 가고 보호자에게 가서
                    # 혼선이 있었다(실사용에서 발견). 이제는 학생 연락처
                    # (student_phone)가 등록돼 있으면 그쪽으로 보내고, 없으면
                    # 보호자 번호로 대신 보내되 버튼 문구에 그 사실을
                    # 명시해서 어디로 가는지 헷갈리지 않게 한다.
                    _stu_phone = (srow.get("student_phone") or "").strip()
                    _parent_phone = (srow.get("parent_phone") or "").strip()
                    _target_phone = _stu_phone or _parent_phone
                    if _target_phone:
                        _btn_label = (
                            f"📩 {srow['student_name']}에게 업로드 링크 문자 발송"
                            if _stu_phone
                            else f"📩 {srow['student_name']}에게 업로드 링크 문자 발송 (학생 번호 없어 보호자 번호로 발송)"
                        )
                        if st.button(
                            _btn_label,
                            key=f"hw_link_sms_{int(row['id'])}_{int(srow['submission_id'])}",
                        ):
                            from sms_sender import send_text_sms

                            link_text = (
                                f"{SMS_GREETING}\n"
                                f"{srow['student_name']} 학생, {row['assigned_date']} 과제"
                                f"({row['title']}) 업로드 링크입니다.\n{link}"
                            )
                            result = send_text_sms(_target_phone, link_text)
                            if result["success"]:
                                _to_txt = "학생 번호" if _stu_phone else "보호자 번호"
                                st.success(f"✅ {srow['student_name']}에게 링크 문자를 보냈습니다 ({_to_txt}).")
                            else:
                                st.error(f"발송 실패: {result['message']}")
                    else:
                        st.caption("⚠️ 학생·보호자 연락처가 모두 없어 링크 문자를 보낼 수 없습니다.")

                    # [2026-08-11] 제출 사진 확인 — "페이지 수만 맞으면 통과"
                    # 되던 빈틈을 메우려고 추가. AI가 1차로 페이지번호를 읽어
                    # 참고 배지를 붙여주지만, 최종 확인은 선생님이 사진을 직접
                    # 보고 버튼을 눌러야 한다(hw_photo_review.py 참고).
                    # st.expander는 이미 바깥이 expander라 중첩이 안 돼서
                    # (Streamlit 제약) 체크박스로 펼침/접힘을 대신한다.
                    if st.checkbox(
                        f"📷 {srow['student_name']} 제출 사진 보기",
                        key=f"hwphoto_toggle_{int(row['id'])}_{int(srow['submission_id'])}",
                    ):
                        render_photo_review(
                            int(row["id"]), int(srow["submission_id"]), srow["student_name"],
                            class_id=sel_cls_id,
                        )

                # ── [5단계, 2026-08-08] 학부모 문자 발송 ──────────────────
                # 항목별 완료/미완료를 요약한 텍스트를 솔라피 SMS로 보낸다
                # (링크 아님 — 성적표 문자와 다른 문구 형식). 기존 성적표
                # 일괄발송(app.py)과 같은 패턴: 진행률 표시 + 성공/실패 집계 +
                # 연락처 없는 학생은 자동 제외.
                _n_no_phone = sum(1 for _, s in subs_df.iterrows() if not s.get("parent_phone"))
                if _n_no_phone:
                    st.caption(
                        f"⚠️ 연락처가 없는 학생 {_n_no_phone}명은 발송 대상에서 제외됩니다."
                    )
                targets = [s for _, s in subs_df.iterrows() if s.get("parent_phone")]
                if st.button(
                    f"📱 학부모에게 완료/미완료 문자 발송 ({len(targets)}명)",
                    key=f"hw_sms_send_{int(row['id'])}",
                ):
                    from sms_sender import send_text_sms

                    progress = st.progress(0, text="문자 발송 중...")
                    ok_count = 0
                    fail_msgs: list[str] = []
                    pending_review: list[str] = []
                    for i, srow in enumerate(targets):
                        try:
                            # [2026-08-11] 선생님이 아직 확인 안 한 사진이
                            # 있으면 이 학생은 이번 발송에서 건너뛴다 —
                            # "미완료"로 잘못 단정하지 않고 그냥 미발송으로
                            # 둔다(사용자 요청). 검증 끝나면 다음 발송(수동
                            # 다시 누르거나 야간 자동발송)에 포함된다.
                            if has_unverified_photos(int(row["id"]), int(srow["submission_id"])):
                                pending_review.append(srow["student_name"])
                                progress.progress(
                                    (i + 1) / len(targets),
                                    text=f"문자 발송 중... ({i + 1}/{len(targets)}명)",
                                )
                                continue

                            item_states_df = get_items_with_state(
                                int(row["id"]), int(srow["submission_id"])
                            )
                            text, _ = _build_hw_sms_text(
                                student_name=srow["student_name"],
                                assigned_date=row["assigned_date"],
                                title=row["title"],
                                item_states_df=item_states_df,
                            )
                            result = send_text_sms(srow["parent_phone"], text)
                            if result["success"]:
                                ok_count += 1
                                # 오늘 문자를 보냈다고 기록 — 밤 자동발송이 오늘
                                # 이미 보낸 학생에게 또 안 보내도록 참고하는 값.
                                mark_notified(int(srow["submission_id"]))
                            else:
                                fail_msgs.append(f"{srow['student_name']}: {result['message']}")
                        except Exception as e:  # noqa: BLE001
                            fail_msgs.append(f"{srow['student_name']}: {e}")
                        progress.progress(
                            (i + 1) / len(targets), text=f"문자 발송 중... ({i + 1}/{len(targets)}명)"
                        )
                    progress.empty()
                    st.success(f"✅ 문자 발송 완료 — 성공 {ok_count}명 / 대상 {len(targets)}명")
                    if pending_review:
                        st.warning(
                            "⏸️ 선생님 확인 대기 중이라 건너뜀(미완료 아님 — 사진 확인 후 다시 "
                            "발송해주세요): " + ", ".join(pending_review)
                        )
                    for msg in fail_msgs:
                        st.error(msg)

            if st.button("🗑️ 이 과제 삭제", key=f"hw_assign_delete_{int(row['id'])}"):
                delete_assignment(int(row["id"]))
                st.rerun()
