"""abc 과제 인증 — 야간 자동 문자 발송 스크립트 (2026-08-11 추가, 2026-08-14 마감일 트리거 추가).

이 스크립트는 두 가지 방식으로 "내일 문자를 보낼 학생"을 찾는다.

  [트리거 A] 시간표 기반 (기존 방식, 정규반용)
    "내일 학원에 오는 학생"의 학부모에게, 그 학생의 가장 최근 과제가 지금
    얼마나 됐는지(완료/미완료, 몇 쪽 남았는지)를 요약해서 문자로 자동 보낸다.
    예: 수요일에 오는 학생이면 화요일 밤에 발송.
    classes.schedule(JSON, 예: [{"day":"화","start":"17:00","end":"18:30"}])을
    확인해서 "내일 요일"이 포함된 반을 찾고, 그 반 학생들을 대상으로 한다.

  [트리거 B] 마감일 기반 (2026-08-14 추가, 개인과외처럼 시간표가 자주
  바뀌는 경우용)
    수업 시간표가 일정하지 않은 학생(예: 개인과외)은 트리거 A로 잡히지
    않는다. 이런 경우 과제를 낼 때 "마감일"을 지정해두면, 그 마감일이
    내일인 과제를 가진 학생도 자동으로 대상에 포함된다
    (hw_assignments.due_date = 내일 날짜).
    정규반이라도 마감일을 채워두면 이 트리거로도 잡힌다 — 두 트리거는
    서로 배타적이지 않고 합쳐진다(같은 학생이 둘 다에 해당하면 한 번만
    보낸다).

두 트리거로 찾은 학생 목록은 학생 단위로 합쳐진다(중복 제거). 이후 공통
처리는 동일하다:
  1. 오늘 이미 문자를 보낸 적 있는 학생(수동 발송 포함)은 건너뛴다 —
     hw_submissions.notified_at 컬럼으로 판단(hw_assign.was_notified_today()).
  2. 선생님이 아직 확인 안 한 제출 사진이 있으면 이번 밤에는 건너뛴다
     (hw_photo_review.has_unverified_photos()).
  3. 항목별 완료/미완료 문구를 hw_upload.get_items_with_state() +
     hw_assign._build_hw_sms_text()로 만든다("학부모에게 완료/미완료 문자
     발송" 수동 버튼과 완전히 같은 코드 재사용 — 문구가 서로 달라지지 않게).
  4. 문자 발송 후 hw_submissions.notified_at을 기록한다(hw_assign.mark_notified()).
  5. 결과를 화면(콘솔)에 한 줄씩 찍는다 — 작업 스케줄러의 "기록" 탭이나
     리다이렉트한 로그 파일로 나중에 확인 가능.

이 스크립트는 Streamlit 앱과 별개로, GitHub Actions(.github/workflows/
hw_nightly_sms.yml)가 매일 밤 한국시간 22시에 자동으로 실행한다. 로컬에서
수동 실행할 때는 이 폴더의 .env에 DB·SOLAPI 키가 들어있으면 된다.

실행 방법 (CMD에서, 이 파일이 있는 폴더 안에서):
    python send_hw_nightly_sms.py
    python send_hw_nightly_sms.py --dry-run   ← 실제 발송 없이 누구한테 뭘
                                                  보낼지만 미리 확인

주의: 이 스크립트는 .env(또는 GitHub Secrets)의 DATABASE_URL·SOLAPI 키를
그대로 쓴다. 그 값이 운영 값이면 실제 학부모에게 문자가 나가고, dev 값이면
(SOLAPI 키가 비어있는 경우) 안전하게 "발신번호 미설정" 에러만 나고 실제
문자는 안 나간다 — 어느 환경에 연결됐는지는 .env/Secrets 값이 결정한다.
"""

import sys
from datetime import date, timedelta

from dotenv import load_dotenv

load_dotenv()

from database import ensure_hw_tables
from db_connect import get_conn
from hw_assign import _build_hw_sms_text, mark_notified, was_notified_today
from hw_photo_review import has_unverified_photos
from hw_upload import get_items_with_state

