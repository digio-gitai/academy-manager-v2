import { supabase } from './supabaseClient';

/**
 * Edge Function "claude-report-ai" 호출 래퍼 — 스트림릿 claude_report.py의
 * Claude 호출 3종(선생님 코멘트 초안 / 오답 문항별 한줄평 / 풀이유형 묶기)과 동일.
 * API 키는 서버(Edge Function Secrets)에만 있음.
 */
async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T & { error?: string }>('claude-report-ai', { body });
  if (error) throw error;
  if (!data) throw new Error('AI 응답이 비어 있습니다.');
  if (data.error) throw new Error(data.error);
  return data;
}

export async function generateTeacherCommentDraft(params: {
  studentName: string;
  score: number;
  classAvg: number | null;
  rank: number | null;
  totalStudents: number | null;
  wrongNumbers: number[];
  totalQuestions: number;
  historyScores: number[];
  testName: string;
}): Promise<string> {
  const data = await invoke<{ comment: string }>({ action: 'teacher_comment', ...params });
  return data.comment;
}

export interface WrongQuestionDetail {
  number: number;
  topic: string;
  method: string;
  difficulty: string;
}

/** 실패하면 빈 객체 — 원본처럼 한줄평 없이 보고서는 그대로 생성됨. */
export async function generateWrongQuestionComments(
  studentName: string,
  wrongDetails: WrongQuestionDetail[],
): Promise<Record<number, string>> {
  if (wrongDetails.length === 0) return {};
  try {
    const data = await invoke<{ comments: { number: number; comment: string }[] }>({
      action: 'wrong_comments',
      studentName,
      wrongDetails,
    });
    const out: Record<number, string> = {};
    for (const c of data.comments ?? []) out[c.number] = c.comment;
    return out;
  } catch {
    return {};
  }
}

/** 실패하면 null — 호출부가 난이도 기준으로 폴백(원본과 동일). */
export async function clusterQuestionMethods(methods: string[]): Promise<Record<string, string> | null> {
  if (methods.length < 2) return null;
  try {
    const data = await invoke<{ mapping: Record<string, string> | null }>({ action: 'cluster_methods', methods });
    return data.mapping ?? null;
  } catch {
    return null;
  }
}
