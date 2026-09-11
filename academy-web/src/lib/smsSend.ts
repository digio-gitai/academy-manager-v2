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
 * 헷갈리지 않게").
 *
 * 2026-09-11: 이 기록을 원래 여기(브라우저 쪽)에서 anon 키로 직접 insert
 * 했었는데, 운영 프로젝트에서 원인 불명으로 anon/publishable 키(legacy 키도
 * 동일) INSERT가 계속 RLS 위반으로 거부되는 현상이 발견됨 — 정책을 public
 * 대상으로 최대한 풀어도, 완전히 새로 만든 테스트 테이블에서도 동일하게
 * 막혀서 이 테이블/정책 자체의 문제는 아니고 Supabase 계정 쪽 이슈로 추정
 * (당시 조직이 사용량 초과 상태였음). 그래서 기록 책임을 Edge Function
 * (send-sms, 서비스 역할 키로 RLS 우회)으로 옮김 — 여기서는 더 이상 직접
 * insert하지 않는다.
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

/**
 * "발송 내역" 화면용 — 최근 발송 기록을 최신순으로 가져온다.
 *
 * 2026-09-11: 원래 여기서 anon 키로 직접 select했는데, 운영 프로젝트에서는
 * sms_send_logs에 실제 데이터가 있어도(SQL Editor로 직접 확인함) 이 경로로는
 * 항상 빈 배열만 돌아오는 현상이 있어서(원인 불명 — send-sms Edge Function의
 * INSERT 우회와 같은 이유), 조회도 서버(get-sms-logs Edge Function, 서비스
 * 역할 키)를 거치도록 바꿈.
 */
export async function fetchSmsSendLogs(limit = 50): Promise<SmsSendLog[]> {
  const { data, error } = await supabase.functions.invoke<{ data?: SmsSendLogRow[]; error?: string }>(
    'get-sms-logs',
    { body: { limit } },
  );

  if (error) {
    throw error;
  }
  if (!data || data.error) {
    throw new Error(data?.error || '발송 내역을 불러오지 못했습니다.');
  }

  return (data.data ?? []).map((row) => ({
    id: row.id,
    recipientName: row.recipient_name,
    recipientPhone: row.recipient_phone,
    message: row.message,
    status: row.status as SmsSendLog['status'],
    errorReason: row.error_reason,
    sentAt: row.sent_at,
  }));
}
