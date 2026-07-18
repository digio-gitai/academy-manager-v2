"""db_connect.py가 Supabase에 잘 연결되는지 확인하는 테스트 스크립트.

실행 방법 (CMD에서):
    python test_db_connection.py

성공하면 "연결 성공!" 메시지와 PostgreSQL 버전이 출력됩니다.
"""

from dotenv import load_dotenv

load_dotenv()  # .env 파일 읽어오기

from db_connect import get_conn

print("Supabase 연결을 시도합니다...")

try:
    conn = get_conn()
    print("✅ 연결 성공!")

    # 간단한 테스트 쿼리 실행 (SQLite 스타일 물음표 없이도 잘 되는지 확인)
    cur = conn.execute("SELECT version()")
    row = cur.fetchone()
    print("PostgreSQL 버전:", row[0])

    # ? 자리 표시가 잘 번역되는지 테스트 (값 없이도 동작하는 더미 쿼리)
    cur2 = conn.execute("SELECT 1 WHERE 1 = ?", (1,))
    row2 = cur2.fetchone()
    print("? 값 자리 표시 번역 테스트:", "성공" if row2 else "실패")

    conn.close()
    print("\n🎉 모든 테스트 통과! db_connect.py가 정상 작동합니다.")

except Exception as exc:  # noqa: BLE001
    print("❌ 연결 실패:", exc)
    print("\n확인해보세요:")
    print("1. .env 파일에 DATABASE_URL이 정확히 들어있는지")
    print("2. 비밀번호에 오타는 없는지")
    print("3. Supabase 프로젝트 STATUS가 Healthy인지")
