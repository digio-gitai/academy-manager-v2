// Supabase Edge Function: hw-nightly-sms
//
// 과제인증(abc) 야간 자동 문자 발송 — 리액트(academy-web) 버전.
// 스트림릿 send_hw_nightly_sms.py(GitHub Actions로 매일 밤 22시 KST 실행 중,
// 실제 운영 학부모에게 발송)를 그대로 포팅한 것. 로직/문구/건너뛰는 조건을
// 전부 동일하게 맞췄다 — 자세한 원본은 streamlit-app/send_hw_nightly_sms.py
// 참고.
//
// ⚠️⚠️⚠️ 2026-09-04 작성 시점 기준 — 아직 스케줄(pg_cron 등)에 연결 안 됨,
// 코드만 준비된 상태. 이유: 스트림릿 쪽 야간 자동발송이 이미 운영 DB에 연결돼
// 실제로 매일 밤 학부모에게 문자를 보내고 있어서, 지금 이 함수를 그대로
// 스케줄에 걸면 같은 학생에게 문자가 두 번(스트림릿+리액트) 나갈 수 있음.
// → 리액트로 완전히 전환하는 시점(스트림릿 크론을 끄는 시점)에 맞춰서만
// 활성화할 것. 활성화 방법은 이 파일 맨 아래 "활성화 절차" 참고.
//
// 이중 안전장치(코드 레벨) — 둘 다 통과해야 실제 발송이 나간다:
//   1. Supabase Secret `HW_NIGHTLY_SMS_ENABLED`가 정확히 "true"여야 함
//      (등록 안 돼 있거나 다른 값이면 무조건 dry-run으로만 동작 — 아무것도
//      발송 안 하고 "보냈을 대상 목록"만 응답으로 돌려줌).
//   2. 요청 시 dryRun=true를 명시적으로 줘도 강제로 dry-run(테스트용).
// → 이 두 안전장치 덕분에 pg_cron을 먼저 만들어놔도(실행 스케줄만 등록)
//   Secret을 켜기 전까지는 절대 실제 문자가 나가지 않는다.
//
// [트리거 A] 시간표 기반(정규반) — classes.schedule에 "내일 요일"이 있는
//   반의 학생들. 휴원(is_paused)/퇴원(withdrawn_at) 학생은 제외.
// [트리거 B] 마감일 기반(개인과외 등 시간표가 불규칙한 경우) —
//   hw_assignments.due_date가 "내일"인 과제를 가진 학생. (원본과 동일하게
//   이 트리거는 is_paused만 확인하고 withdrawn_at은 확인하지 않음 — 원본의
//   비대칭을 그대로 포팅함. 나중에 고칠지는 별도 논의 필요.)
// 두 트리거는 합쳐지고(중복 제거), 같은 학생이 둘 다 해당하면 트리거 B(마감일)
// 쪽 과제 정보를 우선 사용한다(원본과 동일).
//
// 공통 처리(원본과 동일, RecentAssignmentsPanel/HomeworkCertification.tsx의
// "완료·미완료 문자 발송" 버튼과도 같은 조건):
//   1. 오늘(KST) 이미 발송된 제출(hw_submissions.notified_at)이면 건너뜀.
//   2. 그 제출에 선생님이 아직 확인 안 한 사진(hw_photos.teacher_verified
//      = false)이 하나라도 있으면 건너뜀 — "미완료로 잘못 단정하지 않고
//      그냥 미룬다"는 원칙(사진이 0장이면 이 조건에 안 걸림 — 진짜 미완료
//      로 정상 발송됨).
//   3. 문구는 buildHwSmsText()(src/lib/homework.ts와 동일 로직 — 두 파일이
//      서로 다른 배포 단위라 부득이하게 복사해뒀음, 문구 바꿀 땐 두 곳 다
//      고칠 것)로 만들고, 실제 발송은 이미 배포된 send-sms Edge Function을
//      그대로 호출(Solapi 키를 여기 새로 둘 필요 없음).
//   4. 발송 성공 시 hw_submissions.notified_at 기록 + sms_send_logs(발송
//      내역 화면용)/sms_log(대시보드 KPI용, 테이블 없으면 조용히 무시) 기록.
//
// 이 함수는 다른 academy-web Edge Function들과 달리 DB를 직접 조회해야 해서
// (브라우저 없이 밤에 혼자 실행되므로) supabase-js를 이 함수 안에서만
// 예외적으로 사용한다. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY는 Supabase가
// 모든 Edge Function에 자동으로 넣어주는 값이라 별도 Secret 등록 불필요
// (RLS를 완전히 우회하는 키라 반드시 서버 쪽 이 함수 안에서만 써야 함 —
// 브라우저 코드에는 절대 넣지 말 것).
//
// 배포 방법(코드가 아니라 Supabase 대시보드에서 하는 절차):
//   Supabase 대시보드 → Edge Functions → 새 함수 만들기 → 이름
//   "hw-nightly-sms" → 이 파일 내용을 그대로 붙여넣고 배포(Deploy)
//   (dev/운영 프로젝트 둘 다에 각각 배포해야 함 — 이 프로젝트의 다른
//   Edge Function들과 동일)
//
// 수동 테스트(항상 dry-run으로만, 실제 발송 금지):
//   POST https://<프로젝트>.supabase.co/functions/v1/hw-nightly-sms
//   body: { "dryRun": true }
//   header: Authorization: Bearer <anon 또는 service role key>
//
// ── 활성화 절차(리액트로 완전 전환하는 시점에만, 순서대로) ──
//   1. 운영 프로젝트에 이 함수 배포(위 배포 방법대로).
//   2. 스트림릿 쪽 GitHub Actions 워크플로(.github/workflows/hw_nightly_sms.yml)
//      비활성화(또는 삭제) — 이걸 먼저 꺼야 중복 발송이 안 생김.
//   3. dryRun:true로 최소 한 번 수동 호출해서 "보낼 대상 목록"이 예상과
//      맞는지 확인.
//   4. 운영 Supabase 프로젝트 Secrets에 HW_NIGHTLY_SMS_ENABLED = true 등록.
//   5. 아래 pg_cron 등록 SQL(SQL Editor에서 1회 실행, 매일 KST 22시 =
//      UTC 13:00에 이 함수를 호출하도록 예약)을 실행:
//
//      select cron.schedule(
//        'hw-nightly-sms-daily',
//        '0 13 * * *',
//        $$
//        select net.http_post(
//          url := 'https://<운영-프로젝트-ref>.supabase.co/functions/v1/hw-nightly-sms',
//          headers := jsonb_build_object(
//            'Content-Type', 'application/json',
//            'Authorization', 'Bearer <운영 service_role 키>'
//          ),
//          body := '{}'::jsonb
//        );
//        $$
//      );
//
//      (pg_cron, pg_net extension이 꺼져있으면 먼저 Database → Extensions에서
//      켤 것. 취소하려면: select cron.unschedule('hw-nightly-sms-daily');)
//   6. 등록 후 최소 1~2일은 실제 발송 결과(응답 JSON의 sent/skipped 수)를
//      같이 지켜볼 것 — 스트림릿 쪽과 동일한 원칙.

