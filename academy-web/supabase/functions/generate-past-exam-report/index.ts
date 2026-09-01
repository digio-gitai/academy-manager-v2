// Supabase Edge Function: generate-past-exam-report
//
// "기출문제분석" 화면의 핵심 함수. 학교 기출 시험지(OCR로 이미 텍스트 추출된
// 상태)를 GPT-4o에 보내서, 5페이지 분석 보고서를 만드는 데 필요한 구조화된
// JSON 데이터(기본정보/출제경향/문항별분석/핵심문항/차트데이터/등급컷/
// 등급별전략/6주플랜/학부모조언)를 한 번에 받아온다.
//
// 스트림릿 past_exam_analyzer.py의 JSON_SYSTEM_PROMPT를 그대로(글자 하나
// 안 틀리고) 이식함 — Python 소스에서 JSON_SYSTEM_PROMPT 변수만 별도로
// exec해서 실제 런타임 문자열 값을 뽑아낸 뒤, JSON 인코딩을 거쳐 그대로
// 옮겼음(이스케이프까지 100% 동일하게 보존하기 위함).
//
// 원본과 다른 점(2026-09-01, 이 프로젝트의 기존 원칙 적용):
// - 원본은 response_format 없이 GPT 응답을 수동으로 파싱(코드펜스 제거 +
//   정규식 복구)했지만, 여기서는 response_format: json_object를 써서 문법
//   오류 자체를 원천 차단함(학원시험 AI분석 때 확립한 원칙, GPT 응답 JSON
//   깨짐 문제를 겪은 뒤 적용하기 시작함).
// - max_tokens을 4096 → 16000으로 올림 — 이 스키마가 questions/key_questions/
//   weekly_plan 등 항목이 많아 원본보다 훨씬 길어질 수 있어서 넉넉하게 잡음.
// - "API 키 없으면 데모 데이터로 대체"하는 원본의 폴백은 이식하지 않음 —
//   여기(Edge Function)는 항상 실제 키로만 호출되므로 불필요.
//
// OpenAI API 키는 브라우저에 노출하지 않고 여기(Supabase 서버)에서만 사용함
// — generate-parent-comment/refine-analyze-test와 동일한 원칙, 같은 Secret
// (OPENAI_API_KEY)을 그대로 재사용하므로 이 함수를 위해 새로 등록할 Secret은
// 없음(이미 등록되어 있음).
//
// 배포 방법(코드가 아니라 Supabase 대시보드에서 하는 절차):
//   Supabase 대시보드 → Edge Functions → 새 함수 만들기
//   → 이름을 정확히 generate-past-exam-report로 지정
//   → 이 파일 내용 전체를 붙여넣기 → Deploy
//   (Secret은 이미 있는 OPENAI_API_KEY를 그대로 씀 — 추가 설정 불필요)
//
// 입력: { schoolName: string, examText: string }
//   examText는 OCR로 이미 추출된 시험지 전체 텍스트(여러 페이지/여러 파일이면
//   미리 하나로 합쳐서 보냄 — 학원시험 AI분석의 rawText와 동일한 개념).
// 출력(성공): { data: <위 스키마의 큰 JSON 객체> }
// 출력(실패): { error: "에러 메시지" }

// @ts-nocheck — Deno 런타임 전역(Deno.serve 등)은 이 프로젝트의 브라우저용
// TypeScript 설정(tsconfig.app.json)에서 타입 정의가 없어 에디터에 빨간 줄이
// 뜰 수 있음. 실제 실행은 Supabase의 Deno 서버에서 되므로 문제 없음.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  schoolName: string;
  examText: string;
}