_KOR_DAYS = ["월", "화", "수", "목", "금", "토", "일"]

DRY_RUN = "--dry-run" in sys.argv


def _tomorrow_kor_day() -> tuple[str, str]:
    tomorrow = date.today() + timedelta(days=1)
    return tomorrow.strftime("%Y-%m-%d"), _KOR_DAYS[tomorrow.weekday()]


def _classes_meeting_on(day_kr: str) -> list[dict]:
    """schedule JSON에 이 요일이 포함된 반 목록을 반환한다."""
    import json as _json

    conn = get_conn()
    rows = conn.execute("SELECT id, name, schedule FROM classes").fetchall()
    conn.close()

    result = []
    for cid, name, schedule in rows:
        try:
            slots = _json.loads(schedule or "[]")
        except Exception:
            slots = []
        if any(s.get("day") == day_kr for s in slots):
            result.append({"id": int(cid), "name": name})
    return result


def _students_with_phone(class_id: int) -> list[dict]:
    conn = get_conn()
    rows = conn.execute(
        "SELECT id, name, parent_phone FROM students WHERE class_id = ?",
        (class_id,),
    ).fetchall()
    conn.close()
    return [
        {"id": int(r[0]), "name": r[1], "parent_phone": r[2]}
        for r in rows
        if r[2]
    ]


