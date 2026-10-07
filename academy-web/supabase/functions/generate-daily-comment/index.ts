// Supabase Edge Function: generate-daily-comment
//
// 데일리 Diary의 "공지사항 및 전하는 말씀" AI 초안. generate-parent-comment와 같은
// 구조 — OpenAI 키는 브라우저에 두지 않고 이 함수(서버)에서만 사용한다.
//
// 배포 방법: Supabase 대시보드 → Edge Functions → 새 함수 "generate-daily-comment"
//   → 이 파일 내용을 붙여넣고 Deploy. OPENAI_API_KEY Secret은 generate-parent-comment에
//   이미 등록해 둔 것을 그대로 같이 쓴다(프로젝트 단위 Secret).

// @ts-nocheck — Deno 런타임 전역(Deno.serve 등) 타입 정의가 브라우저용 tsconfig에 없음.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) return json({ error: 'OpenAI API 키가 설정되지 않았습니다. Supabase Secrets를 확인해 주세요.' }, 500);

    const body = await req.json();
    const className = String(body.className || '').trim();
    const progress = String(body.progress || '').trim();
    const homework = String(body.homework || '').trim();
    const tags: string[] = Array.isArray(body.tags) ? body.tags.map((t: unknown) => String(t)) : [];

    const studentName = String(body.studentName || '').trim();
    const attendance = String(body.attendance || '').trim(); // present/late/absent
    const hwPerformance = String(body.hwPerformance || '').trim(); // 상/중/하
    const attLabel = { present: '출석', late: '지각', absent: '결석' }[attendance] || '';

    const prompt = studentName
      ? `학원 수학 강사가 수업이 끝난 뒤 한 학생의 학부모님께 보내는 "수업 Diary"의
'공지사항 및 전하는 말씀'을 작성해주세요. 이 학생 한 명에게만 나가는 글입니다.

[학생] ${studentName}
[반] ${className || '정보 없음'}
[출결] ${attLabel || '정보 없음'}
[과제 수행도] ${hwPerformance || '정보 없음'}
[오늘 이 학생 진도] ${progress || '정보 없음'}
[이 학생 과제] ${homework || '정보 없음'}
[선생님이 고른 이 학생 특징] ${tags.length ? tags.join(', ') : '특별히 선택한 항목 없음'}

[작성 조건]
1. 2~3문장, 150자 이내로 간결하게
2. 학생 이름을 한 번 자연스럽게 넣고, 위 정보 범위 안에서 오늘 모습과 과제·다음 수업 준비를 구체적으로 언급
3. 결석이면 질책하지 말고 수업 내용을 어떻게 보충할지 가볍게 안내
4. 따뜻하고 신뢰감 있는 존댓말, 인사말 없이 바로 내용부터 시작
5. 위에 없는 사실(점수, 다른 학생 이야기, 날짜 등)은 절대 지어내지 마세요`
      : `학원 수학 강사가 수업이 끝난 뒤 반 학생들의 학부모님께 보내는 "수업 Diary"의
'공지사항 및 전하는 말씀'을 작성해주세요. 반 전체에 똑같이 나가는 글입니다.

[반] ${className || '정보 없음'}
[오늘 진도] ${progress || '정보 없음'}
[다음 과제] ${homework || '정보 없음'}
[오늘 수업 분위기/특징] ${tags.length ? tags.join(', ') : '특별히 선택한 항목 없음'}

[작성 조건]
1. 2~3문장, 150자 이내로 간결하게
2. 오늘 수업의 특징과 과제 안내 또는 다음 수업 준비 사항을 자연스럽게 포함
3. 따뜻하고 신뢰감 있는 존댓말, 인사말 없이 바로 내용부터 시작
4. 위에 없는 사실(점수, 특정 학생 이야기, 날짜 등)은 절대 지어내지 마세요
5. 특정 학생이 아니라 반 전체에 해당하는 표현만 사용`;

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.7,
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      return json({ error: `OpenAI 호출 실패 (${resp.status}): ${t.slice(0, 300)}` }, 502);
    }
    const data = await resp.json();
    const comment = (data?.choices?.[0]?.message?.content || '').trim();
    if (!comment) return json({ error: 'OpenAI 응답에 내용이 없습니다.' }, 502);
    return json({ comment });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
