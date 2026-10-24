// Supabase Edge Function: hw-upload-notify
//
// 학생이 과제 인증 사진을 제출하면 원장님께 가는 알림 문자(2026-10-24 신설).
// 예전에는 학생 화면(AssignmentUpload)이 로그인 없이 send-sms를 직접 불러서, 웹앱의 공개 키만
// 있으면 누구나 같은 방법으로 아무에게나 문자를 보낼 수 있었다 — send-sms는 이제 로그인한
// 열쇠 계정(또는 서버끼리의 호출)만 받고, 학생 화면은 이 함수만 부른다.
//
// 이 함수가 하는 일 — 학생 화면이 보내는 값은 업로드 토큰 하나뿐이고, 나머지는 전부 서버가 정한다:
//   • 토큰이 맞는 제출인지 확인하고, 방금(15분 안에) 제출된 것일 때만 알린다.
//   • 문자 내용은 DB의 학생·반·과제 정보로 서버가 만든다(학생 화면이 내용을 정하지 못함).
//   • 받는 사람은 원장님 번호 하나로 고정(Secret TEACHER_NOTIFY_PHONE, 없으면 아래 기본값).
//   • 같은 내용은 10분에 한 번만, 전체는 한 시간에 40통까지만 보낸다(반복 호출·악용 방지).
//   • 실패해도 학생 제출에는 영향이 없다 — 항상 200으로 {ok:true|false}만 돌려준다.
//
// 배포: Supabase 대시보드 → Edge Functions → 새 함수 "hw-upload-notify" → 이 파일 내용을 붙여넣고 Deploy.
// 호출: 학생 화면이 supabase.functions.invoke('hw-upload-notify', { body: { token } }).

// @ts-nocheck — Deno 런타임 전역(Deno.serve 등)은 이 프로젝트의 브라우저용 TypeScript 설정에 타입이 없다.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// 원장님 알림 번호. 운영에서는 Supabase Secret TEACHER_NOTIFY_PHONE으로 바꿀 수 있다.
const TEACHER_PHONE = Deno.env.get('TEACHER_NOTIFY_PHONE') ?? '010-9655-3089';

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function cleanPhone(phone: string): string {
  return (phone || '').replace(/[^0-9]/g, '');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    if (!token || token.length > 64) return jsonResponse({ ok: false, reason: 'bad token' });

    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return jsonResponse({ ok: false, reason: 'not configured' });
    const admin = createClient(url, serviceKey);

    // 1) 토큰이 맞는 제출이고 방금 제출된 것인지 확인
    const { data: sub } = await admin
      .from('hw_submissions')
      .select('id, assignment_id, student_id, submitted_at')
      .eq('upload_token', token)
      .maybeSingle();
    if (!sub || !sub.submitted_at) return jsonResponse({ ok: false, reason: 'no submission' });
    const submittedMs = Date.parse(String(sub.submitted_at).replace(' ', 'T') + ':00+09:00');
    if (!Number.isFinite(submittedMs) || Date.now() - submittedMs > 15 * 60 * 1000) {
      return jsonResponse({ ok: false, reason: 'stale' });
    }

    // 2) 문자 내용은 서버가 만든다 — 학생·반·과제 이름과 완료 항목 수
    const { data: asg } = await admin.from('hw_assignments').select('title, class_id').eq('id', sub.assignment_id).maybeSingle();
    const { data: st } = await admin.from('students').select('name').eq('id', sub.student_id).maybeSingle();
    const { data: cls } = asg?.class_id
      ? await admin.from('classes').select('name').eq('id', asg.class_id).maybeSingle()
      : { data: null };
    const { data: tgt } = await admin
      .from('hw_assignment_targets')
      .select('include_common')
      .eq('assignment_id', sub.assignment_id)
      .eq('student_id', sub.student_id)
      .maybeSingle();
    const includeCommon = (tgt?.include_common ?? true) !== false;

    const { data: itemRows } = await admin
      .from('hw_items')
      .select('id, student_id')
      .eq('assignment_id', sub.assignment_id)
      .or(`student_id.is.null,student_id.eq.${sub.student_id}`);
    const items = (itemRows ?? []).filter((it) => includeCommon || it.student_id != null);
    const { data: itemSubs } = await admin.from('hw_item_submissions').select('item_id, status').eq('submission_id', sub.id);
    const doneIds = new Set((itemSubs ?? []).filter((r) => r.status === 'done').map((r) => r.item_id));
    const doneCount = items.filter((it) => doneIds.has(it.id)).length;

    const title = asg?.title ? ` · ${asg.title}` : '';
    const text = `[과제인증] ${st?.name ?? '학생'} 학생이 업로드했습니다.\n반: ${cls?.name ?? ''}${title}\n항목 ${doneCount}/${items.length} 완료`;

    // 3) 반복·남용 방지 — 같은 내용은 10분에 한 번, 전체는 한 시간에 40통까지
    const phone = cleanPhone(TEACHER_PHONE);
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: sameCount } = await admin
      .from('sms_send_logs')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_phone', phone)
      .eq('message', text)
      .gte('sent_at', tenMinAgo);
    if ((sameCount ?? 0) > 0) return jsonResponse({ ok: false, reason: 'duplicate' });
    const { count: hourCount } = await admin
      .from('sms_send_logs')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_phone', phone)
      .like('message', '[과제인증]%')
      .gte('sent_at', hourAgo);
    if ((hourCount ?? 0) >= 40) return jsonResponse({ ok: false, reason: 'rate limited' });

    // 4) 실제 발송은 send-sms에 서버 전용 키로 맡긴다(Solapi 키는 그쪽에만 있다)
    const smsRes = await fetch(`${url}/functions/v1/send-sms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify({ recipients: [{ name: '원장님', phone: TEACHER_PHONE }], text }),
    });
    const smsJson = await smsRes.json().catch(() => null);
    return jsonResponse({ ok: smsRes.ok && (smsJson?.data?.succeeded ?? 0) > 0 });
  } catch (e) {
    console.warn('[hw-upload-notify]', e instanceof Error ? e.message : String(e));
    return jsonResponse({ ok: false, reason: 'error' });
  }
});
