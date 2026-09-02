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

export interface SmsResultEntry {
  name?: string;
  phone: string;
  status: 'success' | 'failed';
}

export interface SendSmsResult {
  requested: number;
  succeeded: number;
  failed: number;
  skipped: SkippedRecipient[];
  results: SmsResultEntry[];
}

export interface SmsSendLog {
  id: number;
  recipientName: string | null;
  recipientPhone: string;
  message: string;
  status: 'success' | 'failed' | 'skipped';
  errorReason: string | null;
  sentAt: string;
}

interface SmsSendLogRow {
  id: number;
  recipient_name: string | null;
  recipient_phone: string;
  message: string;
  status: string;
  error_reason: string | null;
  sent_at: string;
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
 *
 * 2026-09-02: 발송 결과를 sms_send_logs 테이블에 기록해서 "발송 내역" 화면에서
 * 언제 누구에게 뭘 보냈는지 확인할 수 있게 함(사용자 요청 — "보냈나 안보냈나
 * 헷갈리지 않게"). 기록은 Edge Function이 아니라 여기(브라우저 쪽)에서
 * 남긴다 — 이 프로젝트의 다른 DB 쓰기(반 재배정, 학생 등록/삭제 등)도 전부
 * 클라이언트에서 직접 supabase-js로 하는 방식이라 그 패턴을 그대로 따름.
 * 기록 저장이 실패해도(예: 테이블이 아직 없음) 문자 발송 자체는 이미 끝난
 * 뒤이므로 에러를 던지지 않고 콘솔 경고만 남김 — 기록 실패 때문에 "발송
 * 성공"이 "발송 실패"로 잘못 보이면 안 되기 때문.
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

  const result = data.data;

  const logRows = [
    ...result.results.map((r) => ({
      recipient_name: r.name ?? null,
      recipient_phone: r.phone,
      message: text,
      status: r.status,
      error_reason: null as string | null,
    })),
    ...result.skipped.map((s) => ({
      recipient_name: s.name ?? null,
      recipient_phone: s.phone,
      message: text,
      status: 'skipped',
      error_reason: s.reason,
    })),
  ];

  if (logRows.length > 0) {
    const { error: logError } = await supabase.from('sms_send_logs').insert(logRows);
    if (logError) {
      // eslint-disable-next-line no-console
      console.warn('[smsSend] 발송 내역 기록 실패(문자는 이미 발송됨):', logError.message);
    }
  }

  return result;
}

/** "발송 내역" 화면용 — 최근 발송 기록을 최신순으로 가져온다. */
export async function fetchSmsSendLogs(limit = 50): Promise<SmsSendLog[]> {
  const { data, error } = await supabase
    .from('sms_send_logs')
    .select('id, recipient_name, recipient_phone, message, status, error_reason, sent_at')
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return ((data as SmsSendLogRow[]) ?? []).map((row) => ({
    id: row.id,
    recipientName: row.recipient_name,
    recipientPhone: row.recipient_phone,
    message: row.message,
    status: row.status as SmsSendLog['status'],
    errorReason: row.error_reason,
    sentAt: row.sent_at,
  }));
}
