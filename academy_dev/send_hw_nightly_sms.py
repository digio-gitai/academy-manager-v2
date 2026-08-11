"""abc 과제 인증 — 야간 자동 문자 발송 스크립트 (2026-08-11 추가).

"내일 학원에 오는 학생"의 학부모에게, 그 학생의 가장 최근 과제가 지금
얼마나 됐는지(완료/미완료, 몇 쪽 남았는지)를 요약해서 문자로 자동 보낸다.
예: 수요일에 오는 학생이면 화요일 밤에 발송.

이 스크립트는 Streamlit 앱과 별개로, Windows 작업 스케줄러가 매일 밤
정해진 시각(예: 21:50)에 그냥 "python send_hw_nightly_sms.py" 한 줄로
실행하는 용도다. 앱이 켜져 있을 필요는 없고, 컴퓨터가 켜져 있고 이
academy_dev 폴더의 .env에 DB·SOLAPI 키가 들어있으면 된다.

동작 순서
  1. 내일 날짜의 요일을 구한다.
  2. classes.schedule(JSON, 예: [{"day":"화","start":"17:00","end":"18:30"}])을
     확인해서 "내일 요일"이 포함된 반을 찾는다.
  3. 그 반 학생들 중 부모 연락처가 있는 학생만 대상으로 한다.
  4. 각 학생의 가장 최근 과제(hw_submissions 기준 최신 assigned_date) 상태를
     hw_upload.get_items_with_state()로 가져와 항목별 완료/미완료 문구를
     만든다(hw_assign._build_hw_sms_text()와 완전히 같은 문구 형식 —
     "학부모에게 완료/미완료 문자 발송" 수동 버튼과 동일한 코드를 그대로
     재사용해서 문구가 서로 달라지지 않게 한다).
  5. 오늘 이미 문자를 보낸 적 있는 학생(수동 발송 포함)은 건너뛴다 —
     hw_submissions.notified_at 컬럼으로 판단(hw_assign.was_notified_today()).
  6. 문자 발송 후 hw_submissions.notified_at을 기록한다(hw_assign.mark_notified()).
  7. 결과를 화면(콘솔)에 한 줄씩 찍는다 — 작업 스케줄러의 "기록" 탭이나
     리다이렉트한 로그 파일로 나중에 확인 가능.

실행 방법 (CMD에서, academy_dev 폴더 안에서):
    python send_hw_nightly_sms.py
    python send_hw_nightly_sms.py --dry-run   ← 실제 발송 없이 누구한테 뭘
                                                  보낼지만 미리 확인

주의: 이 스크립트는 dev DB(.env의 DATABASE_URL)를 그대로 쓴다. dev SOLAPI
키가 비어있으면(기본 상태) 안전하게 "발신번호 미설정" 에러만 나고 실제
문자는 안 나간다 — 이건 사고 방지용 정상 동작이다. 실제 학부모에게 보내려면
운영 DB·운영 SOLAPI 키가 연결된 환경에서 실행해야 하는데, 그건 이 abc
기능이 충분히 검증되어 운영 앱에 합쳐진 뒤에 결정할 일이다(지금은 dev
전용 테스트 목적).
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
    print(f"내일({target_date}, {day_kr}요일) 수업 있는 반을 찾습니다...\n")

    classes = _classes_meeting_on(day_kr)
    if not classes:
        print("내일 수업 있는 반이 없습니다. 종료합니다.")
        return

    print(f"대상 반 {len(classes)}개: " + ", ".join(c["name"] for c in classes))
    print()

    sent, skipped_notified, skipped_no_assignment, skipped_unverified, failed = 0, 0, 0, 0, 0

    for cls in classes:
        students = _students_with_phone(cls["id"])
        for stu in students:
            sub = _latest_certifiable_submission(stu["id"])
            if sub is None:
                skipped_no_assignment += 1
                continue
            if was_notified_today(sub["notified_at"]):
                print(f"⏭️  {cls['name']} · {stu['name']} — 오늘 이미 발송됨(수동 또는 자동), 건너뜀")
                skipped_notified += 1
                continue
            # [2026-08-11] 선생님이 아직 확인 안 한 제출 사진이 있으면 이번
            # 밤에는 발송하지 않는다 — "미완료"로 잘못 단정하지 않고 그냥
            # 미룬다(사용자 요청: "선생님이 확인 안한건 미발송(미완료 아님)").
            if has_unverified_photos(sub["assignment_id"], sub["submission_id"]):
                print(f"⏸️  {cls['name']} · {stu['name']} — 선생님 확인 대기 중, 건너뜀")
                skipped_unverified += 1
                continue

            item_states_df = get_items_with_state(sub["assignment_id"], sub["submission_id"])
            text, all_done = _build_hw_sms_text(
                student_name=stu["name"],
                assigned_date=sub["assigned_date"],
                title=sub["title"],
                item_states_df=item_states_df,
            )

            if DRY_RUN:
                print(f"[dry-run] {cls['name']} · {stu['name']} ({stu['parent_phone']}) →\n{text}\n")
                continue

            from sms_sender import send_text_sms

            result = send_text_sms(stu["parent_phone"], text)
            if result["success"]:
                mark_notified(sub["submission_id"])
                sent += 1
                print(f"✅ {cls['name']} · {stu['name']} — 발송 완료 ({'완료' if all_done else '미완료'})")
            else:
                failed += 1
                print(f"❌ {cls['name']} · {stu['name']} — 발송 실패: {result['message']}")

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
