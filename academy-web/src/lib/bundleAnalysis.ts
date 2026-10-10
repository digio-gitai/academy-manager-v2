import { supabase } from './supabaseClient';
import type { StudentProfile } from '../types/student';

// "묶음 분석": 선생님이 체크한 시험지(tests) 여러 개를 한 묶음으로 보고, 학생별로
// 회차별 점수 / 응시자 평균 / 상위 비율을 계산한다.
//   - 점수 원본은 student_results(학생×시험 1행, UNIQUE) — 100점 환산값(computeScoreFromWrong).
//     한 시험에 학생당 1행만 있으므로 "최초 응시만 인정"은 구조적으로 보장됨.
//   - 재시험은 별도 테이블(test_retests)에만 기록하고 여기 통계에는 절대 안 들어간다.
//   - 평균/석차는 "그 시험을 실제로 본 학생끼리"만 계산 (결석 = 행 없음 = 0점 처리 아님).

export interface BundleTest {
  id: number;
  name: string;
  date: string;
  testType: string;
  totalQuestions: number;
  takers: number;
}

export interface BundleCell {
  testId: number;
  score: number | null; // null = 미응시
  avg: number;
  n: number;
  rank: number | null;
  topPct: number | null; // 상위 N% (작을수록 좋음)
}

export interface BundleStudentRow {
  studentId: number;
  name: string;
  className: string;
  grade: string;
  taken: number;
  total: number;
  avgScore: number | null;
  avgDev: number | null;
  avgTopPct: number | null;
  cells: BundleCell[];
}

export interface BundleTestStat {
  testId: number;
  name: string;
  date: string;
  n: number;
  avg: number;
}

export interface BundleResult {
  tests: BundleTestStat[];
  students: BundleStudentRow[];
}

interface ResultRow {
  student_id: number;
  test_id: number;
  score: number;
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; details?: unknown; hint?: unknown };
    const parts = [e.message, e.details, e.hint].filter((v): v is string => typeof v === 'string' && v.trim() !== '');
    if (parts.length > 0) return parts.join(' — ');
  }
  return String(err);
}

/** 학원시험(tests) 전체 목록 + 응시자 수. 최신 날짜 순. */
export async function fetchBundleTests(): Promise<BundleTest[]> {
  const { data, error } = await supabase
    .from('tests')
    .select('test_id, test_name, date, test_type, total_questions, student_results(count)')
    .order('date', { ascending: false });
  if (error) throw new Error(describe(error));

  type Row = {
    test_id: number;
    test_name: string;
    date: string;
    test_type: string | null;
    total_questions: number | null;
    student_results: { count: number }[] | null;
  };
  return ((data as Row[] | null) ?? []).map((r) => ({
    id: r.test_id,
    name: r.test_name,
    date: r.date,
    testType: (r.test_type ?? '').trim() || '기타',
    totalQuestions: r.total_questions ?? 0,
    takers: r.student_results?.[0]?.count ?? 0,
  }));
}

/** 시험지 이름만 수정 — 점수/연결 정보는 건드리지 않음. */
export async function renameTest(testId: number, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('시험지 이름은 비워둘 수 없습니다.');
  const { error } = await supabase.from('tests').update({ test_name: trimmed }).eq('test_id', testId);
  if (error) throw new Error(describe(error));
}

/** 이 학생이 응시 기록(student_results)을 가진 시험 id 전체 — "학생 기준" 선택용. */
export async function fetchStudentTestIds(studentId: number): Promise<Set<number>> {
  const { data, error } = await supabase.from('student_results').select('test_id').eq('student_id', studentId);
  if (error) throw new Error(describe(error));
  return new Set(((data as { test_id: number }[] | null) ?? []).map((r) => r.test_id));
}

