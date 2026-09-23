import { supabase } from './supabaseClient';

/**
 * "학원시험 AI분석" 학생별 보고서용 데이터 조회 — 스트림릿 database.py /
 * homework.py / app.py의 보고서용 함수들을 Supabase 조회로 이식.
 * (get_test_type, get_test_questions, get_student_profile,
 *  get_student_result_record, get_student_test_score_history,
 *  get_student_attendance_summary_for_report, get_student_homework_performance_stats,
 *  get_student_month_topic_stats, prev_year_month, _report_month_periods)
 */

export type ReportMode = 'lite' | 'standard' | 'premium';

export const TEST_CATEGORIES = ['일일테스트', '주간테스트', '월간테스트', '단원테스트', '기타'];

const REPORT_MODE_BY_CATEGORY: Record<string, ReportMode> = {
  일일테스트: 'lite',
  월간테스트: 'premium',
};

export function reportModeFor(testCategory: string): ReportMode {
  return REPORT_MODE_BY_CATEGORY[(testCategory || '').trim()] ?? 'standard';
}

export interface TestMeta {
  testId: number;
  testName: string;
  date: string;
  totalQuestions: number;
  testType: string;
}

export async function fetchTestMeta(testId: number): Promise<TestMeta> {
  const { data, error } = await supabase
    .from('tests')
    .select('test_id, test_name, date, total_questions, test_type')
    .eq('test_id', testId)
    .single();
  if (error) throw error;
  const r = data as { test_id: number; test_name: string; date: string; total_questions: number; test_type: string | null };
  return {
    testId: r.test_id,
    testName: r.test_name,
    date: String(r.date),
    totalQuestions: r.total_questions,
    testType: r.test_type || '일일테스트',
  };
}

export interface QuestionDetail {
  questionNumber: string;
  topic: string;
  difficulty: string;
  questionType: string;
  questionMethod: string;
}

export async function fetchTestQuestionDetails(testId: number): Promise<QuestionDetail[]> {
  const { data, error } = await supabase
    .from('test_questions')
    .select('question_number, topic, difficulty, question_type, question_method')
    .eq('test_id', testId);
  if (error) throw error;
  type Row = {
    question_number: string;
    topic: string | null;
    difficulty: string | null;
    question_type: string | null;
    question_method: string | null;
  };
  const rows = ((data as Row[]) ?? []).map((r) => ({
    questionNumber: String(r.question_number),
    topic: String(r.topic ?? ''),
    difficulty: String(r.difficulty ?? ''),
    questionType: r.question_type || '객관식',
    questionMethod: r.question_method || '',
  }));
  rows.sort((a, b) => {
    const na = parseInt(a.questionNumber, 10);
    const nb = parseInt(b.questionNumber, 10);
    const va = Number.isNaN(na) ? 0 : na;
    const vb = Number.isNaN(nb) ? 0 : nb;
    return va - vb || a.questionNumber.localeCompare(b.questionNumber);
  });
  return rows;
}

/** 이 시험을 본 전원(반 무관)의 점수 — 스트림릿 all_scores_batch와 동일. */
export async function fetchTestAllScores(testId: number): Promise<number[]> {
  const { data, error } = await supabase.from('student_results').select('score').eq('test_id', testId);
  if (error) throw error;
  return ((data as { score: number }[]) ?? []).map((r) => Number(r.score));
}

export interface StudentReportProfile {
  studentId: string;
  name: string;
  className: string;
  school: string;
  grade: string;
  parentPhone: string;
}

export async function fetchStudentReportProfile(studentId: string): Promise<StudentReportProfile> {
  const { data, error } = await supabase
    .from('students')
    .select('id, name, school, grade, parent_phone, classes ( name )')
    .eq('id', Number(studentId))
    .single();
  if (error) throw error;
  const r = data as unknown as {
    id: number;
    name: string;
    school: string | null;
    grade: string | null;
    parent_phone: string | null;
    classes: { name: string } | null;
  };
  return {
    studentId: String(r.id),
    name: r.name,
    className: r.classes?.name ?? '—',
    school: r.school ?? '',
    grade: r.grade ?? '',
    parentPhone: r.parent_phone ?? '',
  };
}

export interface StudentResultRecord {
  score: number;
  wrongNumbers: number[];
}

