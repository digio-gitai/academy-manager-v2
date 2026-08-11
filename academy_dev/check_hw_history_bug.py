"""'미완료 학생' 화면이 실제로 쓰는 함수(get_student_assignment_history +
compute_display_status)를 그대로 호출해서, DB에는 viewed_at이 NULL인데
화면에는 "열람 후 미완료"로 잘못 뜨는 버그를 재현해보는 진단 스크립트.

check_hw_viewed.py는 원시 SQL로 DB 값만 보여줬는데, 그건 정상(NULL)이었다.
이 스크립트는 앱이 실제로 쓰는 파이썬 함수를 그대로 호출해서 pandas
DataFrame 단계에서 값이 바뀌는지까지 확인한다.

실행 방법 (CMD에서, academy_dev 폴더 안에서):
    python check_hw_history_bug.py 테스트학생
"""

import sys

from dotenv import load_dotenv

load_dotenv()

from database import ensure_hw_tables, get_conn
from hw_assign import get_student_assignment_history
from hw_upload import compute_display_status

name = sys.argv[1] if len(sys.argv) > 1 else "테스트학생"

ensure_hw_tables()
conn = get_conn()
row = conn.execute("SELECT id, class_id FROM students WHERE name = ?", (name,)).fetchone()
conn.close()

if not row:
    print(f"'{name}' 학생을 찾을 수 없습니다.")
    sys.exit(1)

student_id, class_id = int(row[0]), row[1]
print(f"학생: {name} (id={student_id}, class_id={class_id})\n")

hist_df = get_student_assignment_history(student_id, class_id=class_id)

print("── get_student_assignment_history() 결과 ──")
print(hist_df[["assignment_id", "title", "assigned_date", "status", "viewed_at"]])
print()
print("viewed_at 컬럼 dtype:", hist_df["viewed_at"].dtype)
print("viewed_at 컬럼 raw 값:", [repr(v) for v in hist_df["viewed_at"]])
print()

print("── compute_display_status() 재현 ──")
for _, hrow in hist_df.iterrows():
    label = compute_display_status(
        status=hrow["status"], viewed_at=hrow["viewed_at"], due_date=hrow["due_date"]
    )
    print(
        f"  {hrow['assigned_date']} · {hrow['title']} — viewed_at={hrow['viewed_at']!r} "
        f"(bool={bool(hrow['viewed_at'])}) → {label}"
    )
