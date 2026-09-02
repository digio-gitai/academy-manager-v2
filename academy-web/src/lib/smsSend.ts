import { supabase } from './supabaseClient';

export interface SmsRecipient {
  name: string;
  phone: string;
}

export interface SkippedRecipient {
  name?: string;
  phone: string;
  reason: string;
}

export interface SendSmsResult {
  requested: number;
  succeeded: number;
  failed: number;
  skipped: SkippedRecipient[];
}

/**
 * "SMS발송" 화면에서 선택한 대상들에게 같은 문자를 한 번에 보낸다(1명만
 * 선택해도 동작 — 공지든 개인 메시지든 이 함수 하나로 처리).
 *
 * 실제 Solapi 발송은 여기서 직접 하지 않는다 — API 키를 브라우저에 노출하지
 * 않기 위해 Supabase Edge Function(send-sms)이 서버 쪽에서만 호출한다(다른
 * 기능의 AI 초안 생성, 과제인증 사진 확인 등과 같은 이유).
 * Edge Function 코드: academy-web/supabase/functions/send-sms/index.ts
 * (Supabase 대시보드에서 별도로 배포 + Secret 등록을 해야 실제로 문자가 나감).
 */
export async function sendBulkSms(recipients: SmsRecipient[], text: string): Promise<SendSmsResult> {
  const { data, error } = await supabase.functions.invoke<{ data?: SendSmsResult; error?: string }>(
    'send-sms',
    { body: { recipients, text } },
  );

  if (error) {
    throw error;
  }
  if (!data || data.error || !data.data) {
    throw new Error(data?.error || 'SMS 발송에 실패했습니다.');
  }
  return data.data;
}
