-- 데일리 Diary(수업 후 학부모 문자 + 링크 페이지) 테이블 3개.
-- Supabase 대시보드 → SQL Editor에 통째로 붙여넣고 Run. 새 테이블만 추가하고
-- 기존 테이블은 건드리지 않음. 여러 번 실행해도 안전함(if not exists / drop policy if exists).

-- 1) 설정값(학원명 등) — key/value
create table if not exists diary_settings (
  key text primary key,
  value text not null default ''
);

-- 2) 반+날짜별 Diary 본문(공통 내용)
create table if not exists daily_diaries (
  id serial primary key,
  class_id integer not null references classes(id) on delete cascade,
  diary_date text not null,                       -- 'YYYY-MM-DD'
  academy_name text not null default '',
  teacher_name text not null default '',
  course text not null default '',                -- 과정
  textbook text not null default '',              -- 교재
  common_progress text not null default '',       -- 오늘 진도(공통)
  common_homework text not null default '',       -- 과제(공통)
  common_message text not null default '',        -- 공지사항 및 전하는 말씀(공통)
  updated_at text not null default '',
  unique (class_id, diary_date)
);

-- 3) 학생별 Diary(링크 토큰, 개별 수정값, 발송 기록)
create table if not exists daily_diary_entries (
  id serial primary key,
  diary_id integer not null references daily_diaries(id) on delete cascade,
  student_id integer not null references students(id) on delete cascade,
  token text not null unique,
  included boolean not null default true,         -- 발송 대상 여부
  student_name text not null default '',
  school_grade text not null default '',          -- 예: '영락중 3'
  attendance_status text not null default 'present',  -- present/late/absent
  hw_performance text not null default '',        -- 상/중/하/''
  progress text,                                  -- null이면 공통값 사용
  homework text,                                  -- null이면 공통값 사용
  message text,                                   -- null이면 공통값 사용
  sent_at text,
  viewed_at text,
  unique (diary_id, student_id)
);

create index if not exists daily_diary_entries_student_idx on daily_diary_entries (student_id);

-- 웹앱(anon 키)에서 읽기/쓰기 — 다른 학원 테이블과 같은 수준의 권한.
grant select, insert, update, delete on diary_settings, daily_diaries, daily_diary_entries to anon, authenticated;
grant usage, select on sequence daily_diaries_id_seq, daily_diary_entries_id_seq to anon, authenticated;

alter table diary_settings enable row level security;
alter table daily_diaries enable row level security;
alter table daily_diary_entries enable row level security;

drop policy if exists "diary_settings_all" on diary_settings;
create policy "diary_settings_all" on diary_settings for all to anon, authenticated using (true) with check (true);
drop policy if exists "daily_diaries_all" on daily_diaries;
create policy "daily_diaries_all" on daily_diaries for all to anon, authenticated using (true) with check (true);
drop policy if exists "daily_diary_entries_all" on daily_diary_entries;
create policy "daily_diary_entries_all" on daily_diary_entries for all to anon, authenticated using (true) with check (true);
