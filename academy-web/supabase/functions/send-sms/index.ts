// Supabase Edge Function: send-sms
//
// "SMS발송" 메뉴(독립 메뉴, 학부모/학생에게 공지·개인 메시지를 자유롭게 보내는
// 기능)에서 실제 문자를 내보내는 곳. 스트림릿 sms_sender.py의 send_text_sms()
// (자유 텍스트 문자 발송)와 같은 역할을 하되, 파이썬 solapi SDK가 없는
// Deno 런타임이라 Solapi REST API(HMAC-SHA256 서명)를 직접 호출한다.
//
// 서명 방식은 solapi 공식 파이썬 SDK(solapi/lib/authenticator.py)를 그대로
// 이식했다:
//   Authorization: HMAC-SHA256 ApiKey={key}, Date={ISO8601}, salt={랜덤값}, signature={HMAC-SHA256(secret, date+salt)의 16진수}
// 엔드포인트도 동일 SDK가 쓰는 POST https://api.solapi.com/messages/v4/send-many/detail
// (한 번에 여러 명에게 보내는 "대량 발송" 엔드포인트 — 한 명만 보낼 때도
// messages 배열에 1개만 넣어서 그대로 씀).
//
// API 키는 브라우저에 노출하지 않고 여기(Supabase Edge Function Secret)에서만
// 사용 — 다른 기능(AI 초안 생성 등)과 같은 이유. 이 Secret 3개는 아직 dev
// 프로젝트에는 등록돼 있지 않을 수 있다(실수로 실제 문자가 나가는 걸 막기
// 위해 일부러 비워둔 상태) — 그 경우 아래에서 명확한 에러 메시지로 실패한다.
//
// 배포 방법(코드가 아니라 Supabase 대시보드에서 하는 절차):
//   Supabase 대시보드 → Edge Functions → 새 함수 만들기 → 이름 "send-sms"
//   → 이 파일 내용을 그대로 붙여넣고 배포(Deploy)
//   실제 발송을 켜려면 Edge Functions → send-sms → Secrets(또는 프로젝트
//   전체 Settings → Edge Functions → Secrets)에 아래 3개를 등록해야 한다:
//     SOLAPI_API_KEY, SOLAPI_API_SECRET, SOLAPI_SENDER
//   (academy_dev/.env나 운영 .env의 값과 같은 값 — Supabase Edge Function은
//   별도의 Secret 저장소를 쓰기 때문에 .env에 적어둔 것과 별개로 여기도
//   등록해야 실제로 동작한다.)
//
// 입력: {
//   recipients: { name?: string; phone: string }[],  // 받는 사람 목록(학부모/학생 구분 없이 전화번호만 씀)
//   text: string                                       // 모두에게 동일하게 보낼 메시지 내용
// }
// 출력(성공): {
//   data: {
//     requested: number,   // 시도한 총 건수
//     succeeded: number,   // 접수 성공
//     failed: number,      // 접수 실패(Solapi가 거부)
//     skipped: { name?: string; phone: string; reason: string }[],  // 전화번호/내용 문제로 아예 시도조차 안 한 건
//     raw: unknown          // Solapi 원본 응답(디버깅용)
//   }
// }
// 출력(실패): { error: "에러 메시지" }

// @ts-nocheck — Deno 런타임 전역(Deno.serve 등)은 이 프로젝트의 브라우저용
// TypeScript 설정(tsconfig.app.json)에서 타입 정의가 없어 에디터에 빨간 줄이
// 뜰 수 있음. 실제 실행은 Supabase의 Deno 서버에서 되므로 문제 없음.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RecipientInput {
  name?: string;
  phone: string;
}

interface RequestBody {
  recipients: RecipientInput[];
  text: string;
}

interface SkippedEntry {
  name?: string;
  phone: string;
  reason: string;
}

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// 스트림릿 sms_sender.py의 clean_phone()과 동일: 숫자만 남긴다.
function cleanPhone(phone: string): string {
  return (phone || '').replace(/[^0-9]/g, '');
}

// solapi 파이썬 SDK(Authenticator.get_signature)와 동일한 HMAC-SHA256 서명.
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function buildAuthorizationHeader(apiKey: string, apiSecret: string): Promise<string> {
  const date = new Date().toISOString();
  const salt = crypto.randomUUID().replace(/-/g, '');
  const signature = await hmacSha256Hex(apiSecret, date + salt);
  return `HMAC-SHA256 ApiKey=${apiKey}, Date=${date}, salt=${salt}, signature=${signature}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('SOLAPI_API_KEY');
    const apiSecret = Deno.env.get('SOLAPI_API_SECRET');
    const sender = Deno.env.get('SOLAPI_SENDER');

    if (!apiKey || !apiSecret || !sender) {
      return jsonResponse(
        {
          error:
            'SOLAPI_API_KEY / SOLAPI_API_SECRET / SOLAPI_SENDER 중 하나 이상이 이 Supabase 프로젝트의 Edge Function Secret에 등록되어 있지 않습니다. (실수로 문자가 나가는 걸 막기 위해 dev 환경에서는 일부러 비워둔 상태일 수 있습니다 — 실제 발송을 하려면 Supabase 대시보드에서 등록해야 합니다.)',
        },
        400,
      );
    }

    const body = (await req.json()) as RequestBody;
    const recipients = Array.isArray(body?.recipients) ? body.recipients : [];
    const text = (body?.text ?? '').toString();

    if (recipients.length === 0) {
      return jsonResponse({ error: '보낼 대상이 선택되지 않았습니다.' }, 400);
    }
    if (!text.trim()) {
      return jsonResponse({ error: '메시지 내용이 비어 있습니다.' }, 400);
    }

    const senderPhone = cleanPhone(sender);
    const skipped: SkippedEntry[] = [];
    const messages: { to: string; from: string; text: string }[] = [];

    for (const r of recipients) {
      const to = cleanPhone(r?.phone ?? '');
      if (to.length < 9) {
        skipped.push({ name: r?.name, phone: r?.phone ?? '', reason: '전화번호 형식이 올바르지 않음' });
        continue;
      }
      messages.push({ to, from: senderPhone, text });
    }

    if (messages.length === 0) {
      return jsonResponse({ error: '유효한 발송 대상이 없습니다.', skipped }, 400);
    }

    const authorization = await buildAuthorizationHeader(apiKey, apiSecret);

    const res = await fetch('https://api.solapi.com/messages/v4/send-many/detail', {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages }),
    });

    const resultJson = await res.json().catch(() => null);

    if (!res.ok) {
      return jsonResponse(
        {
          error:
            resultJson?.errorMessage ||
            resultJson?.message ||
            `Solapi 발송 요청이 실패했습니다 (HTTP ${res.status}).`,
          raw: resultJson,
        },
        502,
      );
    }

    const count = resultJson?.groupInfo?.count;
    const failed = typeof count?.registeredFailed === 'number' ? count.registeredFailed : 0;
    const succeeded =
      typeof count?.registeredSuccess === 'number'
        ? count.registeredSuccess
        : messages.length - failed;

    return jsonResponse({
      data: {
        requested: messages.length,
        succeeded,
        failed,
        skipped,
        raw: resultJson,
      },
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
