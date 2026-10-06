-- 보강 기록에 "원래 수업일(결석 대신 보강한 날)" 칸 추가.
-- Supabase 대시보드 → SQL Editor에 붙여넣고 Run. 운영(academy-manager)과
-- 테스트(academy-dev) 프로젝트에 각각 한 번씩 실행. 여러 번 실행해도 안전함.
-- (2026-09-23_makeup_sessions.sql을 먼저 실행한 상태여야 함)

alter table makeup_attendees add column if not exists original_date text;  -- 'YYYY-MM-DD', 비어 있으면 일반 보강
