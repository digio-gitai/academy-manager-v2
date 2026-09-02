import { supabase } from './supabaseClient';
import type { UnifiedGradeRecord } from '../types/grades';

/**
 * "학부모님께 전하는 글" AI 초안 생성.
 *
 * 실제 API 키(OpenAI)는 브라우저에 절대 노출하지 않고, Supabase Edge Function
 * (generate-parent-comment)이 서버 쪽에서만 호출하도록 구성함 — 과제 인증의
 * Solapi SMS와 같은 이유("실제 외부 API를 브라우저에서 직접 호출하지 않는다").
 * Edge Function 코드: academy-web/supabase/functions/generate-parent-comment/index.ts
 * (Supabase 대시보드에서 별도로 배포해야 실제로 동작함).
 *
 * 스트림릿 app.py의 _generate_parent_comment_ai()와 동일하게, 프롬프트/모델
 * 자체는 서버(Edge Function) 쪽에 있고 여기서는 학생 이름 + 시험 목록만 넘김.
 */
export async function generateParentComment(
  studentName: string,
  records: UnifiedGradeRecord[],
  /**
   * "통합보고서"에서만 넘기는 값(2026-08-29 추가) — 여러 단원테스트를 합친
   * 단원별/난이도별/인지영역별 분석 + 취약·강점 단원을 정리한 텍스트.
   * 이게 있으면 Edge Function이 점수 목록 대신 이 내용을 바탕으로 더 구체적인
   * 총평을 써줌(integratedReport.ts의 summarizeForAiComment() 참고).
   */
  integratedSummary?: string,
): Promise<string> {
  const exams = records.map((r) => ({ label: r.examLabel, score: r.score }));

  const { data, error } = await supabase.functions.invoke<{ comment?: string; error?: string }>(
    'generate-parent-comment',
    { body: { studentName, exams, integratedSummary } },
  );

  if (error) {
    throw error;
  }
  if (!data || data.error || !data.comment) {
    throw new Error(data?.error || 'AI 초안 생성에 실패했습니다.');
  }
  return data.comment;
}
