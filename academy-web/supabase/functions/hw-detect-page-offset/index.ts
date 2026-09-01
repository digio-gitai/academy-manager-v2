// Supabase Edge Function: hw-detect-page-offset
//
// 과제인증 4단계(1/3): 참조 PDF의 "페이지 오프셋" 자동 감지.
// 스트림릿 hw_reference.py의 auto_detect_page_offset()과 동일한 로직 — PDF
// 앞부분 장들에 인쇄된 페이지 번호를 GPT-4o Vision으로 읽어서, "PDF 파일 내
// 실제 장 번호"와 "문제집에 인쇄된 페이지 번호"의 차이(offset)를 추정한다.
// 표지·목차 등 페이지 번호가 없는 장이 섞여 있을 수 있어서, 여러 장을
// 다수결(최빈값)로 종합해 한두 장의 오독에 흔들리지 않게 한다.
//
// PDF → 이미지 변환은 이 함수가 아니라 브라우저(hwReference.ts)에서 pdf.js로
// 미리 렌더링해서 보내온다 — Deno에는 PyMuPDF 같은 PDF 렌더링 라이브러리가
// 없어서, 기존 vision-ocr(visionOcr.ts)과 같은 방식을 그대로 재사용함.
//
// OpenAI API 키는 브라우저에 노출하지 않고 여기서만 사용 — 기존
// generate-parent-comment/refine-analyze-test와 동일한 OPENAI_API_KEY Secret
// 재사용(추가 설정 불필요).
//
// 배포 방법(코드가 아니라 Supabase 대시보드에서 하는 절차):
//   Supabase 대시보드 → Edge Functions → 새 함수 만들기 → 이름
//   "hw-detect-page-offset" → 이 파일 내용을 그대로 붙여넣고 배포(Deploy)
//
// 입력: { images: string[] }
//   — PDF 앞부분 장들을 순서대로 렌더링한 이미지(base64, data URL 접두사
//     있어도/없어도 됨). images[0]이 PDF 파일의 1번째 장.
// 출력(성공): { offset: number | null, detail: string }
//   offset이 null이면 자동 감지 실패 — 호출한 쪽이 수동 입력을 안내해야 함.
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

function toImageContentPart(base64OrDataUrl: string) {
  const isDataUrl = base64OrDataUrl.startsWith('data:');
  const url = isDataUrl ? base64OrDataUrl : `data:image/png;base64,${base64OrDataUrl}`;
  return { type: 'image_url', image_url: { url, detail: 'low' } };
}

function stripFences(raw: string): string {
  return raw.replace(/```json/g, '').replace(/```/g, '').trim();
}

// 스트림릿의 Counter(offsets).most_common(1)[0]과 동일한 다수결 로직.
function computeOffsetFromEntries(entries: Array<{ 장?: unknown; 페이지번호?: unknown }>): { offset: number | null; detail: string } {
  const offsets: number[] = [];
  for (const item of entries) {
    const filePage = Number(item['장']);
    const printed = item['페이지번호'];
    if (printed === null || printed === undefined) continue;
    const printedNum = Number(printed);
    if (!Number.isFinite(filePage) || !Number.isFinite(printedNum) || printedNum < 1) continue;
    offsets.push(filePage - printedNum);
  }

  if (offsets.length === 0) {
    return { offset: null, detail: '인쇄된 페이지 번호를 찾지 못했습니다. 아래에서 직접 입력해주세요.' };
  }

  const counts = new Map<number, number>();
  for (const o of offsets) counts.set(o, (counts.get(o) ?? 0) + 1);
  let bestOffset = offsets[0];
  let bestCount = 0;
  for (const [k, v] of counts) {
    if (v > bestCount) {
      bestOffset = k;
      bestCount = v;
    }
  }
  const detail = `앞부분 ${offsets.length}개 장 중 ${bestCount}개가 이 결과와 일치했습니다.`;
  if (bestCount / offsets.length < 0.5) {
    return { offset: null, detail: `판독이 일관되지 않습니다 (${detail}). 아래에서 직접 확인해주세요.` };
  }
  return { offset: Math.max(0, bestOffset), detail };
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
    const images = Array.isArray(body.images) ? body.images.slice(0, 15) : [];
    if (images.length === 0) {
      return new Response(JSON.stringify({ offset: null, detail: 'PDF에서 페이지를 찾을 수 없습니다.' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const intro =
      `지금부터 문제집/프린트 PDF의 앞부분 ${images.length}개 장을 순서대로 ` +
      "보여드립니다(각각 '장 N:' 라벨이 붙어 있음 — 이건 PDF 파일 자체의 장 " +
      '순서이지, 문제집에 인쇄된 페이지 번호가 아닙니다). 각 장 하단(또는 상단) ' +
      "여백에 인쇄된 '페이지 번호'를 찾아서 읽어주세요 — 표지·목차·속표지처럼 " +
      '페이지 번호가 아예 인쇄되어 있지 않은 장도 있을 수 있으니, 그런 장은 ' +
      'null로 표시하세요.\n\n' +
      'JSON 배열로만 답하세요. 예시:\n' +
      '[{"장": 1, "페이지번호": null}, {"장": 2, "페이지번호": null}, ' +
      '{"장": 3, "페이지번호": 1}, {"장": 4, "페이지번호": 2}]\n' +
      '다른 설명 없이 이 JSON 배열만 출력하세요.';

    const content: unknown[] = [{ type: 'text', text: intro }];
    images.forEach((img, i) => {
      content.push({ type: 'text', text: `장 ${i + 1}:` });
      content.push(toImageContentPart(img));
    });

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 800,
        temperature: 0,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(JSON.stringify({ error: `OpenAI 호출 실패 (${resp.status}): ${errText.slice(0, 300)}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await resp.json();
    const raw = ((data?.choices?.[0]?.message?.content as string) || '').trim();
    const cleaned = stripFences(raw);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return new Response(
        JSON.stringify({ offset: null, detail: 'AI 응답을 이해하지 못했습니다. 아래에서 직접 입력해주세요.' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const entries = Array.isArray(parsed) ? parsed : [];
    const result = computeOffsetFromEntries(entries);

    return new Response(JSON.stringify(result), {
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