const JSON_SYSTEM_PROMPT = "당신은 한국 수학 시험지 심층 분석 전문가입니다.\n아래 시험지 텍스트를 분석하여 **JSON 데이터만** 반환하세요.\nHTML·마크다운·설명 텍스트 없이 순수 JSON만 출력하세요.\n\n## 반환 JSON 스키마\n\n{\n  \"basic_info\": {\n    \"school\": \"학교명 및 학년 (예: 장충고등학교 고2)\",\n    \"exam_type\": \"시험 종류 (예: 1학기 중간고사 대수)\",\n    \"exam_date\": \"시험 날짜 (예: 2026년 04월 28일)\",\n    \"total_questions\": 23,\n    \"obj_count\": 19,\n    \"sub_count\": 4,\n    \"total_score\": 100,\n    \"scope_tags\": [\"지수와 로그\", \"지수·로그함수\", \"삼각함수\", \"실생활 응용\"]\n  },\n  \"trend\": {\n    \"summary\": \"출제 경향 전체 요약 — 4~5문장, 구체적 단원명과 출제 방식 포함\",\n    \"bullets\": [\n      \"구체적 특징 1 (단원명·문항번호 포함)\",\n      \"구체적 특징 2\",\n      \"구체적 특징 3\",\n      \"구체적 특징 4\"\n    ],\n    \"difficulty_level\": \"중상\",\n    \"killer_questions\": \"18번 (로그 부등식 정수 개수), 서술형4 (삼각함수 부등식)\",\n    \"variable_factors\": \"역함수·그래프 대칭성 파악, 복합 연산 처리 능력, 서술형 정확한 풀이 과정 서술 능력\",\n    \"composition_detail\": \"선택형 19문항·서술형 4문항으로 구성. 전반부(1~10번)는 기본 계산 위주, 후반부(11~19번)와 서술형에 고난도 집중. 지수와 로그 35%, 지수·로그함수 30%, 삼각함수 20%, 실생활 응용 15% 비중.\",\n    \"type_obj_pct\": 68,\n    \"type_sub_pct\": 32,\n    \"obj_rate\": 58,\n    \"sub_rate\": 38,\n    \"type_bar_note\": \"후반부 객관식과 서술형에서 복합 개념 요구가 높아 정답률이 낮게 나타납니다.\"\n  },\n  \"questions\": [\n    {\n      \"num\": \"1\",\n      \"type\": \"객관\",\n      \"concept\": \"지수의 연산\",\n      \"summary\": \"5⁴×5⁻² 지수 연산 기본 계산\",\n      \"difficulty\": \"하\",\n      \"correct_rate\": 92\n    }\n  ],\n  \"key_questions\": [\n    {\n      \"num\": \"18\",\n      \"emoji\": \"🔢\",\n      \"title\": \"로그 부등식 — 정수 x의 개수 조건\",\n      \"tag_class\": \"tag-killer\",\n      \"tag_label\": \"최상\",\n      \"point\": \"x²−x·log₃3n+log₃n≤0을 만족하는 정수 x의 개수가 정확히 3이 되도록 하는 자연수 n의 개수를 구하는 문제입니다. A=log₃n으로 치환 후 이차부등식의 근 사이 정수 개수를 분석해야 합니다.\",\n      \"why_hard\": \"A=log₃n 치환 후 두 근 사이에 정수 x가 정확히 3개가 되는 A 범위를 설정하고, 이를 다시 n 범위로 역변환하는 이중 치환 과정이 복잡합니다.\",\n      \"concepts\": [\"이차부등식의 해 (두 근의 위치)\", \"로그를 이용한 치환 (A=log₃n)\", \"근과 계수의 관계\"],\n      \"steps\": [\n        \"A=log₃n으로 치환 → x²−x(A+1)+A≤0 변환\",\n        \"인수분해: (x−1)(x−A)≤0 → 두 근은 1과 A\",\n        \"두 근 사이 정수가 3개인 A의 범위 탐색\",\n        \"A=log₃n의 범위를 n 범위로 역변환 후 자연수 n 개수 산출\"\n      ]\n    }\n  ],\n  \"charts\": {\n    \"domain_labels\": [\"지수와 로그\", \"지수·로그함수\", \"삼각함수\", \"실생활·추론\"],\n    \"domain_rates\": [72, 48, 55, 40],\n    \"diff_low_pct\": 9,\n    \"diff_mid_pct\": 39,\n    \"diff_high_pct\": 52,\n    \"grade_dist\": [10, 24, 32, 24, 10]\n  },\n  \"grade_cuts\": [\n    {\"grade\": 1, \"badge_class\": \"g1\", \"range\": \"상위 10%\",   \"cut\": \"88점 이상\", \"desc\": \"서술형 고난도 포함 전 문항 완벽 해결 가능한 최상위권\"},\n    {\"grade\": 2, \"badge_class\": \"g2\", \"range\": \"10~34%\",     \"cut\": \"74점 이상\", \"desc\": \"기본/실력 문항 모두 맞추고 서술형에서 부분 점수 획득 구간\"},\n    {\"grade\": 3, \"badge_class\": \"g3\", \"range\": \"34~66%\",     \"cut\": \"56점 이상\", \"desc\": \"기본 개념은 갖추나 서술형 고난도와 후반 객관식 일부에서 실점\"},\n    {\"grade\": 4, \"badge_class\": \"g4\", \"range\": \"66~90%\",     \"cut\": \"38점 이상\", \"desc\": \"기초 개념 위주 득점. 해당 단원 보완 필요\"},\n    {\"grade\": 5, \"badge_class\": \"g5\", \"range\": \"90~100%\",    \"cut\": \"38점 미만\", \"desc\": \"기초 개념 이해와 연산 훈련 부족. 교과서부터 재학습 필요\"}\n  ],\n  \"strategy\": {\n    \"top\": [\n      \"서술형 고난도 치환·판별식 연결 공식 반복 훈련\",\n      \"미지수 설정부터 최종 결론까지 감점 없이 작성 연습\",\n      \"계산이 긴 문제에서 중간 부호와 지수 값 실수 차단\"\n    ],\n    \"mid\": [\n      \"연산 공식과 그래프 성질을 바르게 풀 수 있도록 훈련\",\n      \"기본 그래프를 직접 그리며 점근선과 교점 찾는 연습\",\n      \"틀린 문제의 전형 유형 파악 후 유사 문제 3회 이상 풀기\"\n    ],\n    \"low\": [\n      \"교과서·기본서 예제·유제 반복으로 연산 두려움 제거\",\n      \"핵심 개념과 공식을 백지에 적어 연습\",\n      \"전반부 기본 문항 빠르게 답 내는 것을 목표로 설정\"\n    ]\n  },\n  \"weekly_plan\": [\n    {\"week\": 1, \"goal\": \"핵심개념 완성\", \"content\": \"• 기본 공식·성질 집중 복습\\n• 교과서 예제 전수\\n• 개념 정리 노트 작성\", \"questions\": \"1~5번\"},\n    {\"week\": 2, \"goal\": \"유형 훈련\",     \"content\": \"• 기출 변형 풀이\\n• 유형별 분류 학습\\n• 취약 유형 집중\", \"questions\": \"6~12번\"},\n    {\"week\": 3, \"goal\": \"중난이도 공략\", \"content\": \"• 오답 유형 집중\\n• 풀이 과정 정리\\n• 개념 연결 훈련\", \"questions\": \"13~17번\"},\n    {\"week\": 4, \"goal\": \"고난도 진입\",   \"content\": \"• 서술형 완성\\n• 고난도 패턴 분석\\n• 시간 배분 연습\", \"questions\": \"18~서술형\"},\n    {\"week\": 5, \"goal\": \"실전 모의\",     \"content\": \"• 시간 제한 풀이\\n• 실전 감각 유지\\n• 최종 점검\", \"questions\": \"전체\"},\n    {\"week\": 6, \"goal\": \"최종 점검\",     \"content\": \"• 취약 단원 재확인\\n• 오답 전체 복습\\n• 핵심 공식 최종 정리\", \"questions\": \"오답 전체\"}\n  ],\n  \"parent_advice\": {\n    \"title\": \"이번 시험, 점수 이면의 '과정'을 칭찬해주세요.\",\n    \"body\": \"이번 시험은 단순 계산을 넘어 깊은 추론 능력을 요구했습니다. 단순히 몇 점을 맞았느냐보다 어느 단원에서 개념이 흔들렸는지 함께 분석하는 과정이 필요합니다. 규칙적인 학습 시간 확보와 오답 정리 습관을 지원해 주세요.\",\n    \"summary\": \"이번 시험은 수준 높은 변별력 시험이었습니다. 단계별 학습 계획을 꾸준히 실행하면 다음 시험에서 유의미한 성적 향상을 기대할 수 있습니다.\",\n    \"hashtags\": [\"#핵심단원_집중학습\", \"#오답노트_필수\", \"#서술형_과정점수\", \"#꾸준함이실력\"]\n  }\n}\n\n## 작성 규칙\n- 한국어, 전문적·구체적. 실제 시험지 내용 기반.\n- questions: 전체 문항 빠짐없이 (객관+서술 모두).\n- key_questions: 오답률 높고 등급 가르는 문항을 반드시 정확히 3개 선정. 2개도 4개도 아닌 정확히 3개.\n- charts.domain_labels: 반드시 실제 단원명 사용 (더미값 금지).\n- tag_class: \"tag-killer\"(최상) / \"tag-high\"(상) / \"tag-midhigh\"(중상) / \"tag-mid\"(중) 중 선택.\n- difficulty: \"하\"/\"중하\"/\"중\"/\"중상\"/\"상\"/\"최상\" 중 하나.\n- grade_dist 합계 = 100.\n- weekly_plan content 줄바꿈은 \\n으로.\n- composition_detail: 전반부/후반부 구성, 단원별 비중 포함하여 구체적으로.\n";

const PDF_TEXT_MAX = 16000;

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
    const schoolName = (body.schoolName || '').trim();
    const examText = (body.examText || '').trim();
    if (!examText) {
      return new Response(JSON.stringify({ error: '분석할 시험지 텍스트가 없습니다.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const userMessage =
      `학교명: ${schoolName}\n분석일: ${today}\n\n` +
      '아래 시험지 텍스트를 분석해 지정 JSON 스키마로 반환하세요.\n' +
      'JSON 외 텍스트는 절대 포함하지 마세요.\n\n' +
      `--- 시험지 ---\n${examText.slice(0, PDF_TEXT_MAX)}`;

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 16000,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: JSON_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(JSON.stringify({ error: `OpenAI 호출 실패 (${resp.status}): ${errText.slice(0, 300)}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const respJson = await resp.json();
    const raw = ((respJson?.choices?.[0]?.message?.content as string) || '').trim();

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      return new Response(JSON.stringify({ error: 'GPT 응답을 JSON으로 해석하지 못했습니다.' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
