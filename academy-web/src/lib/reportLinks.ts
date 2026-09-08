import { supabase } from './supabaseClient';
import { HW_SMS_GREETING } from './homework';

// 학부모용 성적 리포트 열람 페이지 링크 베이스 주소 — 문자로 전송되는 링크의 원본.
//
// [2026-09-08] report_links 테이블의 token/html_content 컬럼은 옛 스트림릿
// 코드(database.py의 save_report_link/get_report_link_meta 등)가 이미 쓰고
// 있던 것을 그대로 재사용한다 — 새 컬럼을 따로 만들지 않음. 예전엔 이 링크가
// Streamlit Cloud 주소(academy-manager-v2-...streamlit.app/?report=토큰)를
// base로 만들어졌는데, 그 호스팅을 정리하는 과정에서 옛 링크가 전부 깨짐(호스팅
// 자체가 사라져 복구 불가 — 다만 report_links 행의 html_content는 DB에 그대로
// 남아있어 데이터 자체는 안전함). 이번엔 Vercel(영구 배포 주소) 기반으로 새로
// 만들어서, 앞으로는 외부 호스팅에 의존하지 않는다.
export const PARENT_REPORT_BASE_URL = 'https://academy-manager-v2.vercel.app/parent-report';

export interface ReportLinkMeta {
  htmlContent: string;
  studentName: string;
  studentId: number | null;
  testType: string;
  testDate: string;
  testName: string;
  viewedAt: string | null;
}

function nowStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    return String(e.message ?? e.details ?? e.hint ?? e.code ?? JSON.stringify(e));
  }
  return String(err);
}

function genToken(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 보고서 HTML을 저장하고 조회용 토큰을 발급 — 스트림릿 database.py save_report_link() 대응. */
export async function createReportLink(params: {
  html: string;
  studentName: string;
  studentId: string;
  testType: string;
  testDate: string;
  testName: string;
}): Promise<string> {
  const token = genToken();
  const { error } = await supabase.from('report_links').insert({
    token,
    html_content: params.html,
    student_name: params.studentName,
    student_id: Number(params.studentId),
    test_type: params.testType,
    test_date: params.testDate,
    test_name: params.testName,
    created_at: nowStr(),
  });
  if (error) throw new Error(`리포트 저장에 실패했습니다: ${describeError(error)}`);
  return token;
}

/** 문자 발송 성공 직후 sent_at 기록 — save_report_link 이후 mark_report_link_sent() 대응. */
export async function markReportSent(token: string): Promise<void> {
  const { error } = await supabase.from('report_links').update({ sent_at: nowStr() }).eq('token', token);
  if (error) throw new Error(`발송 기록에 실패했습니다: ${describeError(error)}`);
}

/** 토큰으로 보고서 HTML + 메타정보 조회 — get_report_link_meta() 대응. */
export async function fetchReportByToken(token: string): Promise<ReportLinkMeta | null> {
  const { data, error } = await supabase
    .from('report_links')
    .select('html_content, student_name, student_id, test_type, test_date, test_name, viewed_at')
    .eq('token', token)
    .maybeSingle();
  if (error) throw new Error(`보고서를 불러오지 못했습니다: ${describeError(error)}`);
  if (!data) return null;
  const row = data as {
    html_content: string;
    student_name: string | null;
    student_id: number | null;
    test_type: string | null;
    test_date: string | null;
    test_name: string | null;
    viewed_at: string | null;
  };
  return {
    htmlContent: row.html_content,
    studentName: row.student_name ?? '',
    studentId: row.student_id,
    testType: row.test_type ?? '',
    testDate: row.test_date ?? '',
    testName: row.test_name ?? '',
    viewedAt: row.viewed_at,
  };
}

/** 학부모가 링크를 열었을 때 최초 1회만 열람 시각 기록 — mark_report_link_viewed() 대응. */
export async function markReportViewed(token: string): Promise<void> {
  const { data } = await supabase.from('report_links').select('viewed_at').eq('token', token).maybeSingle();
  if ((data as { viewed_at: string | null } | null)?.viewed_at) return;
  await supabase.from('report_links').update({ viewed_at: nowStr() }).eq('token', token);
}

/** 학부모에게 보낼 리포트 링크 문자 문구. */
export function buildParentReportLinkText(params: { studentName: string; token: string }): string {
  const link = `${PARENT_REPORT_BASE_URL}?token=${params.token}`;
  return `${HW_SMS_GREETING}\n${params.studentName} 학생의 성적 리포트입니다. 확인 부탁드립니다.\n${link}`;
}
