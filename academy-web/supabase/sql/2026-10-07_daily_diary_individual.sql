-- 데일리 Diary: 개별진도반 지원(학생마다 교재·과정이 다른 반).
-- 이미 만든 daily_diaries / daily_diary_entries 테이블에 컬럼만 추가. 여러 번 실행해도 안전함.
-- Supabase 대시보드 → SQL Editor에 통째로 붙여넣고 Run.

alter table daily_diaries add column if not exists individual_mode boolean not null default false;

-- null이면 반 공통값(daily_diaries.course / textbook)을 따른다.
alter table daily_diary_entries add column if not exists course text;
alter table daily_diary_entries add column if not exists textbook text;
