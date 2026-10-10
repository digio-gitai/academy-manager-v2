-- 재시험 기록 테이블 (성적 리포트 → "재시험 기록" 탭).
-- 점수는 저장하지 않고 "몇 회차에 통과/실패했는지"만 남김. 집단 통계(평균·상위 비율)에는
-- 쓰이지 않고, 개인 추이 보고서의 "재시험 현황"에만 표시됨.
-- Supabase 대시보드 → SQL Editor에 붙여넣고 Run. 운영(academy-manager)과
-- 테스트(academy-dev) 프로젝트에 각각 한 번씩 실행. 여러 번 실행해도 안전함.

create table if not exists test_retests (
  id serial primary key,
  student_id integer not null references students(id) on delete cascade,
  test_id integer not null references tests(test_id) on delete cascade,
  attempt_no integer not null,                                  -- 1, 2, 3 … (재시험 회차)
  passed boolean not null,                                      -- true = 통과, false = 실패
  tested_on text not null,                                      -- 'YYYY-MM-DD'
  created_at text not null,                                     -- 'YYYY-MM-DD HH:MM'
  unique (student_id, test_id, attempt_no)
);

create index if not exists test_retests_test_idx on test_retests (test_id);

-- 웹앱(anon 키)에서 읽기/쓰기 가능하도록 — 다른 학원 테이블과 같은 수준의 권한.
grant select, insert, update, delete on test_retests to anon, authenticated;
grant usage, select on sequence test_retests_id_seq to anon, authenticated;

alter table test_retests enable row level security;

drop policy if exists "test_retests_all" on test_retests;
create policy "test_retests_all" on test_retests for all to anon, authenticated using (true) with check (true);
