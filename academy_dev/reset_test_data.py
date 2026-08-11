"""
테스트 데이터 정리 스크립트.

이 스크립트는:
  1) "A", "B", "C", "D" 학생 (테스트 반 자동생성용 더미 학생) 전부 삭제
  2) "테스트 반" 클래스에 연결된 시험(exams)과 그 반 자체를 삭제
     (담당 강사인 "테스트 강사" 계정 자체는 건드리지 않습니다)
  3) "이바보" 학생이 남아있다면, 학생 정보는 유지하고 AI 시험 분석 기록만 초기화

먼저 무엇을 지울지 미리 보여주고, 영어로 DELETE 라고 정확히 입력해야 실제로 지워집니다.
(한글 입력은 콘솔 인코딩에 따라 비교가 안 될 수 있어 확인 문구는 영어로 통일했습니다)

모든 과정은 이 파일과 같은 폴더의 reset_log.txt 에도 그대로 기록됩니다.
"""
import os
import sys
import io
from datetime import datetime

from dotenv import load_dotenv
import psycopg2

# Windows 콘솔에서 한글 출력이 깨지지 않도록 강제 UTF-8 설정
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

_LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "reset_log.txt")
_log_lines: list[str] = []


def log(msg: str = "") -> None:
    print(msg)
    _log_lines.append(msg)


def save_log() -> None:
    try:
        with io.open(_LOG_PATH, "w", encoding="utf-8") as f:
            f.write("\n".join(_log_lines))
    except Exception as e:
        print(f"[경고] 로그 파일 저장 실패: {e}")


try:
    load_dotenv()

    DATABASE_URL = os.environ.get("DATABASE_URL")
    if not DATABASE_URL:
        log("[오류] DATABASE_URL을 찾을 수 없습니다. .env 파일을 확인하세요.")
        save_log()
        sys.exit(1)

    TEST_CLASS_NAME = "테스트 반"
    TEST_STUDENT_NAMES = ("A", "B", "C", "D")
    KEEP_STUDENT_NAME = "이바보"

    log(f"실행 시각: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    conn = psycopg2.connect(DATABASE_URL, connect_timeout=10)
    conn.autocommit = True
    cur = conn.cursor()

    log("=" * 50)
    log("현재 상태 확인 중...")
    log("=" * 50)

    # 1) A/B/C/D 학생
    cur.execute(
        "SELECT id, name, class_id FROM students WHERE name = ANY(%s)",
        (list(TEST_STUDENT_NAMES),),
    )
    abcd_students = cur.fetchall()
    log(f"\n[삭제 대상] A/B/C/D 학생: {len(abcd_students)}명")
    for sid, name, class_id in abcd_students:
        log(f"   - id={sid}, 이름={name}, class_id={class_id}")

    # 2) 테스트 반 클래스 + 연결된 시험
    cur.execute("SELECT id FROM classes WHERE name = %s", (TEST_CLASS_NAME,))
    row = cur.fetchone()
    test_class_id = row[0] if row else None
    log(f"\n[삭제 대상] '{TEST_CLASS_NAME}' 클래스: {'id=' + str(test_class_id) if test_class_id else '없음'}")

    test_exams = []
    if test_class_id:
        cur.execute("SELECT id, name, exam_date FROM exams WHERE class_id = %s", (test_class_id,))
        test_exams = cur.fetchall()
        log(f"   연결된 시험(exams): {len(test_exams)}건")
        for eid, ename, edate in test_exams:
            log(f"   - id={eid}, 이름={ename}, 날짜={edate}")

    # 3) 이바보 학생 (남아있다면 보존 대상) — AI 분석 기록만 초기화
    cur.execute("SELECT id FROM students WHERE name = %s", (KEEP_STUDENT_NAME,))
    row = cur.fetchone()
    keep_student_id = row[0] if row else None
    log(f"\n[참고] '{KEEP_STUDENT_NAME}' 학생: {'id=' + str(keep_student_id) if keep_student_id else '없음 (이미 삭제되었거나 이름이 다름)'}")

    keep_ai_results = []
    if keep_student_id:
        cur.execute(
            "SELECT id, exam_name, exam_date FROM ai_exam_results WHERE student_id = %s",
            (keep_student_id,),
        )
        keep_ai_results = cur.fetchall()
        log(f"   [초기화 대상] AI 시험 분석 기록(ai_exam_results): {len(keep_ai_results)}건")
        for rid, ename, edate in keep_ai_results:
            log(f"   - id={rid}, 시험명={ename}, 날짜={edate}")

    log("\n" + "=" * 50)
    log("teachers(강사) 테이블은 이 스크립트가 절대 건드리지 않습니다.")
    log("위 내용이 맞으면 아래에 정확히 영어 대문자로 DELETE 라고 입력하세요.")
    log("(다른 것을 입력하거나 그냥 엔터를 누르면 아무것도 지우지 않고 종료합니다)")
    log("=" * 50)

    save_log()  # 확인 전 상태까지 우선 저장

    confirm = input("Type DELETE to proceed: ").strip()
    log(f"[입력값] {confirm!r}")

    if confirm.upper() != "DELETE":
        log("\n취소되었습니다. 아무 것도 지우지 않았습니다.")
        save_log()
        conn.close()
        sys.exit(0)

    log("\n삭제를 진행합니다...")

    # A/B/C/D 학생 삭제 (연결된 attendance/student_scores/ai_exam_results 등은 CASCADE로 자동 삭제됨)
    if abcd_students:
        cur.execute("DELETE FROM students WHERE name = ANY(%s)", (list(TEST_STUDENT_NAMES),))
        log(f"- A/B/C/D 학생 {len(abcd_students)}명 삭제 완료")
    else:
        log("- A/B/C/D 학생 없음 (건너뜀)")

    # 테스트 반에 연결된 시험 삭제 (exam_topics/student_scores는 CASCADE)
    if test_class_id and test_exams:
        cur.execute("DELETE FROM exams WHERE class_id = %s", (test_class_id,))
        log(f"- '{TEST_CLASS_NAME}' 연결 시험 {len(test_exams)}건 삭제 완료")

    # 테스트 반 클래스 삭제
    if test_class_id:
        cur.execute("DELETE FROM classes WHERE id = %s", (test_class_id,))
        log(f"- '{TEST_CLASS_NAME}' 클래스 삭제 완료")
    else:
        log(f"- '{TEST_CLASS_NAME}' 클래스 없음 (건너뜀)")

    # 이바보 학생의 AI 분석 기록만 초기화 (학생 정보는 유지)
    if keep_student_id and keep_ai_results:
        cur.execute("DELETE FROM ai_exam_results WHERE student_id = %s", (keep_student_id,))
        log(f"- '{KEEP_STUDENT_NAME}' 학생의 AI 분석 기록 {len(keep_ai_results)}건 초기화 완료 (학생 정보는 유지)")

    log("\n완료되었습니다.")
    conn.close()
    save_log()

except Exception as e:
    import traceback
    log("\n[오류 발생]")
    log(traceback.format_exc())
    save_log()
    raise
