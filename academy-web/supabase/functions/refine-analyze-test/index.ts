// Supabase Edge Function: refine-analyze-test
//
// "학원시험 AI분석" 탭의 1b단계(OCR 원문 텍스트 → GPT-4o로 수식 정제 +
// 문항별 단원/풀이유형/난이도 분석) 함수.
//
// 실제 운영 중인 스트림릿 ocr_extract.py의 refine_and_analyze_with_gpt()와
// 같은 일을 함 — 프롬프트(COMBINED_REFINE_ANALYZE_PROMPT)·모델(gpt-4o)·
// 설정(max_tokens: 16000, temperature: 0)을 동일하게 맞춤.
//
// OpenAI API 키는 브라우저에 노출하지 않고 여기(Supabase 서버)에서만 사용함
// — generate-parent-comment 함수와 정확히 같은 원칙, 같은 Secret
// (OPENAI_API_KEY)을 그대로 재사용하므로 이 함수를 위해 새로 등록할 Secret은
// 없음(이미 등록되어 있음).
//
// 배포 방법(코드가 아니라 Supabase 대시보드에서 하는 절차):
//   Supabase 대시보드 → Edge Functions → 새 함수 만들기 → 이름 "refine-analyze-test"
//   → 이 파일 내용을 그대로 붙여넣고 배포(Deploy)
//   (Secret은 이미 있는 OPENAI_API_KEY를 그대로 씀 — 추가 설정 불필요)
//
// 입력: { rawText: string }  — OCR로 추출된 시험지 원문 텍스트 전체(여러 페이지면
//        미리 하나로 합쳐서 보냄, 스트림릿의 "\n\n".join(...)과 동일).
// 출력(성공): {
//   questions: [{ number, topic, method, difficulty, questionType }, ...],
//   refinedText: "수식(LaTeX) 정제된 전체 텍스트"
// }
// 출력(실패): { error: "에러 메시지" }

// @ts-nocheck — Deno 런타임 전역(Deno.serve 등)은 이 프로젝트의 브라우저용
// TypeScript 설정(tsconfig.app.json)에서 타입 정의가 없어 에디터에 빨간 줄이
// 뜰 수 있음. 실제 실행은 Supabase의 Deno 서버에서 되므로 문제 없음.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  rawText: string;
}

interface GptQuestion {
  number: number;
  topic?: string;
  method?: string;
  difficulty?: string;
  question_type?: string;
}

// 스트림릿 COMBINED_REFINE_ANALYZE_PROMPT를 그대로 옮김 — 문항 분석(작업 A)을
// 먼저 쓰게 해서, 문항이 많아 토큰이 모자라도 questions가 아니라 refined_text
// 쪽만 잘리도록 순서를 맞춤(원본과 동일한 이유).
const COMBINED_REFINE_ANALYZE_PROMPT = `당신은 수학 시험지 OCR 전문가이자 수학 교사입니다.
Google Vision OCR로 추출된 시험지 원문 텍스트가 주어집니다.
아래 두 가지 작업을 한 번에 수행하세요.

[작업 A] 문항 분석 (반드시 먼저 완료)
모든 문항을 찾아 단원·풀이유형·난이도·유형을 분석하세요.
- 객관식: "1.", "2)", "01", "02" 등 숫자+구분자 또는 두자리 앞자리0 형태 모두 포함
  (매쓰플랫 등 시험지는 "01", "02" 형태 사용 — 반드시 인식할 것)
- 서술형: "서술형1", "서답형1번", "논술형1." 등 → question_type="서술형"
  → 서술형 번호는 객관식 마지막 번호에 이어서 순번 부여
- 단원: 중학/고1/고2/고3 교육과정 기준
- 풀이유형: "사인·코사인 부등식 동시 조건 추론" 수준으로 구체적으로
- 난이도: A(킬러)~E(쉬움) 5단계
- 문항이 많아도 절대 생략하지 말고 마지막 문항까지 빠짐없이 포함하세요.

[작업 B] 수식 정제 (작업 A를 모두 마친 뒤 작성)
- 수식·분수·지수·근호·부등식을 LaTeX로 표기 (인라인: $...$, 블록: $$...$$)
- OCR 오타만 최소한으로 교정 (내용 추가·삭제 금지)
- 문항 번호, 한글 지문, 선택지 구조는 원문 그대로 유지

반드시 아래 JSON 형식만 반환하세요 (마크다운 펜스 절대 금지).
"questions" 배열을 먼저, "refined_text"를 나중에 작성하세요:
{
  "questions": [
    {
      "number": 1,
      "topic": "삼각함수",
      "method": "사인·코사인 부등식 동시 조건 추론",
      "difficulty": "C",
      "question_type": "객관식"
    }
  ],
  "refined_text": "수식 정제된 전체 텍스트"
}`;

function stripJsonFences(raw: string): string {
  return raw.replace(/```json/g, '').replace(/```/g, '').trim();
}

// GPT 응답이 토큰 한도로 중간에 잘린 경우(문항이 아주 많은 시험지), 마지막으로
// 완전히 닫힌 문항({...},) 뒤에서 잘라내고 배열/객체를 억지로 닫아서 최대한
// 살려냄 — 스트림릿 refine_and_analyze_with_gpt()의 "JSON 잘림 복구"와 동일한
// 아이디어(단, refined_text는 questions 뒤에 오므로 이 복구는 questions까지는
// 보존하고 refined_text만 비어도 괜찮게 처리함).
function recoverTruncatedJson(raw: string): string {
  if (raw.endsWith('}')) return raw;
  const lastComma = raw.lastIndexOf('},');
  if (lastComma !== -1) {
    return `${raw.slice(0, lastComma + 1)}\n  ],\n  "refined_text": ""\n}`;
  }
  return raw;
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
    const rawText = (body.rawText || '').trim();
    if (!rawText) {
      return new Response(JSON.stringify({ error: 'OCR 원문 텍스트가 없습니다.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 16000,
        temperature: 0,
        messages: [
          { role: 'system', content: COMBINED_REFINE_ANALYZE_PROMPT },
          { role: 'user', content: rawText },
        ],
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
    let content: string = (data?.choices?.[0]?.message?.content || '').trim();
    content = stripJsonFences(content);
    content = recoverTruncatedJson(content);

    let parsed: { questions?: GptQuestion[]; refined_text?: string };
    try {
      parsed = JSON.parse(content);
    } catch (_parseErr) {
      return new Response(
        JSON.stringify({ error: 'GPT 응답을 JSON으로 해석하지 못했습니다. 문항 수가 너무 많아 응답이 잘렸을 수 있습니다.' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const questions = (parsed.questions || []).map((q) => ({
      number: Number(q.number),
      topic: (q.topic || '미분류').toString().trim() || '미분류',
      method: (q.method || '').toString().trim(),
      difficulty: (q.difficulty || 'C').toString().trim(),
      questionType: (q.question_type || '객관식').toString().trim(),
    }));

    return new Response(
      JSON.stringify({ questions, refinedText: parsed.refined_text || '' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