def _students_with_due_tomorrow(target_date: str) -> list[dict]:
    """[트리거 B] 마감일(due_date)이 내일인 과제를 가진 학생 목록을 반환한다.

    시간표(classes.schedule)와 무관하게, hw_assignments.due_date만 보고
    찾는다 — 개인과외처럼 수업 시간이 자주 바뀌어 트리거 A로는 못 잡는
    경우를 위한 보조 트리거. 정규반 과제도 마감일을 채워두면 여기서 잡힌다.
    """
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT a.id AS assignment_id, a.title, a.assigned_date,
               sub.id AS submission_id, sub.notified_at,
               st.id AS student_id, st.name, st.parent_phone,
               c.name AS class_name
        FROM hw_submissions sub
        JOIN hw_assignments a ON a.id = sub.assignment_id
        JOIN students st ON st.id = sub.student_id
        LEFT JOIN classes c ON c.id = a.class_id
        WHERE a.due_date = ?
        """,
        (target_date,),
    ).fetchall()
    conn.close()
    return [
        {
            "assignment_id": int(r[0]),
            "title": r[1],
            "assigned_date": r[2],
            "submission_id": int(r[3]),
            "notified_at": r[4],
            "student_id": int(r[5]),
            "name": r[6],
            "parent_phone": r[7],
            "class_name": r[8] or "개인과외",
        }
        for r in rows
        if r[7]
    ]


def _latest_certifiable_submission(student_id: int) -> dict | None:
    """이 학생의 가장 최근 과제(인증 필요한 것) 제출 상태 1건을 가져온다."""
    conn = get_conn()
    row = conn.execute(
        """
        SELECT s.id AS submission_id, s.notified_at, a.id AS assignment_id,
               a.title, a.assigned_date
        FROM hw_submissions s
        JOIN hw_assignments a ON a.id = s.assignment_id
        WHERE s.student_id = ?
        ORDER BY a.assigned_date DESC, a.id DESC
        LIMIT 1
        """,
        (student_id,),
    ).fetchone()
    conn.close()
    if not row:
        return None
    return {
        "submission_id": int(row[0]),
        "notified_at": row[1],
        "assignment_id": int(row[2]),
        "title": row[3],
        "assigned_date": row[4],
    }


def main() -> None:
    ensure_hw_tables()
    target_date, day_kr = _tomorrow_kor_day()
    print(f"내일({target_date}, {day_kr}요일) 대상을 찾습니다...\n")

    # [트리거 A] 시간표 기반 — student_id -> {class_name, name, parent_phone}
    classes = _classes_meeting_on(day_kr)
    schedule_targets: dict[int, dict] = {}
    for cls in classes:
        for stu in _students_with_phone(cls["id"]):
            schedule_targets[stu["id"]] = {
                "class_name": cls["name"],
                "name": stu["name"],
                "parent_phone": stu["parent_phone"],
            }

    # [트리거 B] 마감일 기반 — student_id -> due_row(구체적 과제 정보 포함)
    due_targets: dict[int, dict] = {
        row["student_id"]: row for row in _students_with_due_tomorrow(target_date)
    }

    all_student_ids = set(schedule_targets) | set(due_targets)

    if not all_student_ids:
        print("내일 수업 있는 반도, 마감일이 내일인 과제도 없습니다. 종료합니다.")
        return

    print(
        f"시간표 기준 대상 반 {len(classes)}개, 마감일 기준 학생 {len(due_targets)}명 "
        f"(중복 제거 후 총 대상 {len(all_student_ids)}명)"
    )
    print()

    sent, skipped_notified, skipped_no_assignment, skipped_unverified, failed = 0, 0, 0, 0, 0

    for sid in all_student_ids:
        due = due_targets.get(sid)
        if due is not None:
            # 마감일 트리거는 어느 과제인지가 이미 정해져 있으니 그대로 쓴다.
            class_name = due["class_name"]
            name = due["name"]
            parent_phone = due["parent_phone"]
            assignment_id = due["assignment_id"]
            submission_id = due["submission_id"]
            notified_at = due["notified_at"]
            title = due["title"]
            assigned_date = due["assigned_date"]
        else:
            info = schedule_targets[sid]
            class_name = info["class_name"]
            name = info["name"]
            parent_phone = info["parent_phone"]
            sub = _latest_certifiable_submission(sid)
            if sub is None:
                skipped_no_assignment += 1
                continue
            assignment_id = sub["assignment_id"]
            submission_id = sub["submission_id"]
            notified_at = sub["notified_at"]
            title = sub["title"]
            assigned_date = sub["assigned_date"]

        if was_notified_today(notified_at):
            print(f"⏭️  {class_name} · {name} — 오늘 이미 발송됨(수동 또는 자동), 건너뜀")
            skipped_notified += 1
            continue
        # [2026-08-11] 선생님이 아직 확인 안 한 제출 사진이 있으면 이번
        # 밤에는 발송하지 않는다 — "미완료"로 잘못 단정하지 않고 그냥
        # 미룬다(사용자 요청: "선생님이 확인 안한건 미발송(미완료 아님)").
        if has_unverified_photos(assignment_id, submission_id):
            print(f"⏸️  {class_name} · {name} — 선생님 확인 대기 중, 건너뜀")
            skipped_unverified += 1
            continue

        item_states_df = get_items_with_state(assignment_id, submission_id)
        text, all_done = _build_hw_sms_text(
            student_name=name,
            assigned_date=assigned_date,
            title=title,
            item_states_df=item_states_df,
        )

        if DRY_RUN:
            print(f"[dry-run] {class_name} · {name} ({parent_phone}) →\n{text}\n")
            continue

        from sms_sender import send_text_sms

        result = send_text_sms(parent_phone, text)
        if result["success"]:
            mark_notified(submission_id)
            # [2026-08-29 Phase B] 대시보드 KPI용 발송 기록.
            try:
                from database import log_sms_sent
                log_sms_sent("hw_notify", sid)
            except Exception:
                pass
            sent += 1
            print(f"✅ {class_name} · {name} — 발송 완료 ({'완료' if all_done else '미완료'})")
        else:
            failed += 1
            print(f"❌ {class_name} · {name} — 발송 실패: {result['message']}")

    print()
    if DRY_RUN:
        print("(--dry-run 모드라 실제로는 발송하지 않았습니다)")
    print(
        f"완료 — 발송 {sent}건 / 오늘 이미 발송돼 건너뜀 {skipped_notified}건 / "
        f"선생님 확인 대기라 건너뜀 {skipped_unverified}건 / "
        f"과제 이력 없어 건너뜀 {skipped_no_assignment}건 / 실패 {failed}건"
    )


if __name__ == "__main__":
    main()
