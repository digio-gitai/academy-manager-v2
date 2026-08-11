"""과제 인증 제출(hw_submissions)의 열람 시각(viewed_at)이 실제로 언제 찍혔는지
직접 확인하는 진단 스크립트.

"오늘 아무도 안 열어봤는데 왜 '열람 후 미완료'로 뜨지?" 같은 걸 확인할 때 씀.
Claude는 이 dev DB에 직접 접속할 네트워크 권한이 없어서, 로컬(사용자 PC)에서
직접 실행해서 결과를 보여줘야 확인 가능함.

실행 방법 (CMD에서, academy_dev 폴더 안에서):
    python check_hw_viewed.py            → 전체 최근 30건
    python check_hw_viewed.py 2026-08-08  → 특정 assigned_date만 필터
"""

import sys

from dotenv import load_dotenv

load_dotenv()  # .env 파일 읽어오기 (DATABASE_URL)

from database import ensure_hw_tables, get_conn

date_filter = sys.argv[1] if len(sys.argv) > 1 else None

print("dev DB에서 hw_submissions 열람 기록을 조회합니다...\n")

try:
    ensure_hw_tables()
    conn = get_conn()
    q = """
        SELECT a.assigned_date, a.title, st.name AS student_name,
               s.status, s.viewed_at, s.submitted_at, s.created_at, s.id AS submission_id
        FROM hw_submissions s
        JOIN hw_assignments a ON a.id = s.assignment_id
        JOIN students st ON st.id = s.student_id
    """
    params = []
    if date_filter:
        q += " WHERE a.assigned_date = ?"
        params.append(date_filter)
    q += " ORDER BY a.assigned_date DESC, st.name LIMIT 30"
    rows = conn.execute(q, tuple(params)).fetchall()
    conn.close()

    if not rows:
        print("해당 조건에 맞는 제출 기록이 없습니다.")
    else:
        print(f"{'날짜':<12} {'과제':<14} {'학생':<10} {'상태':<8} {'열람시각':<18} {'제출시각':<18} {'행생성시각':<18} id")
        print("-" * 110)
        for r in rows:
            assigned_date, title, student_name, status, viewed_at, submitted_at, created_at, sid = r
            print(
                f"{str(assigned_date):<12} {str(title)[:12]:<14} {str(student_name):<10} "
                f"{str(status):<8} {str(viewed_at or '-'):<18} {str(submitted_at or '-'):<18} "
                f"{str(created_at or '-'):<18} {sid}"
            )
        print(
            "\n'행 생성시각'(created_at)이 오늘인데 '열람시각'(viewed_at)도 채워져 있으면 "
            "— 그 시각에 실제로 누군가 ?hw=토큰 링크를 열었다는 뜻입니다 "
            "(교사 화면에서는 절대 안 채워집니다). '행 생성시각'이 오늘이 아니라 이전 날짜면, "
            "과제를 오늘 다시 저장해도 새 제출 행이 안 만들어지고 옛날 행을 그대로 재사용하고 "
            "있다는 뜻이라 원인을 더 봐야 합니다."
        )

except Exception as exc:  # noqa: BLE001
    print("❌ 실패:", exc)
    print("\n확인해보세요:")
    print("1. .env 파일에 DATABASE_URL이 정확히 들어있는지 (dev 프로젝트 kpimhidgkrqtegcumrul)")
    print("2. Supabase 프로젝트 STATUS가 Healthy인지")
