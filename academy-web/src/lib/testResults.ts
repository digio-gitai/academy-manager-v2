import { supabase } from './supabaseClient';

export interface StudentTestResult {
  wrongNumbers: number[];
  wrongCount: number;
  score: number;
  recordedAt: string;
}

interface StudentResultRow {
  student_id: number;
  wrong_numbers: string | null;
  wrong_count: number;
  score: number;
  recorded_at: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function nowStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 오답 번호 목록 정리 — 1 미만/중복 제거 후 오름차순. database.py의 _normalize_wrong_numbers()와 동일. */
function normalizeWrongNumbers(wrongNumbers: Iterable<number>): number[] {
  const seen = new Set<number>();
  for (const raw of wrongNumbers) {
    const n = Math.trunc(raw);
    if (!Number.isFinite(n) || n < 1) continue;
    seen.add(n);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

/** 점수 = (총문항 - 오답) / 총문항 * 100. database.py의 compute_score_from_wrong()과 동일. */
export function computeScoreFromWrong(totalQuestions: number, wrongNumbers: Iterable<number>): number {
  const total = Math.max(Math.trunc(totalQuestions), 1);
  const wrong = normalizeWrongNumbers(wrongNumbers).length;
  const correct = Math.max(total - wrong, 0);
  return Math.round((correct / total) * 1000) / 10;
}

/**
 * 이 테스트에 이미 저장된 학생별 오답/점수를 {student_id(문자열): 결과} 형태로 조회.
 * 스트림릿의 get_test_results_by_student()와 동일한 목적 — 새로고침해도 이미
 * 체크했던 오답 번호가 화면에 그대로 복원되도록 하기 위함.
 */
export async function fetchExistingTestResults(testId: number): Promise<Map<string, StudentTestResult>> {
  const { data, error } = await supabase
    .from('student_results')
    .select('student_id, wrong_numbers, wrong_count, score, recorded_at')
    .eq('test_id', testId);
  if (error) throw error;

  const map = new Map<string, StudentTestResult>();
  for (const row of (data as StudentResultRow[] | null) ?? []) {
    let wrongNumbers: number[] = [];
    try {
      const parsed = row.wrong_numbers ? JSON.parse(row.wrong_numbers) : [];
      if (Array.isArray(parsed)) {
        wrongNumbers = parsed.map((v) => Number(v)).filter((n) => Number.isFinite(n));
      }
    } catch {
      wrongNumbers = [];
    }
    map.set(String(row.student_id), {
      wrongNumbers,
      wrongCount: row.wrong_count,
      score: row.score,
      recordedAt: row.recorded_at,
    });
  }
  return map;
}

/**
 * 학생 1명의 오답 체크 결과를 student_results에 저장(점수 자동 계산, upsert).
 * 스트림릿의 save_student_result()와 동일 — 단, sync_all_csvs()/
 * append_student_test_result() 같은 로컬 CSV·레거시 캐시 동기화는 React 쪽에는
 * 대응 기능이 없어서 생략(성적조회 등은 4단계에서 원본 테이블을 직접 조회하는
 * 방식으로 만들 예정이라 캐시 동기화 자체가 불필요해짐).
 */
export async function saveStudentTestResult(params: {
  studentId: string;
  testId: number;
  totalQuestions: number;
  wrongNumbers: Iterable<number>;
}): Promise<StudentTestResult> {
  const normalized = normalizeWrongNumbers(params.wrongNumbers);
  const score = computeScoreFromWrong(params.totalQuestions, normalized);
  const recordedAt = nowStamp();

  const { error } = await supabase.from('student_results').upsert(
    {
      student_id: Number(params.studentId),
      test_id: params.testId,
      wrong_numbers: JSON.stringify(normalized),
      wrong_count: normalized.length,
      score,
      recorded_at: recordedAt,
    },
    { onConflict: 'student_id,test_id' },
  );
  if (error) throw error;

  return {
    wrongNumbers: normalized,
    wrongCount: normalized.length,
    score,
    recordedAt,
  };
}
