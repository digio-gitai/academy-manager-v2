import { supabase } from './supabaseClient';

export type QuestionType = '객관식' | '서술형';
export type DifficultyLevel = 'A' | 'B' | 'C' | 'D' | 'E';

export interface TestQuestionDraft {
  questionNumber: string;
  topic: string;
  method: string;
  questionType: QuestionType;
  difficulty: DifficultyLevel;
}

export interface SaveTestInput {
  testName: string;
  testDate: string; // YYYY-MM-DD
  testType: string;
  questions: TestQuestionDraft[];
  analysisData?: Record<string, unknown>;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function nowStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * "학원시험 AI분석" 4단계 계획 중 2단계(검토/편집) 화면에서 사람이 확정한
 * 문항 목록을 dev DB에 저장. 스트림릿 app.py의 save_test_with_questions()와
 * 동일하게 `tests` 1행 + `test_questions` N행을 저장(테스트 자체의 등록 —
 * 특정 학생이 이 테스트에서 몇 번을 틀렸는지는 3단계(반/학생 배정)에서 별도로
 * `student_results`에 저장할 예정, 여기서는 안 함).
 *
 * 원본과 다른 점: 원본은 업로드한 시험지 파일(이미지/PDF)을 서버 디스크에도
 * 저장하지만(`_save_test_sheet_file`), 이 React 버전은 아직 파일 저장소가
 * 없어서 그 부분은 생략함(DB에는 문항 데이터만 저장). file_name 컬럼은 빈
 * 문자열로 둠 — 나중에 필요하면 Supabase Storage 연동으로 추가 가능.
 */
export async function saveTestWithQuestions(input: SaveTestInput): Promise<number> {
  const testName = input.testName.trim() || '테스트';
  const testType = input.testType.trim() || '일일테스트';
  const total = input.questions.length;
  const analysisJson = JSON.stringify(input.analysisData || {});

  const { data: testRow, error: testError } = await supabase
    .from('tests')
    .insert({
      test_name: testName,
      date: input.testDate,
      total_questions: total,
      analysis_data: analysisJson,
      created_at: nowStamp(),
      file_name: '',
      test_type: testType,
    })
    .select('test_id')
    .single();

  if (testError) throw testError;
  const testId = Number((testRow as { test_id: number }).test_id);

  if (total > 0) {
    const rows = input.questions.map((q) => ({
      test_id: testId,
      question_number: q.questionNumber.trim() || '미분류',
      topic: q.topic.trim() || '미분류',
      question_type: q.questionType || '객관식',
      difficulty: q.difficulty || 'C',
      question_method: q.method.trim(),
    }));
    const { error: qError } = await supabase.from('test_questions').insert(rows);
    if (qError) throw qError;
  }

  return testId;
}

/** 문항들 중 가장 많이 등장한 단원(빈 값·"미분류"는 제외) — 자동 제목 생성용. */
export function inferDominantTopic(questions: TestQuestionDraft[]): string {
  const counts = new Map<string, number>();
  for (const q of questions) {
    const t = q.topic.trim();
    if (!t || t === '미분류') continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  let best = '미분류';
  let bestCount = 0;
  for (const [topic, count] of counts) {
    if (count > bestCount) {
      best = topic;
      bestCount = count;
    }
  }
  return best;
}

function sanitizeTitlePart(value: string, maxLen: number): string {
  return value.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, maxLen) || '테스트';
}

/** 스트림릿 _generate_test_file_title()과 동일한 형식: YYYY-MM-DD_단원명_원본파일명. */
export function suggestTestTitle(
  dominantTopic: string,
  uploadFilename: string | undefined,
  testDate: string,
): string {
  const stem = uploadFilename ? uploadFilename.replace(/\.[^./]+$/, '') : '테스트';
  const topicPart = sanitizeTitlePart(dominantTopic, 24);
  const stemPart = sanitizeTitlePart(stem, 32);
  return `${testDate}_${topicPart}_${stemPart}`;
}
