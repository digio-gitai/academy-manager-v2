// Supabase Edge Function: refine-analyze-test
//
// "학원시험 AI분석" 탭의 1b단계(OCR 원문 텍스트 → GPT-4o로 수식 정제 +
// 문항별 단원/풀이유형/난이도 분석) 함수.
//
// 2026-08-28 재설계: 처음엔 스트림릿 ocr_extract.py의 refine_and_analyze_with_gpt()처럼
// "문항 분석 + 수식 정제"를 GPT 한 번 호출로 같이 처리했는데, 문항이 많은
// 시험지(예: 28문항)에서 응답이 너무 길어져 JSON이 깨지는 문제가 실제로
// 발생함(사용자 실사용 중 발견). 원인: 수식(LaTeX) 정제 텍스트가 아주 길어질
// 수 있는데, 그걸 JSON 문자열 안에 욱여넣다 보니 토큰 한도 초과로 잘리거나
// 백슬래시(`\`) 이스케이프가 깨짐. (참고: 스트림릿도 똑같은 구조라 같은
// 위험이 있고, 거기도 "JSON 잘림 복구" 코드가 있음 — 이번 기회에 React
// 쪽은 원본보다 더 안전하게 개선함, 사용자 확인 후 진행.)
//
// 그래서 GPT 요청을 2번으로 분리:
//   ① 문항 분석만 (단원/풀이유형/난이도/유형) — response_format: json_object로
//      OpenAI가 문법적으로 올바른 JSON만 반환하도록 강제. 출력이 짧아서
//      (문항 메타데이터만) 잘릴 위험이 훨씬 낮음.
//   ② 수식 정제만 — JSON이 아니라 순수 텍스트로 그대로 반환받음. JSON 문자열
//      안에 안 넣으니 백슬래시 이스케이프 문제 자체가 생기지 않음.
// 두 요청은 동시에(Promise.all) 보내서 전체 속도 저하를 최소화함.
//
// OpenAI API 키는 브라우저에 노출하지 않고 여기(Supabase 서버)에서만 사용함
// — generate-parent-comment 함수와 정확히 같은 원칙, 같은 Secret
// (OPENAI_API_KEY)을 그대로 재사용하므로 이 함수를 위해 새로 등록할 Secret은
// 없음(이미 등록되어 있음).
//
// 배포 방법(코드가 아니라 Supabase 대시보드에서 하는 절차):
//   Supabase 대시보드 → Edge Functions → refine-analyze-test → 편집 화면 열기
//   → 이 파일 내용 전체로 교체 → Deploy
//   (Secret은 이미 있는 OPENAI_API_KEY를 그대로 씀 — 추가 설정 불필요)
//
// 입력: { rawText: string }  — OCR로 추출된 시험지 원문 텍스트 전체(여러 페이지면
//        미리 하나로 합쳐서 보냄, 스트림릿의 "\n\n".join(...)과 동일).
// 출력(성공): {
//   questions: [{ number, topic, method, difficulty, questionType, cognitiveDomain }, ...],
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
  cognitive_domain?: string;
}

