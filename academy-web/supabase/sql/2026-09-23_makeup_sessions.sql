-- 보강 기록 테이블 (출석 관리 → 보강 관리 탭).
-- Supabase 대시보드 → SQL Editor에 붙여넣고 Run. 운영(academy-manager)과
-- 테스트(academy-dev) 프로젝트에 각각 한 번씩 실행. 여러 번 실행해도 안전함.

create table if not exists makeup_sessions (
  id serial primary key,
  session_date text not null,                                   -- 'YYYY-MM-DD'
  class_id integer references classes(id) on delete set null,   -- 어느 반 보강인지(선택)
  content text not null default '',                             -- 보강 내용(예: 8/8 수업분 미리 보강)
  created_at text not null
);

create table if not exists makeup_attendees (
  id serial primary key,
  makeup_id integer not null references makeup_sessions(id) on delete cascade,
  student_id integer not null references students(id) on delete cascade,
  unique (makeup_id, student_id)
);

create index if not exists makeup_sessions_date_idx on makeup_sessions(session_date);
create index if not exists makeup_attendees_student_idx on makeup_attendees(student_id);

-- 웹앱(anon 키)에서 읽기/쓰기 가능하도록 — 다른 학원 테이블과 같은 수준의 권한.
grant select, insert, update, delete on makeup_sessions, makeup_attendees to anon, authenticated;
grant usage, select on sequence makeup_sessions_id_seq, makeup_attendees_id_seq to anon, authenticated;

alter table makeup_sessions enable row level security;
alter table makeup_attendees enable row level security;

drop policy if exists "makeup_sessions_all" on makeup_sessions;
create policy "makeup_sessions_all" on makeup_sessions for all to anon, authenticated using (true) with check (true);

drop policy if exists "makeup_attendees_all" on makeup_attendees;
create policy "makeup_attendees_all" on makeup_attendees for all to anon, authenticated using (true) with check (true);
