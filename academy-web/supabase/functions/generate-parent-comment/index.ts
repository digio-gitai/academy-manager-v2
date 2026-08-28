// Supabase Edge Function: generate-parent-comment
//
// "학부모님께 전하는 글" AI 초안을 만드는 함수. 브라우저(React)에서 직접
// OpenAI API 키를 쓰면 그 키가 그대로 노출되기 때문에(개발자도구로 누구나
// 꺼내볼 수 있음), 이 함수처럼 Supabase 서버 쪽에서만 실행되는 곳에
// OPENAI_API_KEY를 비밀로 저장해두고, React는 이 함수만 호출한다.
// (프로젝트 원칙 "실제 외부 API를 브라우저에서 직접 호출하지 않는다"와 동일한 이유
//  — 과제 인증의 Solapi SMS와 같은 패턴.)
//
// 스트림릿 app.py의 _generate_parent_comment_ai()와 프롬프트/모델/설정을
// 동일하게 맞춤(model: gpt-4o, max_tokens: 400, temperature: 0.7).
//
// 배포 방법(코드가 아니라 Supabase 대시보드에서 하는 절차):
//   Supabase 대시보드 → Edge Functions → 새 함수 만들기 → 이름 "generate-parent-comment"
//   → 이 파일 내용을 그대로 붙여넣고 배포(Deploy)
//   → Project Settings → Edge Functions → Secrets 에서
//     OPENAI_API_KEY = (기존에 쓰던 OpenAI 키 값) 추가

// @ts-nocheck — Deno 런타임 전역(Deno.serve 등)은 이 프로젝트의 브라우저용
// TypeScript 설정(tsconfig.app.json)에서 타입 정의가 없어 에디터에 빨간 줄이
// 뜰 수 있음. 실제 실행은 Supabase의 Deno 서버에서 되므로 문제 없음.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExamSummary {
  label: string;
  score: number;
}

interface RequestBody {
  studentName: string;
  exams: ExamSummary[];
}

function buildPrompt(studentName: string, exams: ExamSummary[]): string {
  const examsText =
    exams.length > 0
      ? exams.map((e) => `- ${e.label}: ${e.score.toFixed(1)}점`).join('\n')
      : '시험 정보 없음';
  const scores = exams.map((e) => e.score);
  const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const max = scores.length > 0 ? Math.max(...scores) : 0;
  const min = scores.length > 0 ? Math.min(...scores) : 0;

  return `학원 수학 강사로서 학부모님께 보내는 학습 상담 메시지를 작성해주세요.

[학생 정보]
- 학생 이름: ${studentName}
- 평균 점수: ${avg.toFixed(1)}점 / 최고: ${max.toFixed(1)}점 / 최저: ${min.toFixed(1)}점

[시험 성적]
${examsText}

[작성 조건]
1. 시험 난이도와 학생 수준을 점수 기반으로 분석해주세요
2. 학생의 현재 수준과 부족한 부분을 구체적으로 언급해주세요
3. 앞으로 어떤 학습을 시킬 것인지 계획을 포함해주세요
4. 학부모님께 전달하는 따뜻하고 전문적인 톤으로 작성해주세요
5. 반드시 300자 이내로 작성 (A4 레이아웃 고려)
6. 인사말 없이 바로 내용부터 시작해주세요`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'OpenAI API 키가 설정되지 않았습니다. Supabase 대시보드에서 Secrets를 확인해 주세요.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const body = (await req.json()) as RequestBody;
    const studentName = (body.studentName || '').trim();
    const exams = Array.isArray(body.exams) ? body.exams : [];
    if (!studentName) {
      return new Response(JSON.stringify({ error: '학생 이름이 필요합니다.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const prompt = buildPrompt(studentName, exams);

    const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 400,
        temperature: 0.7,
      }),
    });

    if (!openaiResp.ok) {
      const errText = await openaiResp.text();
      return new Response(
        JSON.stringify({ error: `OpenAI 호출 실패 (${openaiResp.status}): ${errText.slice(0, 300)}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const data = await openaiResp.json();
    const comment = (data?.choices?.[0]?.message?.content || '').trim();
    if (!comment) {
      return new Response(JSON.stringify({ error: 'OpenAI 응답에 내용이 없습니다.' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ comment }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