async function fetchResults(testIds: number[]): Promise<ResultRow[]> {
  if (testIds.length === 0) return [];
  const out: ResultRow[] = [];
  const PAGE = 1000; // PostgREST 기본 최대 행 수
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('student_results')
      .select('student_id, test_id, score')
      .in('test_id', testIds)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(describe(error));
    const rows = (data as ResultRow[] | null) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * 묶음 통계 계산.
 * @param gradeFilter 비어 있으면 전체. 값이 있으면 그 학년 학생만 모집단(평균·석차 계산 대상)에 포함.
 */
export async function computeBundle(
  tests: BundleTest[],
  students: StudentProfile[],
  gradeFilter: string,
): Promise<BundleResult> {
  const ordered = [...tests].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'ko'));
  const raw = await fetchResults(ordered.map((t) => t.id));

  const byId = new Map<number, StudentProfile>();
  for (const s of students) byId.set(Number(s.id), s);

  // 대상 학년 필터: 학생 정보를 아는 경우에만 학년 비교, 퇴원 등으로 모르면 전체일 때만 포함.
  const inScope = (studentId: number): boolean => {
    if (!gradeFilter) return true;
    const s = byId.get(studentId);
    return !!s && s.grade === gradeFilter;
  };
  const results = raw.filter((r) => inScope(r.student_id));

  const scoresByTest = new Map<number, ResultRow[]>();
  for (const r of results) {
    const list = scoresByTest.get(r.test_id);
    if (list) list.push(r);
    else scoresByTest.set(r.test_id, [r]);
  }

  const testStats: BundleTestStat[] = ordered.map((t) => {
    const rows = scoresByTest.get(t.id) ?? [];
    const avg = rows.length ? rows.reduce((a, r) => a + r.score, 0) / rows.length : 0;
    return { testId: t.id, name: t.name, date: t.date, n: rows.length, avg: Math.round(avg * 10) / 10 };
  });
  const statById = new Map(testStats.map((s) => [s.testId, s]));

  const studentIds = new Set(results.map((r) => r.student_id));
  const rows: BundleStudentRow[] = [];
  for (const sid of studentIds) {
    const profile = byId.get(sid);
    if (!profile) continue; // 퇴원 등으로 이름을 모르는 학생은 평균 계산에만 쓰고 목록엔 안 올림
    const cells: BundleCell[] = ordered.map((t) => {
      const stat = statById.get(t.id)!;
      const mine = (scoresByTest.get(t.id) ?? []).find((r) => r.student_id === sid);
      if (!mine) return { testId: t.id, score: null, avg: stat.avg, n: stat.n, rank: null, topPct: null };
      const higher = (scoresByTest.get(t.id) ?? []).filter((r) => r.score > mine.score).length;
      const rank = higher + 1;
      return {
        testId: t.id,
        score: mine.score,
        avg: stat.avg,
        n: stat.n,
        rank,
        topPct: Math.ceil((rank / stat.n) * 100),
      };
    });
    const taken = cells.filter((c) => c.score !== null);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    rows.push({
      studentId: sid,
      name: profile.name,
      className: profile.className,
      grade: profile.grade,
      taken: taken.length,
      total: ordered.length,
      avgScore: mean(taken.map((c) => c.score as number)),
      avgDev: mean(taken.map((c) => (c.score as number) - c.avg)),
      avgTopPct: mean(taken.map((c) => c.topPct as number)),
      cells,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return { tests: testStats, students: rows };
}

// ───────────── 재시험 기록 (test_retests) ─────────────

export interface RetestAttempt {
  id: number;
  studentId: number;
  testId: number;
  attemptNo: number;
  passed: boolean;
  testedOn: string;
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${today()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function fetchRetests(testId: number): Promise<RetestAttempt[]> {
  const { data, error } = await supabase
    .from('test_retests')
    .select('id, student_id, test_id, attempt_no, passed, tested_on')
    .eq('test_id', testId)
    .order('attempt_no', { ascending: true });
  if (error) throw new Error(describe(error));
  type Row = { id: number; student_id: number; test_id: number; attempt_no: number; passed: boolean; tested_on: string };
  return ((data as Row[] | null) ?? []).map((r) => ({
    id: r.id,
    studentId: r.student_id,
    testId: r.test_id,
    attemptNo: r.attempt_no,
    passed: r.passed,
    testedOn: r.tested_on,
  }));
}

/** 통과/실패 한 번 기록 — 회차는 기존 최대 회차 + 1로 자동 부여. */
export async function addRetest(studentId: number, testId: number, passed: boolean, nextAttemptNo: number): Promise<void> {
  const { error } = await supabase.from('test_retests').insert({
    student_id: studentId,
    test_id: testId,
    attempt_no: nextAttemptNo,
    passed,
    tested_on: today(),
    created_at: nowStamp(),
  });
  if (error) throw new Error(describe(error));
}

export async function deleteRetest(id: number): Promise<void> {
  const { error } = await supabase.from('test_retests').delete().eq('id', id);
  if (error) throw new Error(describe(error));
}

/** 이 시험에서 점수가 기준 미만인 학생(재시험 후보)과 점수. */
export async function fetchBelowThreshold(testId: number, threshold: number): Promise<{ studentId: number; score: number }[]> {
  const { data, error } = await supabase
    .from('student_results')
    .select('student_id, score')
    .eq('test_id', testId)
    .lt('score', threshold);
  if (error) throw new Error(describe(error));
  return ((data as { student_id: number; score: number }[] | null) ?? []).map((r) => ({
    studentId: r.student_id,
    score: r.score,
  }));
}

/** 이 시험의 전체 점수(재시험 기록이 있는 학생의 본시험 점수 표시용). */
export async function fetchScoresForTest(testId: number): Promise<Map<number, number>> {
  const rows = await fetchResults([testId]);
  return new Map(rows.map((r) => [r.student_id, r.score]));
}

const RETEST_THRESHOLD_KEY = 'retest_threshold';

/** 재시험 기준 점수(기본 70) — 재시험 기록 탭과 개인 추이 보고서가 같은 값을 쓴다. */
export function loadRetestThreshold(): number {
  try {
    const v = Number(localStorage.getItem(RETEST_THRESHOLD_KEY));
    return Number.isFinite(v) && v > 0 ? v : 70;
  } catch {
    return 70;
  }
}

export function saveRetestThreshold(v: number): void {
  try {
    localStorage.setItem(RETEST_THRESHOLD_KEY, String(v));
  } catch {
    /* 저장 못 해도 동작에는 영향 없음 */
  }
}

/** 여러 시험의 재시험 기록을 한 번에 조회 (개인 추이 보고서용). */
export async function fetchRetestsForTests(testIds: number[]): Promise<RetestAttempt[]> {
  if (testIds.length === 0) return [];
  const { data, error } = await supabase
    .from('test_retests')
    .select('id, student_id, test_id, attempt_no, passed, tested_on')
    .in('test_id', testIds)
    .order('attempt_no', { ascending: true });
  if (error) throw new Error(describe(error));
  type Row = { id: number; student_id: number; test_id: number; attempt_no: number; passed: boolean; tested_on: string };
  return ((data as Row[] | null) ?? []).map((r) => ({
    id: r.id,
    studentId: r.student_id,
    testId: r.test_id,
    attemptNo: r.attempt_no,
    passed: r.passed,
    testedOn: r.tested_on,
  }));
}

/**
 * AI 총평용 요약 텍스트 — Edge Function(generate-parent-comment)의 integratedSummary로 넘긴다.
 * 이미 계산된 숫자만 담고, 데이터에 없는 내용은 AI가 지어내지 않도록 프롬프트가 막고 있다.
 */
export function summarizeForAi(params: {
  student: BundleStudentRow;
  tests: BundleTestStat[];
  mode: 'group' | 'trend';
  retests: RetestAttempt[];
  threshold: number;
}): string {
  const { student, tests, mode, retests, threshold } = params;
  const lines: string[] = [];
  lines.push(
    mode === 'group'
      ? `[비교 방식] 같은 시험지를 본 학생들과 비교 (내신대비 기출). 응시 ${student.taken}/${student.total}회.`
      : `[비교 방식] 학생 본인의 점수 흐름만 비교 (단원평가). 응시 ${student.taken}/${student.total}회.`,
  );
  if (student.avgScore !== null) lines.push(`평균 점수 ${student.avgScore.toFixed(1)}점 (100점 환산)`);
  if (mode === 'group' && student.avgDev !== null && student.avgTopPct !== null) {
    lines.push(
      `응시자 평균 대비 평균 ${student.avgDev >= 0 ? '+' : ''}${student.avgDev.toFixed(1)}점, 평균 상위 ${student.avgTopPct.toFixed(0)}%`,
    );
  }
  lines.push('[회차별 결과]');
  tests.forEach((t, i) => {
    const c = student.cells[i];
    if (c.score === null) {
      lines.push(`- ${t.name}: 미응시`);
    } else if (mode === 'group') {
      lines.push(`- ${t.name}: ${c.score.toFixed(0)}점 (응시자 평균 ${c.avg.toFixed(0)}점, 상위 ${c.topPct}%, ${c.n}명 중)`);
    } else {
      lines.push(`- ${t.name}: ${c.score.toFixed(0)}점${c.score < threshold ? ' (기준 미달)' : ''}`);
    }
  });
  if (mode === 'trend') {
    const mine = retests.filter((r) => r.studentId === student.studentId);
    for (const t of tests) {
      const list = mine.filter((r) => r.testId === t.testId).sort((a, b) => a.attemptNo - b.attemptNo);
      if (list.length === 0) continue;
      const passedAt = list.find((r) => r.passed);
      lines.push(
        `[재시험] ${t.name}: ${list.length}회 실시, ${passedAt ? `${passedAt.attemptNo}회차에 통과` : '아직 통과하지 못함'}`,
      );
    }
  }
  return lines.join('\n');
}