// 요청 ①: 문항 분석 전용(스트림릿 TOPIC_ANALYSIS_SYSTEM_PROMPT와 동일 내용).
// response_format: json_object를 쓰므로 OpenAI가 항상 문법적으로 올바른
// JSON을 반환함이 보장됨(단, 내용이 프롬프트 지시와 다를 수는 있음 — 그건
// 프롬프트 품질의 문제이지 JSON 파싱 실패의 문제는 아님).
const TOPIC_ANALYSIS_PROMPT = `당신은 수학 시험지 OCR 텍스트를 분석하는 전문 교사입니다.
시험지 전체 OCR 텍스트가 주어집니다. 아래 작업을 수행하세요.

[작업 1] 모든 문항을 찾아내세요.
- 객관식: "1.", "2)", "문1." 등 숫자+구분자 패턴
  → 매쓰플랫 등 시험지는 "01", "02", "03" 형태(앞에 0이 붙는 두자리) 사용 — 반드시 인식할 것
- 주관식/서술형: "서술형1", "서답형 1번", "논술형1.", "단답형 1번" 등
  → 이런 문항은 question_type을 "서술형"으로 표시
  → 번호는 앞 객관식 마지막 번호에 이어서 순번 부여
    (예: 객관식이 16번까지면 서술형1→17, 서술형2→18)

[작업 2] 각 문항의 단원명을 분석하세요.
- "통계", "함수", "도형" 같은 큰 분류가 아니라, 실제 교과서·교육과정에서 쓰는
  구체적인 소단원명으로 작성하세요.
  좋은 예: "대푯값과 산포도", "이차방정식과 이차함수의 관계", "삼각비의 활용",
  "로그함수의 그래프", "등차수열과 등비수열", "원과 직선"
  나쁜 예(너무 뭉뚱그림): "통계", "함수", "도형", "수학"
- 참고할 학년별 대분류(이 단어를 그대로 쓰지 말고, 문항 내용에 맞는 더
  구체적인 소단원명으로 좁혀서 작성):
  중학 — 다항식 연산, 인수분해, 방정식, 함수와 그래프, 도형의 성질, 확률과 통계
  고1 — 다항식, 방정식과 부등식, 도형의 방정식, 집합과 명제, 함수
  고2 — 지수·로그함수, 삼각함수, 수열, 미분, 적분
  고3(수능) — 극한, 미분법, 적분법, 수열의 극한, 지수·로그, 삼각함수의 활용

[작업 3] 각 문항의 풀이유형을 구체적으로 작성하세요.
- 절대로 "조건 추론", "계산", "설명 선택", "값 계산" 처럼 어떤 문제에나 붙일 수
  있는 뭉뚱그린 표현을 쓰지 마세요. 반드시 그 문항 고유의 핵심 풀이 과정이
  드러나야 합니다.
- 나쁜 예: "조건 추론", "계산", "설명 선택", "성질 판단"
- 좋은 예: "사인·코사인 부등식 동시 조건 추론", "표준편차 공식으로 자료 흩어진 정도 비교",
  "평균·중앙값·최빈값 대소 관계로 참/거짓 판단", "지수방정식 치환 후 근의 개수 분석"
- 문항 텍스트(선택지 내용까지)를 실제로 읽고, 그 문항에서만 쓰이는 핵심 풀이
  과정을 15~20자 내외로 구체적으로 작성하세요.

[작업 4] 난이도를 분석하세요.
- A: 킬러문항 (최상, 복합개념+고난도 추론, 배점 5~6점)
- B: 준킬러 (상, 복합개념 적용, 배점 4~5점)
- C: 표준 (중, 개념 직접 적용, 배점 3~4점)
- D: 기본 (하, 공식 대입, 배점 2~3점)
- E: 쉬움 (최하, 단순 계산, 배점 2점 이하)

[작업 5] 인지영역을 분류하세요.
- 이 문항을 풀 때 학생에게 가장 핵심적으로 요구되는 사고 능력이 무엇인지
  아래 4개 중 하나로 분류하세요(난이도와는 다른 기준입니다 — 쉬운 문항도
  "추론"일 수 있고, 어려운 문항도 "계산"일 수 있습니다).
- 계산: 공식·연산 과정을 정확히 수행하는 능력이 핵심(예: 전개, 인수분해,
  대입 계산, 방정식 풀이 과정 자체)
- 이해: 개념·정의를 올바르게 알고 있는지가 핵심(예: 용어의 뜻, 그래프의
  의미, 공식이 성립하는 조건 이해)
- 추론: 주어진 조건들을 논리적으로 연결해 결론을 이끌어내는 능력이 핵심
  (예: 조건 여러 개를 종합, 참/거짓 판단, 경우의 수 나누기)
- 해결: 실생활 맥락이나 복합 상황을 수식으로 옮기고 전체 풀이 전략을 세우는
  능력이 핵심(예: 문장제, 여러 단원 개념을 합쳐 새로운 풀이 경로를 설계)

문항이 많아도 절대 생략하지 말고 마지막 문항까지 빠짐없이 포함하세요.
반드시 아래 JSON 형식으로만 반환하세요:
{
  "questions": [
    {
      "number": 1,
      "topic": "삼각함수의 그래프와 성질",
      "method": "사인·코사인 부등식 동시 조건 추론",
      "difficulty": "C",
      "question_type": "객관식",
      "cognitive_domain": "추론"
    }
  ]
}`;

// 요청 ②: 수식 정제 전용. JSON이 아니라 순수 텍스트로 그대로 받음 — 그래서
// 수식의 백슬래시(`\frac`, `\times` 등)를 JSON 문자열 안에 이스케이프해서
// 넣을 필요가 없어지고, 그 과정에서 생기던 파싱 실패 위험이 원천적으로 사라짐.
const REFINE_TEXT_PROMPT = `당신은 수학 시험지 OCR 전문가입니다.
Google Vision OCR로 추출된 시험지 원문 텍스트가 주어집니다.
다음 작업만 수행하세요.

- 수식·분수·지수·근호·부등식을 LaTeX로 표기 (인라인: $...$, 블록: $$...$$)
- OCR 오타만 최소한으로 교정 (내용 추가·삭제 금지)
- 문항 번호, 한글 지문, 선택지 구조는 원문 그대로 유지
- 문항이 많아도 절대 생략하지 말고 마지막 문항까지 빠짐없이 포함하세요.

다른 설명이나 안내 문구 없이, 정제된 시험지 전체 텍스트만 그대로 출력하세요.
JSON이나 마크다운 코드블록(\`\`\`)으로 감싸지 마세요 — 그냥 텍스트만 출력하세요.`;

