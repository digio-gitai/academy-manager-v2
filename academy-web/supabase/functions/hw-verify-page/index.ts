// Supabase Edge Function: hw-verify-page
//
// 과제인증 4단계(2/3): 학생이 올린 인증샷이 맞는 페이지인지 AI로 1차 확인.
// 스트림릿 hw_photo_review.py(_run_ai_page_check_by_text)와 hw_reference.py
// (run_ai_page_check_with_reference) 두 함수를 하나의 Edge Function으로
// 합쳐서 이식함 — 참조 PDF 후보 이미지(referencePages)가 함께 오면 "사진↔
// 페이지 이미지 대조" 방식을, 없으면(빈 배열/생략) "사진 속 인쇄 숫자 읽기"
// 방식을 그대로 씀. 어느 쪽 방식이든 결과는 참고용 1차 판단일 뿐이고, 최종
// 확인은 항상 선생님이 사진을 직접 보고 해야 확정된다(이 함수는 그 확정
// 자체를 하지 않음 — hw_photos.teacher_verified는 선생님 화면에서만 바뀜).
//
// 어느 방식을 쓸지는 이 함수가 아니라 호출하는 쪽(hwUpload.ts)이 결정한다 —
// 그 반에 참조 PDF가 등록돼 있고 페이지 범위가 너무 넓지 않으면(15페이지
// 이하) referencePages를 채워 보내고, 아니면 빈 배열로 보내 텍스트 인식으로
// 자동 전환되게 한다.
//
// OpenAI API 키는 브라우저에 노출하지 않고 여기서만 사용 — 기존 함수들과
// 동일한 OPENAI_API_KEY Secret 재사용(추가 설정 불필요).
//
// 배포 방법(코드가 아니라 Supabase 대시보드에서 하는 절차):
//   Supabase 대시보드 → Edge Functions → 새 함수 만들기 → 이름
//   "hw-verify-page" → 이 파일 내용을 그대로 붙여넣고 배포(Deploy)
//
// 입력: {
//   photoUrl: string,   // 학생이 올린 사진의 공개 URL(Supabase Storage, hw-photos 버킷)
//   pageStart: number,
//   pageEnd: number,
//   referencePages?: { page: number; image: string }[]  // 있으면 참조 대조 모드(image는 data URL)
// }
// 출력(성공): {
//   guess: string | null,
//   flag: 'match' | 'mismatch' | 'unclear' | 'error' | 'no_api_key',
//   message: string,
//   method: 'reference' | 'text'
// }
// 출력(실패): { error: "에러 메시지" }

// @ts-nocheck — Deno 런타임 전역(Deno.serve 등)은 이 프로젝트의 브라우저용
// TypeScript 설정(tsconfig.app.json)에서 타입 정의가 없어 에디터에 빨간 줄이
// 뜰 수 있음. 실제 실행은 Supabase의 Deno 서버에서 되므로 문제 없음.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ReferencePage {
  page: number;
  image: string;
}

interface RequestBody {
  photoUrl: string;
  pageStart: number;
  pageEnd: number;
  referencePages?: ReferencePage[];
}

const PAGE_CHECK_PROMPT_TEXT =
  "이 사진은 학생이 수학 문제집/프린트를 푼 뒤 제출한 인증샷입니다. 이 문제집/프린트에 '인쇄되어' 있는 '페이지 번호'를 찾아서 숫자만 답하세요. 페이지 번호는 보통 학생이 손으로 쓴 숫자가 아니라, 인쇄소에서 찍어낸 작은 활자이고, 거의 항상 페이지 맨 아래쪽(하단) 여백에 — 하단 왼쪽, 하단 정중앙, 하단 오른쪽 중 한 곳에 — 다른 글자 없이 혼자 작게 인쇄되어 있습니다. 이 하단 여백을 최우선으로, 아주 꼼꼼히 확인하세요.\n\n" +
  "**절대 헷갈리면 안 되는 것 — '문제 번호'는 페이지 번호가 아닙니다.** 시험지/문제집에는 각 문항 앞에 '1.', '01', '2)'처럼 문제를 구분하는 숫자(문제 번호)가 붙어 있고, 이건 보통 페이지 맨 위 또는 왼쪽 상단, 문제 지문 바로 앞에 있습니다. 이건 페이지 번호가 아니라 '몇 번 문제인지'를 나타내는 것이므로 절대 페이지 번호로 답하면 안 됩니다. 페이지 번호는 문제 내용과 떨어진 여백에(주로 하단에) 혼자 있는 숫자이고, 문제 번호는 바로 뒤에 문제 지문(글이나 수식)이 이어진다는 점으로 구별하세요.\n\n" +
  '하단 여백에 정말 아무 숫자도 안 보일 때만, 페이지 상단 여백(문제 지문과 떨어진 구석)에 다른 인쇄 숫자가 있는지 참고로 확인하세요 — 이때도 문제 번호와 혼동하지 않도록 주의하세요.\n\n' +
  '중요: 학생이 사진을 찍을 때 종이나 폰이 기울어지거나 90도/180도 돌아간 채로 찍히는 경우가 흔합니다. 사진이 가로로 눕혀져 있거나 페이지가 거꾸로 보여도, 숫자를 정방향으로 상상하며 모든 방향(정방향/오른쪽으로 90도/왼쪽으로 90도/거꾸로)에서 읽어보고 페이지 번호처럼 보이는 작은 숫자를 찾으세요.\n\n' +
  "확신이 100%가 아니어도, 위 기준(하단 여백에 혼자 있는 인쇄 숫자)에 맞는 숫자가 보인다면 '모름'보다는 그 숫자로 답하는 쪽을 우선하세요(최종 확인은 선생님이 사진을 직접 보고 하므로, 이건 참고용 1차 판단일 뿐입니다). 다만 위 기준에 맞는 숫자가 전혀 안 보이고, 문제 번호로 보이는 숫자만 있다면 그건 쓰지 말고 '모름'이라고 답하세요.\n\n" +
  "하단/상단 여백에 인쇄된 번호가 정말 안 보일 때만, 학생이 손으로 적어둔 페이지 번호가 있는지 참고하세요. 여러 페이지가 한 사진에 보이면 가장 명확하게 읽히는 인쇄 번호 하나만 고르세요. 다른 설명 없이 숫자 하나 또는 '모름'만 출력하세요.";