// @ts-nocheck — Deno 런타임 전역은 이 프로젝트의 브라우저용 TypeScript 설정
// (tsconfig.app.json)에서 타입 정의가 없어 에디터에 빨간 줄이 뜰 수 있음.
// 실제 실행은 Supabase의 Deno 서버에서 되므로 문제 없음.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const HW_SMS_GREETING = '안녕하세요, 수학 정재훈T입니다.';
const KOR_DAYS_BY_JS_DAY = ['일', '월', '화', '수', '목', '금', '토']; // index = getUTCDay() (0=일요일)

/** UTC now + 9시간 = KST 벽시계 값을 담은 Date(내부는 여전히 UTC 기준이지만
 * getUTCFullYear/getUTCMonth/getUTCDate/getUTCDay 등을 쓰면 KST 값이 나옴). */
function kstShifted(d: Date): Date {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000);
}
function dateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function kstNowStr(d: Date): string {
  const s = kstShifted(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())} ${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}`;
}

function parseCompletedPages(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map(Number);
}

interface ItemLite {
  id: number;
  item_type: 'page_range' | 'wrong_note';
  material_name: string;
  page_start: number | null;
  page_end: number | null;
}

interface ItemStateLite {
  itemId: number;
  completedPages: number[];
  status: 'done' | 'incomplete';
}

/**
 * 완료/미완료 요약 문자 문구 — src/lib/homework.ts의 buildHwSmsText()와
 * 완전히 동일한 로직(문구 한 글자도 다르지 않게 유지할 것 — 수동 발송과
 * 야간 자동 발송이 서로 다른 문구를 보내면 안 됨).
 */
function buildHwSmsText(params: {
  studentName: string;
  assignedDate: string;
  title: string;
  itemStates: ItemStateLite[];
  items: ItemLite[];
}): { text: string; allDone: boolean } {
  const { studentName, assignedDate, title, itemStates, items } = params;
  const itemById = new Map(items.map((it) => [it.id, it]));
  const lines: string[] = [];
  let allDone = true;

  for (const state of itemStates) {
    const item = itemById.get(state.itemId);
    if (!item) continue;
    const hasPages = item.item_type === 'page_range' && item.page_start != null && item.page_end != null;
    if (hasPages) {
      const pageStart = item.page_start as number;
      const pageEnd = item.page_end as number;
      const totalPages = pageEnd - pageStart + 1;
      const fullRange = new Set<number>();
      for (let p = pageStart; p <= pageEnd; p += 1) fullRange.add(p);
      const donePages = state.completedPages.filter((p) => fullRange.has(p));
      if (totalPages > 0 && donePages.length >= totalPages) {
        lines.push(`- ${item.material_name}: 완료`);
      } else {
        allDone = false;
        lines.push(`- ${item.material_name}: 미완료(${donePages.length}/${totalPages}쪽)`);
      }
    } else if (state.status === 'done') {
      lines.push(`- ${item.material_name}: 완료`);
    } else {
      allDone = false;
      lines.push(`- ${item.material_name}: 미완료`);
    }
  }

  const overall = allDone ? '완료' : '미완료';
  const text = `${HW_SMS_GREETING}\n${studentName} 학생 ${assignedDate} 과제(${title}) 현황 — ${overall}\n${lines.join('\n')}`;
  return { text, allDone };
}

interface FinalTarget {
  studentId: number;
  className: string;
  name: string;
  parentPhone: string;
  assignmentId: number;
  submissionId: number;
  notifiedAt: string | null;
  title: string;
  assignedDate: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    let body: { dryRun?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      // body 없이 호출(pg_cron 등)해도 정상 — 빈 객체로 취급.
    }
    const url = new URL(req.url);
    const forcedDryRun = body?.dryRun === true || url.searchParams.get('dryRun') === 'true';

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return jsonResponse({ error: 'SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY를 찾을 수 없습니다(Edge Function 환경 문제).' }, 500);
    }

    const enabled = Deno.env.get('HW_NIGHTLY_SMS_ENABLED') === 'true';
    const dryRun = forcedDryRun || !enabled;

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const now = new Date();
    const kstNow = kstShifted(now);
    const todayStr = dateStr(kstNow);
    const tomorrow = new Date(kstNow.getTime() + 24 * 60 * 60 * 1000);
    const targetDate = dateStr(tomorrow);
    const dayKr = KOR_DAYS_BY_JS_DAY[tomorrow.getUTCDay()];

    // ── [트리거 A] 시간표 기반 ──
    const { data: classRows, error: classErr } = await supabase.from('classes').select('id, name, schedule');
    if (classErr) throw classErr;

    const matchingClasses: { id: number; name: string }[] = [];
    for (const c of (classRows as { id: number; name: string; schedule: string | null }[]) ?? []) {
      let slots: { day?: string }[] = [];
      try {
        slots = JSON.parse(c.schedule || '[]');
      } catch {
        slots = [];
      }
      if (Array.isArray(slots) && slots.some((s) => s?.day === dayKr)) {
        matchingClasses.push({ id: c.id, name: c.name });
      }
    }

    const scheduleTargets = new Map<number, { className: string; name: string; parentPhone: string }>();
    if (matchingClasses.length > 0) {
      const classNameById = new Map(matchingClasses.map((c) => [c.id, c.name]));
      const { data: studentRows, error: stuErr } = await supabase
        .from('students')
        .select('id, name, parent_phone, class_id, is_paused, withdrawn_at')
        .in(
          'class_id',
          matchingClasses.map((c) => c.id),
        );
      if (stuErr) throw stuErr;
      for (const s of (studentRows as
        | { id: number; name: string; parent_phone: string | null; class_id: number; is_paused: boolean | null; withdrawn_at: string | null }[]
        | null) ?? []) {
        if (s.is_paused) continue;
        if (s.withdrawn_at) continue;
        if (!s.parent_phone) continue;
        scheduleTargets.set(s.id, {
          className: classNameById.get(s.class_id) ?? '',
          name: s.name,
          parentPhone: s.parent_phone,
        });
      }
    }

    // ── [트리거 B] 마감일 기반 ──
    const { data: dueRows, error: dueErr } = await supabase
      .from('hw_submissions')
      .select(
        `
          id, student_id, notified_at,
          hw_assignments!inner ( id, title, assigned_date, due_date, classes ( name ) ),
          students!inner ( id, name, parent_phone, is_paused )
        `,
      )
      .eq('hw_assignments.due_date', targetDate);
    if (dueErr) throw dueErr;

    const dueTargets = new Map<number, FinalTarget>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of (dueRows as any[]) ?? []) {
      const student = row.students;
      const assignment = row.hw_assignments;
      if (!student || student.is_paused) continue;
      if (!student.parent_phone) continue;
      dueTargets.set(student.id, {
        studentId: student.id,
        className: assignment?.classes?.name ?? '개인과외',
        name: student.name,
        parentPhone: student.parent_phone,
        assignmentId: assignment.id,
        submissionId: row.id,
        notifiedAt: row.notified_at,
        title: assignment.title,
        assignedDate: assignment.assigned_date,
      });
    }

    // ── 두 트리거 합치기(마감일 트리거 우선) ──
    const scheduleOnlyIds = [...scheduleTargets.keys()].filter((id) => !dueTargets.has(id));
    const latestByStudent = new Map<number, FinalTarget>();
    if (scheduleOnlyIds.length > 0) {
      const { data: subRows, error: subErr } = await supabase
        .from('hw_submissions')
        .select(
          `
            id, student_id, notified_at,
            hw_assignments!inner ( id, title, assigned_date )
          `,
        )
        .in('student_id', scheduleOnlyIds);
      if (subErr) throw subErr;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of (subRows as any[]) ?? []) {
        const assignment = row.hw_assignments;
        if (!assignment) continue;
        const prev = latestByStudent.get(row.student_id);
        const isNewer =
          !prev ||
          assignment.assigned_date > prev.assignedDate ||
          (assignment.assigned_date === prev.assignedDate && assignment.id > prev.assignmentId);
        if (isNewer) {
          const info = scheduleTargets.get(row.student_id)!;
          latestByStudent.set(row.student_id, {
            studentId: row.student_id,
            className: info.className,
            name: info.name,
            parentPhone: info.parentPhone,
            assignmentId: assignment.id,
            submissionId: row.id,
            notifiedAt: row.notified_at,
            title: assignment.title,
            assignedDate: assignment.assigned_date,
          });
        }
      }
    }

    const finalTargets: FinalTarget[] = [...dueTargets.values(), ...latestByStudent.values()];

    let sent = 0;
    let skippedNotified = 0;
    let skippedUnverified = 0;
    let failed = 0;
    const details: { name: string; className: string; status: string; reason?: string }[] = [];

    for (const t of finalTargets) {
      if (t.notifiedAt && t.notifiedAt.slice(0, 10) === todayStr) {
        skippedNotified += 1;
        details.push({ name: t.name, className: t.className, status: 'skipped', reason: '오늘 이미 발송됨' });
        continue;
      }

      // 선생님 미확인 사진 게이트
      const { data: itemSubRows, error: isErr } = await supabase
        .from('hw_item_submissions')
        .select('id, status, completed_pages, item_id, hw_photos ( teacher_verified )')
        .eq('submission_id', t.submissionId);
      if (isErr) throw isErr;
      const itemSubs = (itemSubRows as
        | { id: number; status: 'done' | 'not_done'; completed_pages: string | null; item_id: number; hw_photos: { teacher_verified: boolean }[] | null }[]
        | null) ?? [];
      const allPhotos = itemSubs.flatMap((r) => r.hw_photos ?? []);
      const hasUnverified = allPhotos.length > 0 && allPhotos.some((p) => !p.teacher_verified);
      if (hasUnverified) {
        skippedUnverified += 1;
        details.push({ name: t.name, className: t.className, status: 'skipped', reason: '선생님 확인 대기 중' });
        continue;
      }

      const { data: itemRows, error: itErr } = await supabase
        .from('hw_items')
        .select('id, item_type, material_name, page_start, page_end')
        .eq('assignment_id', t.assignmentId);
      if (itErr) throw itErr;

      const itemStates: ItemStateLite[] = itemSubs.map((r) => ({
        itemId: r.item_id,
        completedPages: parseCompletedPages(r.completed_pages),
        status: r.status === 'done' ? 'done' : 'incomplete',
      }));

      const { text, allDone } = buildHwSmsText({
        studentName: t.name,
        assignedDate: t.assignedDate,
        title: t.title,
        itemStates,
        items: (itemRows as ItemLite[]) ?? [],
      });

      if (dryRun) {
        details.push({ name: t.name, className: t.className, status: 'would_send', reason: allDone ? '완료' : '미완료' });
        continue;
      }

      try {
        const smsRes = await fetch(`${SUPABASE_URL}/functions/v1/send-sms`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            apikey: SERVICE_ROLE_KEY,
          },
          body: JSON.stringify({ recipients: [{ name: t.name, phone: t.parentPhone }], text }),
        });
        const smsJson = await smsRes.json().catch(() => null);
        const ok = smsRes.ok && smsJson?.data?.succeeded > 0;

        // 발송 내역 기록(브라우저의 sendBulkSms와 동일한 테이블) — 실패해도 무시.
        try {
          await supabase.from('sms_send_logs').insert({
            recipient_name: t.name,
            recipient_phone: t.parentPhone,
            message: text,
            status: ok ? 'success' : 'failed',
            error_reason: ok ? null : smsJson?.error ?? '전송 실패',
          });
        } catch {
          /* 기록 실패는 무시 — 발송 자체 결과가 우선 */
        }

        if (ok) {
          await supabase.from('hw_submissions').update({ notified_at: kstNowStr(now) }).eq('id', t.submissionId);
          try {
            await supabase.from('sms_log').insert({ kind: 'hw_notify', student_id: t.studentId, sent_at: kstNowStr(now) });
          } catch {
            /* sms_log 테이블이 없을 수도 있음(대시보드 KPI용, 선택 사항) — 무시 */
          }
          sent += 1;
          details.push({ name: t.name, className: t.className, status: 'sent', reason: allDone ? '완료' : '미완료' });
        } else {
          failed += 1;
          details.push({ name: t.name, className: t.className, status: 'failed', reason: smsJson?.error ?? 'SMS 발송 실패' });
        }
      } catch (e) {
        failed += 1;
        details.push({ name: t.name, className: t.className, status: 'failed', reason: e instanceof Error ? e.message : String(e) });
      }
    }

    return jsonResponse({
      dryRun,
      enabledSecretSet: enabled,
      targetDate,
      dayKr,
      totalTargets: finalTargets.length,
      sent,
      skippedNotified,
      skippedUnverified,
      failed,
      details,
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
