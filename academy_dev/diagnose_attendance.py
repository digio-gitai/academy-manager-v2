"""
출석 이력이 안 보이는 문제 진단용 스크립트 (읽기 전용 — 아무것도 지우거나 바꾸지 않음).

teachers / classes / attendance 테이블 내용을 그대로 출력해서
diagnose_log.txt 에 저장합니다.
"""
import os
import sys
import io

from dotenv import load_dotenv
import psycopg2

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

load_dotenv()
DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    print("[오류] DATABASE_URL을 찾을 수 없습니다.")
    sys.exit(1)

_LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "diagnose_log.txt")
_lines: list[str] = []


def log(msg: str = "") -> None:
    print(msg)
    _lines.append(msg)


conn = psycopg2.connect(DATABASE_URL, connect_timeout=10)
cur = conn.cursor()

log("=" * 60)
log("1) teachers 전체 목록")
log("=" * 60)
cur.execute("SELECT id, name, role FROM teachers ORDER BY id")
for row in cur.fetchall():
    log(f"  id={row[0]}, name={row[1]}, role={row[2]}")

log("\n" + "=" * 60)
log("2) classes 전체 목록")
log("=" * 60)
cur.execute("SELECT id, name, teacher_id FROM classes ORDER BY id")
for row in cur.fetchall():
    log(f"  id={row[0]}, name={row[1]}, teacher_id={row[2]}")

log("\n" + "=" * 60)
log("3) '월수금 중3반' 클래스 상세")
log("=" * 60)
cur.execute("SELECT id, name, teacher_id FROM classes WHERE name = %s", ("월수금 중3반",))
target_class = cur.fetchone()
log(f"  {target_class}")

log("\n" + "=" * 60)
log("4) students 중 class_id가 위 반인 학생")
log("=" * 60)
if target_class:
    cur.execute("SELECT id, name, class_id FROM students WHERE class_id = %s", (target_class[0],))
    for row in cur.fetchall():
        log(f"  id={row[0]}, name={row[1]}, class_id={row[2]}")

log("\n" + "=" * 60)
log("5) attendance 테이블 전체 (최근 30건)")
log("=" * 60)
cur.execute(
    """
    SELECT a.id, a.student_id, s.name, a.class_id, c.name, a.session_date, a.status
    FROM attendance a
    LEFT JOIN students s ON s.id = a.student_id
    LEFT JOIN classes c ON c.id = a.class_id
    ORDER BY a.id DESC
    LIMIT 30
    """
)
rows = cur.fetchall()
if not rows:
    log("  (attendance 테이블에 데이터가 아예 없음)")
for row in rows:
    log(f"  attendance_id={row[0]}, student_id={row[1]}({row[2]}), class_id={row[3]}({row[4]}), date={row[5]}, status={row[6]}")

conn.close()

with io.open(_LOG_PATH, "w", encoding="utf-8") as f:
    f.write("\n".join(_lines))

print(f"\n로그 저장 완료: {_LOG_PATH}")
input("\n엔터를 누르면 종료합니다...")
