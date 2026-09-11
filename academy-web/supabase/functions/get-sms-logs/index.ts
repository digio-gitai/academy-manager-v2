// Supabase Edge Function: get-sms-logs
//
// "SMS발송" 화면의 "발송 내역" 목록을 서버 쪽(서비스 역할 키)으로 조회해서
// 돌려준다. 2026-09-11: 원래 브라우저에서 anon/publishable 키로 직접
// sms_send_logs를 select했었는데, 이 운영 프로젝트에서는 그 경로(REST Data API,
// anon 키) 자체가 SELECT/INSERT 모두 원인 불명으로 빈 결과만 돌려주는 현상이
// 있음이 확인됨(SQL Editor로 직접 보면 데이터가 정상적으로 존재함 — REST API
// 계층 문제로 추정, send-sms Edge Function과 같은 이유로 서버 경로로 우회).
//
// 입력: { limit?: number }  (기본 50)
// 출력(성공): { data: SmsSendLogRow[] }
// 출력(실패): { error: "에러 메시지" }

// @ts-nocheck — Deno 런타임 전역은 브라우저용 tsconfig에서 타입 정의가 없어
// 에디터에 빨간 줄이 뜰 수 있음. 실제 실행은 Supabase Deno 서버라 문제 없음.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY가 설정되어 있지 않습니다.' }, 500);
    }

    let limit = 50;
    try {
      const body = await req.json();
      if (typeof body?.limit === 'number' && body.limit > 0) {
        limit = Math.min(body.limit, 200);
      }
    } catch {
      // body 없이 호출된 경우 기본값 50 사용.
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await supabase
      .from('sms_send_logs')
      .select('id, recipient_name, recipient_phone, message, status, error_reason, sent_at')
      .order('sent_at', { ascending: false })
      .limit(limit);

    if (error) {
      return jsonResponse({ error: error.message }, 500);
    }

    return jsonResponse({ data: data ?? [] });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
