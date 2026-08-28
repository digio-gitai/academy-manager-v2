import { supabase } from './supabaseClient';

export interface AnalyzedQuestion {
  number: number;
  topic: string;
  method: string;
  difficulty: string;
  questionType: string;
}

export interface RefineAnalyzeResult {
  questions: AnalyzedQuestion[];
  refinedText: string;
}

/**
 * OCR 원문 텍스트 → GPT-4o로 수식 정제 + 문항별(단원/풀이유형/난이도/유형) 분석.
 * "학원시험 AI분석" 4단계 계획 중 1b단계 담당(1a는 lib/visionOcr.ts의 OCR 텍스트
 * 추출). 다음 단계(2단계)에서 이 결과를 사람이 검토·수정하는 UI가 붙을 예정.
 *
 * 실제 OpenAI 호출은 브라우저가 아니라 Supabase Edge Function
 * (refine-analyze-test)이 서버 쪽에서 처리함 — 학부모님께 전하는 글과 동일한
 * 원칙. Edge Function 코드:
 * academy-web/supabase/functions/refine-analyze-test/index.ts
 * (Supabase 대시보드에서 별도로 배포해야 실제로 동작함).
 */
export async function refineAndAnalyzeTest(rawText: string): Promise<RefineAnalyzeResult> {
  const { data, error } = await supabase.functions.invoke<{
    questions?: AnalyzedQuestion[];
    refinedText?: string;
    error?: string;
  }>('refine-analyze-test', {
    body: { rawText },
  });

  if (error) {
    throw error;
  }
  if (!data || data.error) {
    throw new Error(data?.error || 'GPT 문항 분석에 실패했습니다.');
  }

  return {
    questions: data.questions || [],
    refinedText: data.refinedText || '',
  };
}
