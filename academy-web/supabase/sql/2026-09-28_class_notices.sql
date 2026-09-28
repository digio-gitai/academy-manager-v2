-- 반별 메모/공지 테이블 (출석 관리 → "직전 수업 과제" 옆 "반 공지" 칸).
-- 대시보드 공지(academy_notices)는 notice_type이 weekly/monthly로 CHECK 제약이
-- 걸려 있어서 반별 행을 넣을 수 없음 → 반마다 1행씩 따로 저장하는 테이블.
-- Supabase 대시보드 → SQL Editor에 붙여넣고 Run. 운영(academy-manager)과
-- 테스트(academy-dev) 프로젝트에 각각 한 번씩 실행. 여러 번 실행해도 안전함.

create table if not exists class_notices (
  id serial primary key,
  class_id integer not null unique references classes(id) on delete cascade,
  body text not null default '',
  updated_at text not null                                      -- 'YYYY-MM-DD HH:MM'
);

-- 웹앱(anon 키)에서 읽기/쓰기 가능하도록 — 다른 학원 테이블과 같은 수준의 권한.
grant select, insert, update, delete on class_notices to anon, authenticated;
grant usage, select on sequence class_notices_id_seq to anon, authenticated;

alter table class_notices enable row level security;

drop policy if exists "class_notices_all" on class_notices;
create policy "class_notices_all" on class_notices for all to anon, authenticated using (true) with check (true);
