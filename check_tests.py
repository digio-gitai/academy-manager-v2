"""Supabase 시험지 표시 문제 진단용 (임시 스크립트)"""
import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2

conn = psycopg2.connect(os.getenv("DATABASE_URL"))
cur = conn.cursor()

cur.execute("SELECT test_id, test_name, total_questions FROM tests ORDER BY created_at DESC")
print("[tests]")
for r in cur.fetchall():
    print(" ", r)

cur.execute(
    "SELECT sr.test_id, sr.student_id, s.name, s.class_id, c.teacher_id "
    "FROM student_results sr "
    "LEFT JOIN students s ON s.id = sr.student_id "
    "LEFT JOIN classes c ON c.id = s.class_id "
    "ORDER BY sr.test_id"
)
print("[student_results → 학생/반/담당강사]")
for r in cur.fetchall():
    print(" ", r)

cur.execute("SELECT id, name FROM teachers ORDER BY id")
print("[teachers]")
for r in cur.fetchall():
    print(" ", r)

conn.close()
