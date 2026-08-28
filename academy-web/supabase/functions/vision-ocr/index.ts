// Supabase Edge Function: vision-ocr
//
// "학원시험 AI분석" 탭의 1단계(시험지 이미지 → OCR 텍스트 추출) 함수.
// 실제 운영 중인 스트림릿 ocr_extract.py의 _google_vision_ocr_image()와
// 같은 일(Google Cloud Vision의 텍스트 인식)을 하지만, 인증 방식만 다름:
//   - 스트림릿(기존): service-account-key.json 파일로 인증 (Deno에서 그대로
//     흉내내려면 JWT 서명 등 복잡한 절차가 필요하고, 이 환경에선 실제 테스트가
//     불가능해 위험함)
//   - 이 함수(신규): 새로 발급한 "Cloud Vision API 전용" 제한된 API 키로 인증
//     (더 단순하고 안전 — Vision API 외에는 이 키로 아무것도 못 함)
//
// 브라우저(React)에는 이 API 키를 절대 넣지 않고, 여기(Supabase 서버)에만
// Secret으로 저장해서 사용함 — generate-parent-comment 함수와 동일한 원칙.
//
// 배포 방법(코드가 아니라 Supabase 대시보드에서 하는 절차):
//   Supabase 대시보드 → Edge Functions → 새 함수 만들기 → 이름 "vision-ocr"
//   → 이 파일 내용을 그대로 붙여넣고 배포(Deploy)
//   → Project Settings → Edge Functions → Secrets 에서
//     GOOGLE_VISION_API_KEY = (방금 발급받은 vision-ocr-key 값) 추가
//
// 입력: { images: string[] }  — 각 항목은 이미지 파일 하나를 base64로 인코딩한
//        문자열(맨 앞에 "data:image/...;base64," 가 붙어있어도 되고 없어도 됨).
//        여러 장이면 여러 페이지(시험지 여러 장)로 취급.
// 출력(성공): { pages: [{ page: 1, text: "인식된 텍스트..." }, ...] }
// 출력(실패): { error: "에러 메시지" }

// @ts-nocheck — Deno 런타임 전역(Deno.serve 등)은 이 프로젝트의 브라우저용
// TypeScript 설정(tsconfig.app.json)에서 타입 정의가 없어 에디터에 빨간 줄이
// 뜰 수 있음. 실제 실행은 Supabase의 Deno 서버에서 되므로 문제 없음.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RequestBody {
  images: string[];
}

function stripDataUrlPrefix(value: string): string {
  const commaIndex = value.indexOf(',');
  if (value.startsWith('data:') && commaIndex !== -1) {
    return value.slice(commaIndex + 1);
  }
  return value;
}

async function ocrOneImage(base64Content: string, apiKey: string): Promise<{ text?: string; error?: string }> {
  const resp = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        {
          image: { content: base64Content },
          features: [{ type: 'TEXT_DETECTION' }],
        },
      ],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    return { error: `Vision API 호출 실패 (HTTP ${resp.status}): ${errText.slice(0, 300)}` };
  }

  const data = await resp.json();
  const first = data?.responses?.[0];

  if (first?.error) {
    // 결제(billing)가 꺼져 있거나 권한이 없는 경우 등, Google이 각 이미지별로
    // 에러를 내려줄 수 있음 (HTTP 자체는 200으로 옴).
    const msg: string = first.error.message || 'Vision API 오류';
    if (/billing/i.test(msg)) {
      return { error: `Google Cloud 결제(billing)가 비활성화되어 있습니다: ${msg}` };
    }
    if (/permission|forbidden/i.test(msg)) {
      return { error: `Vision API 권한 오류입니다: ${msg}` };
    }
    return { error: msg };
  }

  const text = first?.fullTextAnnotation?.text || first?.textAnnotations?.[0]?.description || '';
  return { text };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('GOOGLE_VISION_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Google Vision API 키가 설정되지 않았습니다. Supabase 대시보드에서 Secrets를 확인해 주세요.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const body = (await req.json()) as RequestBody;
    const images = Array.isArray(body.images) ? body.images : [];
    if (images.length === 0) {
      return new Response(JSON.stringify({ error: '이미지가 없습니다.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const pages: { page: number; text: string }[] = [];
    for (let i = 0; i < images.length; i++) {
      const content = stripDataUrlPrefix(images[i]);
      const result = await ocrOneImage(content, apiKey);
      if (result.error) {
        return new Response(JSON.stringify({ error: `${i + 1}번째 이미지 처리 중 오류: ${result.error}` }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      pages.push({ page: i + 1, text: result.text || '' });
    }

    return new Response(JSON.stringify({ pages }), {
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
