-- 학생 과제 업로드 · 학부모 다이어리 공개 화면용 DB 함수 (2026-10-24)
--
-- 학부모/학생은 로그인 없이 링크의 토큰으로만 들어온다. 테이블을 직접 읽고 쓰게
-- 두면 anon 키만으로 전체 데이터가 보이므로, "토큰이 맞는 한 건"만 다루는 함수로
-- 바꾸고 테이블(students, classes, hw_*)은 로그인한 열쇠 계정만 접근하게 잠근다.
-- 이 파일은 함수만 추가한다 — 기존 동작은 바뀌지 않는다(잠금은 코드 반영 후 별도 단계).
-- 여러 번 실행해도 안전함(create or replace).

-- ───────── 학생 과제 업로드 ─────────

-- 토큰으로 제출 1건 + 과제·반·학생 이름 + 공통항목 포함 여부
create or replace function public.hw_upload_meta(p_token text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', s.id, 'assignment_id', s.assignment_id, 'student_id', s.student_id,
    'status', s.status, 'viewed_at', s.viewed_at,
    'hw_assignments', json_build_object(
      'title', a.title, 'due_date', a.due_date, 'assigned_date', a.assigned_date,
      'class_id', a.class_id, 'classes', json_build_object('name', c.name)),
    'students', json_build_object('name', st.name),
    'include_common', coalesce((select t.include_common from public.hw_assignment_targets t
                                 where t.assignment_id = s.assignment_id and t.student_id = s.student_id limit 1), true)
  )
  from public.hw_submissions s
  join public.hw_assignments a on a.id = s.assignment_id
  left join public.classes c on c.id = a.class_id
  left join public.students st on st.id = s.student_id
  where s.upload_token = p_token
  limit 1 $$;

-- 이 학생에게 보여줄 항목 + 이전 제출 상태(사진 개수 포함)
create or replace function public.hw_upload_items(p_token text) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(row_to_json(x) order by x.sort_order), '[]'::json) from (
    select i.id, i.item_type, i.material_name, i.page_start, i.page_end, i.excluded_pages,
           i.description, i.student_id, i.sort_order,
           (select json_build_object('status', sub.status, 'completed_pages', sub.completed_pages,
                                     'student_note', sub.student_note,
                                     'photo_count', (select count(*) from public.hw_photos p where p.item_submission_id = sub.id))
              from public.hw_item_submissions sub
             where sub.submission_id = s.id and sub.item_id = i.id limit 1) as sub
      from public.hw_submissions s
      join public.hw_items i on i.assignment_id = s.assignment_id and (i.student_id is null or i.student_id = s.student_id)
     where s.upload_token = p_token
  ) x $$;

-- 처음 열람한 시각만 기록
create or replace function public.hw_upload_mark_viewed(p_token text) returns void
language sql security definer set search_path = public as $$
  update public.hw_submissions
     set viewed_at = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI')
   where upload_token = p_token and viewed_at is null $$;

-- 항목 하나의 완료 여부·완료 페이지·메모 저장(같은 항목이면 덮어씀)
create or replace function public.hw_upload_save_item(p_token text, p_item_id integer, p_status text,
                                                      p_completed_pages text, p_note text) returns integer