function stripFences(raw: string): string {
  return raw.replace(/```json/g, '').replace(/```/g, '').trim();
}

// GPT가 json_object 모드에서도 아주 드물게 토큰 한도로 중간에 잘릴 수 있음
// (문항이 극단적으로 많은 경우) — 마지막으로 완전히 닫힌 문항({...},) 뒤에서
// 잘라내고 배열/객체를 억지로 닫아서 최대한 살려냄.
function recoverTruncatedQuestionsJson(raw: string): string {
  if (raw.endsWith('}')) return raw;
  const lastComma = raw.lastIndexOf('},');
  if (lastComma !== -1) {
    return `${raw.slice(0, lastComma + 1)}\n  ]\n}`;
  }
  return raw;
}

// 그마저도 실패하면(전체 JSON 구조 자체가 깨짐), 문항 하나하나(단순 평평한
// 객체라 개별적으로는 유효한 JSON일 가능성이 높음)를 정규식으로 따로따로
// 찾아 파싱 시도 — 최대한 살려냄.
function extractQuestionsFallback(raw: string): GptQuestion[] {
  const marker = raw.search(/"questions"\s*:\s*\[/);
  if (marker === -1) return [];
  const segment = raw.slice(marker);
  const candidates = segment.match(/\{[^{}]*\}/g) || [];
  const results: GptQuestion[] = [];
  for (const candidate of candidates) {
    try {
      results.push(JSON.parse(candidate));
    } catch {
      // 이 문항 조각도 깨져 있으면 그냥 건너뜀 — 나머지라도 살림.
    }
  }
  return results;
}

async function callOpenAiJson(apiKey: string, systemPrompt: string, userText: string) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 16000,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenAI 호출 실패 (${resp.status}): ${errText.slice(0, 300)}`);
  }
  const data = await resp.json();
  return ((data?.choices?.[0]?.message?.content as string) || '').trim();
}

async function callOpenAiText(apiKey: string, systemPrompt: string, userText: string) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 16000,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenAI 호출 실패 (${resp.status}): ${errText.slice(0, 300)}`);
  }
  const data = await resp.json();
  return ((data?.choices?.[0]?.message?.content as string) || '').trim();
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

    // ①(문항 분석)과 ②(수식 정제)를 동시에 호출 — 서로 독립적인 작업이라
    // 순서대로 기다릴 필요가 없음. 하나가 실패해도 나머지 하나가 얻어낸
    // 결과는 최대한 살려서 돌려줌(allSettled).
    const [questionsResult, refinedResult] = await Promise.allSettled([
      callOpenAiJson(apiKey, TOPIC_ANALYSIS_PROMPT, rawText),
      callOpenAiText(apiKey, REFINE_TEXT_PROMPT, rawText),
    ]);

    if (questionsResult.status === 'rejected') {
      return new Response(
        JSON.stringify({ error: `문항 분석 요청 실패: ${questionsResult.reason instanceof Error ? questionsResult.reason.message : String(questionsResult.reason)}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let content = stripFences(questionsResult.value);
    content = recoverTruncatedQuestionsJson(content);

    let parsed: { questions?: GptQuestion[] } | null = null;
    let partial = false;
    try {
      parsed = JSON.parse(content);
    } catch (_parseErr) {
      const fallbackQuestions = extractQuestionsFallback(content);
      if (fallbackQuestions.length === 0) {
        return new Response(
          JSON.stringify({ error: 'GPT 문항 분석 응답을 JSON으로 해석하지 못했습니다.' }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      parsed = { questions: fallbackQuestions };
      partial = true;
    }

    const questions = (parsed.questions || []).map((q) => ({
      number: Number(q.number),
      topic: (q.topic || '미분류').toString().trim() || '미분류',
      method: (q.method || '').toString().trim(),
      difficulty: (q.difficulty || 'C').toString().trim(),
      questionType: (q.question_type || '객관식').toString().trim(),
      cognitiveDomain: (q.cognitive_domain || '미분류').toString().trim() || '미분류',
    }));

    // 수식 정제(②)는 실패해도 문항 분석(①) 결과는 그대로 돌려줌 — 정제된
    // 텍스트만 빈 문자열로 두고, partial 표시로 화면에 안내.
    let refinedText = '';
    if (refinedResult.status === 'fulfilled') {
      refinedText = stripFences(refinedResult.value);
    } else {
      partial = true;
    }

    return new Response(
      JSON.stringify({ questions, refinedText, partial }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