export async function fetchStudentResultRecord(studentId: string, testId: number): Promise<StudentResultRecord | null> {
  const { data, error } = await supabase
    .from('student_results')
    .select('score, wrong_numbers')
    .eq('student_id', Number(studentId))
    .eq('test_id', testId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as { score: number; wrong_numbers: string | null };
  let wrongNumbers: number[] = [];
  try {
    const parsed = r.wrong_numbers ? JSON.parse(r.wrong_numbers) : [];
    if (Array.isArray(parsed)) wrongNumbers = parsed.map(Number).filter((n) => Number.isFinite(n));
  } catch {
    wrongNumbers = [];
  }
  return { score: Number(r.score), wrongNumbers };
}

export interface ScoreHistoryEntry {
  testName: string;
  date: string;
  score: number;
  testId: number;
}

/** 날짜순(같은 날이면 기록순) 전체 학원TEST 점수 이력. */
export async function fetchStudentScoreHistory(studentId: string): Promise<ScoreHistoryEntry[]> {
  const { data, error } = await supabase
    .from('student_results')
    .select('score, test_id, recorded_at, tests ( test_name, date )')
    .eq('student_id', Number(studentId));
  if (error) throw error;
  type Row = {
    score: number;
    test_id: number;
    recorded_at: string | null;
    tests: { test_name: string; date: string } | null;
  };
  const rows = ((data as unknown as Row[]) ?? []).filter((r) => r.tests);
  rows.sort((a, b) => {
    const da = String(a.tests!.date);
    const db = String(b.tests!.date);
    if (da !== db) return da < db ? -1 : 1;
    const ra = a.recorded_at ?? '';
    const rb = b.recorded_at ?? '';
    return ra < rb ? -1 : ra > rb ? 1 : 0;
  });
  return rows.map((r) => ({
    testName: r.tests!.test_name,
    date: String(r.tests!.date),
    score: Number(r.score),
    testId: r.test_id,
  }));
}

export function prevYearMonth(yearMonth: string): string {
  const y = parseInt(yearMonth.slice(0, 4), 10);
  const m = parseInt(yearMonth.slice(5, 7), 10);
  if (Number.isNaN(y) || Number.isNaN(m)) return '';
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** 보고서 기준 기간 — 시험일이 속한 달의 1일 ~ 시험일(현재까지). */
export function reportMonthPeriod(testDate: string): { from: string; to: string; month: number } {
  const ym = testDate.slice(0, 7);
  return { from: `${ym}-01`, to: testDate, month: parseInt(ym.slice(5, 7), 10) };
}

export interface AttendanceSummary {
  present: number;
  late: number;
  absent: number;
  rate: number | null;
}

/** 휴강(cancelled)은 그날 수업 자체가 없었으므로 분모에서 제외. */
export async function fetchStudentAttendanceSummary(
  studentId: string,
  fromDate: string,
  toDate: string,
): Promise<AttendanceSummary> {
  const { data, error } = await supabase
    .from('attendance')
    .select('status')
    .eq('student_id', Number(studentId))
    .gte('session_date', fromDate)
    .lte('session_date', toDate);
  if (error) throw error;
  const rows = ((data as { status: string }[]) ?? []).filter((r) => r.status !== 'cancelled');
  const present = rows.filter((r) => r.status === 'present').length;
  const late = rows.filter((r) => r.status === 'late').length;
  const absent = rows.filter((r) => r.status === 'absent').length;
  const total = rows.length;
  const rate = total ? Math.round(((present + late) / total) * 1000) / 10 : null;
  return { present, late, absent, rate };
}

export interface HomeworkPerfStats {
  high: number;
  mid: number;
  low: number;
  rate: number | null;
}

/** 상=100·중=50·하=0 평균. 결석·휴강일 기록은 제외. */
export async function fetchStudentHomeworkPerfStats(
  studentId: string,
  fromDate: string,
  toDate: string,
): Promise<HomeworkPerfStats> {
  const [{ data, error }, { data: excludedData, error: excludedError }] = await Promise.all([
    supabase
      .from('student_homework_performance')
      .select('session_date, level')
      .eq('student_id', Number(studentId))
      .gte('session_date', fromDate)
      .lte('session_date', toDate),
    supabase
      .from('attendance')
      .select('session_date')
      .eq('student_id', Number(studentId))
      .gte('session_date', fromDate)
      .lte('session_date', toDate)
      .in('status', ['absent', 'cancelled']),
  ]);
  if (error) throw error;
  if (excludedError) throw excludedError;
  const excluded = new Set(((excludedData as { session_date: string }[]) ?? []).map((r) => r.session_date));
  const rows = ((data as { session_date: string; level: string }[]) ?? []).filter((r) => !excluded.has(r.session_date));
  const high = rows.filter((r) => r.level === '상').length;
  const mid = rows.filter((r) => r.level === '중').length;
  const low = rows.filter((r) => r.level === '하').length;
  const total = high + mid + low;
  const rate = total ? Math.round(((high * 100 + mid * 50) / total) * 10) / 10 : null;
  return { high, mid, low, rate };
}

export interface MonthTopicStat {
  topic: string;
  correct: number;
  total: number;
}

/** 학생의 특정 달(YYYY-MM) 전체 시험 기준 단원별 누적 정답률. */
export async function fetchStudentMonthTopicStats(studentId: string, yearMonth: string): Promise<MonthTopicStat[]> {
  const { data, error } = await supabase
    .from('student_results')
    .select('test_id, wrong_numbers, tests!inner ( date )')
    .eq('student_id', Number(studentId))
    .like('tests.date', `${yearMonth}%`);
  if (error) throw error;
  const rows = (data as unknown as { test_id: number; wrong_numbers: string | null }[]) ?? [];
  if (rows.length === 0) return [];

  const { data: qData, error: qError } = await supabase
    .from('test_questions')
    .select('test_id, question_number, topic')
    .in(
      'test_id',
      rows.map((r) => r.test_id),
    );
  if (qError) throw qError;
  const questionsByTest = new Map<number, { question_number: string; topic: string | null }[]>();
  for (const q of (qData as { test_id: number; question_number: string; topic: string | null }[]) ?? []) {
    const list = questionsByTest.get(q.test_id) ?? [];
    list.push(q);
    questionsByTest.set(q.test_id, list);
  }

  const stats = new Map<string, { correct: number; total: number }>();
  for (const r of rows) {
    let wrongs = new Set<number>();
    try {
      const parsed = r.wrong_numbers ? JSON.parse(r.wrong_numbers) : [];
      if (Array.isArray(parsed)) wrongs = new Set(parsed.map(Number));
    } catch {
      wrongs = new Set();
    }
    for (const q of questionsByTest.get(r.test_id) ?? []) {
      const tp = String(q.topic ?? '').trim() || '미분류';
      const s = stats.get(tp) ?? { correct: 0, total: 0 };
      s.total += 1;
      if (!wrongs.has(parseInt(q.question_number, 10))) s.correct += 1;
      stats.set(tp, s);
    }
  }
  return Array.from(stats.entries()).map(([topic, v]) => ({ topic, correct: v.correct, total: v.total }));
}
