// Supabase Edge Function: hw-reference-url
//
// hw-reference-pdfs 버킷(문제집 원본 PDF)을 비공개로 바꾼 뒤(2026-10-29), 로그인 없이 링크로 들어온
// 학생 화면이 AI 페이지 대조용으로 PDF를 내려받을 수 있게 짧은 서명 주소만 내어준다.
//   • 입력은 업로드 토큰과 PDF 저장 경로. 토큰이 속한 제출의 "그 반"에 등록된 자료의 경로일 때만 응답한다.
//   • 서명 주소는 10분짜리. 실패하면 {url:null}.
// 로그인한 원장님 화면은 이 함수를 쓰지 않고 브라우저에서 직접 서명 주소를 만든다.
//
// 배포: Supabase 대시보드 → Edge Functions → 새 함수 "hw-reference-url" → 이 파일 내용을 붙여넣고 Deploy.
// 호출: supabase.functions.invoke('hw-reference-url', { body: { token, filePath } }).

// @ts-nocheck — Deno 런타임 전역(Deno.serve 등)은 이 프로젝트의 브라우저용 TypeScript 설정에 타입이 없다.

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
    const body = await req.json().catch(() => ({}));
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    const filePath = typeof body?.filePath === 'string' ? body.filePath.trim() : '';
    if (!token || token.length > 64 || !filePath || filePath.length > 300) return jsonResponse({ url: null });

    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return jsonResponse({ url: null });
    const admin = createClient(url, serviceKey);

    const { data: sub } = await admin.from('hw_submissions').select('assignment_id').eq('upload_token', token).maybeSingle();
    if (!sub) return jsonResponse({ url: null });
    const { data: asg } = await admin.from('hw_assignments').select('class_id').eq('id', sub.assignment_id).maybeSingle();
    if (!asg?.class_id) return jsonResponse({ url: null });
    const { data: mat } = await admin
      .from('hw_reference_materials')
      .select('id')
      .eq('class_id', asg.class_id)
      .eq('file_path', filePath)
      .maybeSingle();
    if (!mat) return jsonResponse({ url: null });

    const { data: signed } = await admin.storage.from('hw-reference-pdfs').createSignedUrl(filePath, 600);
    return jsonResponse({ url: signed?.signedUrl ?? null });
  } catch (e) {
    console.warn('[hw-reference-url]', e instanceof Error ? e.message : String(e));
    return jsonResponse({ url: null });
  }
});