language plpgsql security definer set search_path = public as $$
declare v_sub public.hw_submissions; v_id integer;
begin
  select * into v_sub from public.hw_submissions where upload_token = p_token;
  if not found then raise exception 'invalid token'; end if;
  if not exists (select 1 from public.hw_items i
                  where i.id = p_item_id and i.assignment_id = v_sub.assignment_id
                    and (i.student_id is null or i.student_id = v_sub.student_id)) then
    raise exception 'invalid item';
  end if;
  if p_status not in ('done', 'not_done') then raise exception 'invalid status'; end if;
  insert into public.hw_item_submissions (submission_id, item_id, status, completed_pages, student_note, updated_at)
  values (v_sub.id, p_item_id, p_status, left(coalesce(p_completed_pages, ''), 2000), left(coalesce(p_note, ''), 2000),
          to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'))
  on conflict (submission_id, item_id) do update
    set status = excluded.status, completed_pages = excluded.completed_pages,
        student_note = excluded.student_note, updated_at = excluded.updated_at
  returning id into v_id;
  return v_id;
end $$;

-- 사진 기록 추가(그 제출 번호 폴더 아래 hw-photos 주소만 허용, 항목당 최대 100장)
create or replace function public.hw_upload_add_photo(p_token text, p_item_submission_id integer, p_photo_url text) returns integer
language plpgsql security definer set search_path = public as $$
declare v_sub public.hw_submissions; v_id integer;
begin
  select * into v_sub from public.hw_submissions where upload_token = p_token;
  if not found then raise exception 'invalid token'; end if;
  if not exists (select 1 from public.hw_item_submissions x where x.id = p_item_submission_id and x.submission_id = v_sub.id) then
    raise exception 'invalid item submission';
  end if;
  if position('/hw-photos/' || v_sub.id::text || '/' in coalesce(p_photo_url, '')) = 0 then
    raise exception 'invalid photo url';
  end if;
  if (select count(*) from public.hw_photos where item_submission_id = p_item_submission_id) >= 100 then
    raise exception 'too many photos';
  end if;
  insert into public.hw_photos (item_submission_id, photo_url, uploaded_at)
  values (p_item_submission_id, p_photo_url, to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'))
  returning id into v_id;
  return v_id;
end $$;

-- AI 1차 페이지 확인 결과 저장(그 제출의 사진만)
create or replace function public.hw_upload_set_ai(p_token text, p_photo_id integer, p_guess text, p_flag text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.hw_photos p
     set ai_page_guess = left(p_guess, 200), ai_flag = left(p_flag, 200)
   where p.id = p_photo_id
     and exists (select 1 from public.hw_item_submissions x
                   join public.hw_submissions s on s.id = x.submission_id
                  where x.id = p.item_submission_id and s.upload_token = p_token);
end $$;

-- 전체 제출 상태 갱신
create or replace function public.hw_upload_finish(p_token text, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('pending', 'partial', 'done') then raise exception 'invalid status'; end if;
  update public.hw_submissions
     set status = p_status, submitted_at = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI')
   where upload_token = p_token;
end $$;

-- 이 제출이 속한 반의 참조 자료 목록(AI 페이지 확인에 사용)
create or replace function public.hw_upload_reference(p_token text) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
           'id', r.id, 'class_id', r.class_id, 'material_name', r.material_name, 'file_path', r.file_path,
           'page_count', r.page_count, 'page_offset', r.page_offset,
           'uploaded_at', r.uploaded_at, 'updated_at', r.updated_at) order by r.material_name), '[]'::json)
    from public.hw_submissions s
    join public.hw_assignments a on a.id = s.assignment_id
    join public.hw_reference_materials r on r.class_id = a.class_id
   where s.upload_token = p_token $$;

-- ───────── 학부모 다이어리 ─────────

-- 토큰으로 다이어리 1건(학생 항목 + 반 공통 내용 + 반 이름)
create or replace function public.diary_public_get(p_token text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', e.id, 'student_id', e.student_id, 'token', e.token, 'included', e.included,
    'student_name', e.student_name, 'school_grade', e.school_grade,
    'attendance_status', e.attendance_status, 'hw_performance', e.hw_performance,
    'course', e.course, 'textbook', e.textbook, 'progress', e.progress,
    'homework', e.homework, 'message', e.message, 'sent_at', e.sent_at,
    'daily_diaries', json_build_object(
      'id', d.id, 'diary_date', d.diary_date, 'academy_name', d.academy_name, 'teacher_name', d.teacher_name,
      'course', d.course, 'textbook', d.textbook, 'common_progress', d.common_progress,
      'common_homework', d.common_homework, 'common_message', d.common_message,
      'classes', json_build_object('name', c.name))
  )
  from public.daily_diary_entries e
  join public.daily_diaries d on d.id = e.diary_id
  left join public.classes c on c.id = d.class_id
  where e.token = p_token
  limit 1 $$;

-- 같은 학생의 지난 다이어리(발송된 것만, 현재 토큰 제외)
create or replace function public.diary_public_past(p_token text) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
           'token', e2.token, 'progress', e2.progress,
           'daily_diaries', json_build_object('diary_date', d2.diary_date, 'common_progress', d2.common_progress))), '[]'::json)
    from public.daily_diary_entries e
    join public.daily_diary_entries e2 on e2.student_id = e.student_id and e2.sent_at is not null and e2.token <> e.token
    join public.daily_diaries d2 on d2.id = e2.diary_id
   where e.token = p_token $$;

-- 처음 열람한 시각만 기록
create or replace function public.diary_mark_viewed(p_token text) returns void
language sql security definer set search_path = public as $$
  update public.daily_diary_entries
     set viewed_at = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI')
   where token = p_token and viewed_at is null $$;

-- ───────── 권한: 로그인 없이(anon) 호출 가능, 토큰이 맞아야만 내용이 나옴 ─────────
revoke all on function public.hw_upload_meta(text), public.hw_upload_items(text), public.hw_upload_mark_viewed(text),
  public.hw_upload_save_item(text, integer, text, text, text), public.hw_upload_add_photo(text, integer, text),
  public.hw_upload_set_ai(text, integer, text, text), public.hw_upload_finish(text, text), public.hw_upload_reference(text),
  public.diary_public_get(text), public.diary_public_past(text), public.diary_mark_viewed(text) from public;
grant execute on function public.hw_upload_meta(text), public.hw_upload_items(text), public.hw_upload_mark_viewed(text),
  public.hw_upload_save_item(text, integer, text, text, text), public.hw_upload_add_photo(text, integer, text),
  public.hw_upload_set_ai(text, integer, text, text), public.hw_upload_finish(text, text), public.hw_upload_reference(text),
  public.diary_public_get(text), public.diary_public_past(text), public.diary_mark_viewed(text) to anon, authenticated;
