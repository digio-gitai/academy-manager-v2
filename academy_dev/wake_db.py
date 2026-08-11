"""
Supabase DB 깨우기 스크립트.

Supabase 무료 요금제는 7일간 DB에 아무 요청이 없으면 프로젝트가 "일시정지" 상태가 됩니다.
이 상태에서 첫 요청이 들어오면 자동으로 깨어나지만 약 30초 정도 걸립니다.
앱을 실행하기 전에 이 스크립트가 먼저 DB를 깨워둬서, 앱 첫 화면에서 연결 오류가
뜨는 것을 방지합니다.
"""
import os
import sys
import time

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

try:
    import psycopg2
except ImportError:
    print("[경고] psycopg2가 설치되어 있지 않습니다. pip install psycopg2-binary 후 다시 시도하세요.")
    sys.exit(0)

if load_dotenv:
    load_dotenv()

url = os.environ.get("DATABASE_URL")
if not url:
    print("[경고] DATABASE_URL을 찾을 수 없습니다. .env 파일을 확인하세요. (DB 깨우기를 건너뜁니다)")
    sys.exit(0)

print("데이터베이스 연결 확인 중...")

MAX_WAIT_SECONDS = 60
INTERVAL = 5
elapsed = 0
first_try = True

while elapsed <= MAX_WAIT_SECONDS:
    try:
        conn = psycopg2.connect(url, connect_timeout=10)
        conn.close()
        print("데이터베이스 연결 완료! 프로그램을 시작합니다.")
        sys.exit(0)
    except Exception:
        if first_try:
            print("데이터베이스가 잠들어 있는 것 같습니다. 깨우는 중입니다... (최대 1분 소요)")
            first_try = False
        time.sleep(INTERVAL)
        elapsed += INTERVAL

print("[경고] 1분 내에 데이터베이스 연결을 확인하지 못했습니다. 그래도 프로그램을 계속 실행합니다.")