const REFERENCE_MATCH_INTRO =
  "첫 번째 사진은 학생이 수학 문제집/프린트를 푼 뒤 찍어서 올린 인증샷입니다. 이어서 같은 문제집의 실제 페이지 원본 이미지들이 '페이지 N:' 라벨과 함께 차례로 나옵니다.\n\n" +
  '학생 사진이 이 페이지 원본들 중 어느 페이지와 같은 문제인지 찾아주세요. 학생 사진은 각도가 기울어져 있거나(회전·거꾸로), 손으로 푼 풀이·낙서·형광펜 표시가 덧붙여져 있거나, 일부만 잘려서 찍혔을 수 있습니다 — 그런 차이는 무시하고, 인쇄된 문제 텍스트·그림·문제 번호 배치가 같은 페이지를 찾으면 됩니다.\n\n' +
  "가장 일치하는 페이지의 번호만 숫자로 답하세요. 100% 확신이 없어도 가장 비슷한 페이지 번호로 답하는 쪽을 우선하세요(최종 확인은 선생님이 사진을 직접 보고 하므로, 이건 참고용 1차 판단일 뿐입니다). 어떤 페이지와도 전혀 안 비슷하다면(완전히 다른 문제집처럼 보이면) '모름'이라고만 답하세요. 다른 설명은 하지 말고 숫자 하나 또는 '모름'만 출력하세요.";

function toImageUrl(image: string): string {
  return image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ guess: null, flag: 'no_api_key', message: 'OpenAI API 키가 설정되지 않았습니다.', method: 'text' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const body = (await req.json()) as RequestBody;
    const photoUrl = body.photoUrl;
    const pageStart = Number(body.pageStart);
    const pageEnd = Number(body.pageEnd);
    const referencePages = Array.isArray(body.referencePages) ? body.referencePages : [];

    if (!photoUrl || !Number.isFinite(pageStart) || !Number.isFinite(pageEnd)) {
      return new Response(JSON.stringify({ error: 'photoUrl/pageStart/pageEnd가 올바르지 않습니다.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const method: 'reference' | 'text' = referencePages.length > 0 ? 'reference' : 'text';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = [];
    if (method === 'reference') {
      content.push({ type: 'text', text: REFERENCE_MATCH_INTRO });
      content.push({ type: 'text', text: '학생이 올린 사진:' });
      content.push({ type: 'image_url', image_url: { url: photoUrl, detail: 'high' } });
      for (const rp of referencePages) {
        content.push({ type: 'text', text: `페이지 ${rp.page}:` });
        content.push({ type: 'image_url', image_url: { url: toImageUrl(rp.image), detail: 'low' } });
      }
    } else {
      content.push({ type: 'text', text: PAGE_CHECK_PROMPT_TEXT });
      content.push({ type: 'image_url', image_url: { url: photoUrl, detail: 'high' } });
    }

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 20,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(
        JSON.stringify({ guess: null, flag: 'error', message: `검증 중 오류: HTTP ${resp.status} ${errText.slice(0, 200)}`, method }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const data = await resp.json();
    const raw = ((data?.choices?.[0]?.message?.content as string) || '').trim();

    const digits = raw.replace(/[^0-9]/g, '');
    let guess: string | null = null;
    let flag: string;
    if (!digits) {
      flag = 'unclear';
    } else {
      const guessNum = parseInt(digits, 10);
      guess = String(guessNum);
      flag = guessNum >= pageStart && guessNum <= pageEnd ? 'match' : 'mismatch';
    }

    return new Response(JSON.stringify({ guess, flag, message: raw, method }), {
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
