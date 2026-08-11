"""abc 과제 인증 시스템 테이블(hw_*)이 dev DB에 잘 만들어졌는지 확인하는 스크립트.

실행 방법 (CMD에서, academy_dev 폴더 안에서):
    python check_hw_tables.py

- 테이블이 아직 없으면 자동으로 만들고,
- 있으면 그냥 목록만 보여줍니다.
"""

from dotenv import load_dotenv

load_dotenv()  # .env 파일 읽어오기 (DATABASE_URL)

from database import ensure_hw_tables, get_conn

print("dev DB에 hw_ 테이블을 확인/생성합니다...")

try:
    ensure_hw_tables()
    conn = get_conn()
    rows = conn.execute(
        """SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name LIKE 'hw_%'
           ORDER BY table_name"""
    ).fetchall()
    conn.close()

    expected = {
        "hw_assignments",
        "hw_assignment_targets",
        "hw_items",
        "hw_submissions",
        "hw_item_submissions",
        "hw_photos",
    }
    found = {r[0] for r in rows}

    print("\n생성된 테이블:")
    for name in sorted(found):
        print("  -", name)

    missing = expected - found
    if missing:
        print("\n⚠️ 누락된 테이블:", missing)
    else:
        print("\n🎉 6개 테이블 모두 정상적으로 있습니다!")

except Exception as exc:  # noqa: BLE001
    print("❌ 실패:", exc)
    print("\n확인해보세요:")
    print("1. .env 파일에 DATABASE_URL이 정확히 들어있는지 (dev 프로젝트 kpimhidgkrqtegcumrul)")
    print("2. Supabase 프로젝트 STATUS가 Healthy인지")
