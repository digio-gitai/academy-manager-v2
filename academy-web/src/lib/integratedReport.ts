import { supabase } from './supabaseClient';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function nowStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "통합보고서 작성" 화면에서 시험을 고르는 체크박스용 후보 목록 1건. */
export interface AcademyTestOption {
  id: number;
  name: string;
  date: string;
  testType: string;
  totalQuestions: number;
  score: number;
  wrongCount: number;
}

/**
 * 이 학생이 실제로 오답 체크까지 끝낸 학원TEST(단원테스트 등) 목록 —
 * '학원시험 AI분석' 탭에서 저장된 것만 대상. 학교시험/모의고사는 애초에
 * 이 테이블(student_results/tests)이 아니라 별도 external_scores 쪽에 있어서
 * 여기 섞여 들어올 수 없음 — 그래서 "학원 자체 시험만" 범위를 별도로 필터링할
 * 필요 없이, 이 조회 자체가 곧 올바른 범위가 됨.
 */
export async function fetchAcademyTestOptions(studentId: string): Promise<AcademyTestOption[]> {
  const { data, error } = await supabase
    .from('student_results')
    .select('score, wrong_count, tests ( test_id, test_name, date, total_questions, test_type )')
    .eq('student_id', Number(studentId));
  if (error) throw error;

  type Row = {
    score: number;
    wrong_count: number;
    tests: { test_id: number; test_name: string; date: string; total_questions: number; test_type: string } | null;
  };
  const rows = ((data as unknown as Row[]) ?? []).filter((r) => r.tests);
  const options = rows.map((r) => ({
    id: r.tests!.test_id,
    name: r.tests!.test_name,
    date: r.tests!.date,
    testType: r.tests!.test_type,
    totalQuestions: r.tests!.total_questions,
    score: Number(r.score),
    wrongCount: r.wrong_count,
  }));
  options.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return options;
}

export interface GradeCuts {
  grade5: number;
  grade4: number;
  grade3Low: number;
  grade3High: number;
  grade2: number;
  grade1: number;
}

export interface IrtStats {
  percentile: number;
  rank: number;
  grade: number; // 1(최상)~5(최하)
  peerCount: number;
  meanScore: number;
  stdDev: number;
  zScore: number;
  gradeCuts: GradeCuts;
}

/**
 * 스트림릿 app.py의 _compute_web_report_irt_stats()를 그대로 이식한 함수.
 * peerScores에는 이미 이 학생 본인 점수가 포함되어 있어도/없어도 됨(중복이면
 * 한 번만 카운트하지 않고 원본과 동일하게 "없으면 추가"만 함).
 */
export function computeIrtStats(studentScore: number, peerScores: number[]): IrtStats {
  const scores = peerScores.length > 0 ? [...peerScores] : [studentScore];
  if (!scores.includes(studentScore)) {
    scores.push(studentScore);
  }
  scores.sort((a, b) => a - b);
  const n = scores.length;
  const mean = scores.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? scores.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  const std = Math.sqrt(variance);
  const zScore = std > 0 ? (studentScore - mean) / std : 0;
  const below = scores.filter((s) => s < studentScore).length;
  const equal = scores.filter((s) => s === studentScore).length;
  const percentile = Math.round(((below + 0.5 * equal) / n) * 1000) / 10;
  const rank = scores.filter((s) => s > studentScore).length + 1;

  let grade: number;
  if (percentile >= 90) grade = 1;
  else if (percentile >= 70) grade = 2;
  else if (percentile >= 50) grade = 3;
  else if (percentile >= 30) grade = 4;
  else grade = 5;

  const r1 = (v: number) => Math.round(v * 10) / 10;
  let gradeCuts: GradeCuts;
  if (n >= 5) {
    const sorted = [...scores].sort((a, b) => a - b);
    const cut = (pct: number) => {
      const idx = Math.min(Math.floor((sorted.length * pct) / 100), sorted.length - 1);
      return r1(sorted[idx]);
    };
    gradeCuts = {
      grade5: cut(20),
      grade4: cut(40),
      grade3Low: cut(45),
      grade3High: cut(55),
      grade2: cut(70),
      grade1: cut(90),
    };
  } else {
    gradeCuts = {
      grade5: r1(mean - 2 * std),
      grade4: r1(mean - std),
      grade3Low: r1(mean - 0.5 * std),
      grade3High: r1(mean + 0.5 * std),
      grade2: r1(mean + std),
      grade1: r1(mean + 2 * std),
    };
  }

  return {
    percentile,
    rank,
    grade,
    peerCount: n,
    meanScore: r1(mean),
    stdDev: Math.round(std * 100) / 100,
    zScore: Math.round(zScore * 100) / 100,
    gradeCuts,
  };
}

export interface PerTestSummary {
  testId: number;
  testName: string;
  date: string;
  testType: string;
  score: number;
  totalQuestions: number;
  correctCount: number;
  wrongCount: number;
  irt: IrtStats;
}

/** 단원별/유형별/난이도별/인지영역별 분석 표의 행 1개(정답률 %는 소수1자리). */
export interface CategoryStat {
  label: string;
  total: number;
  correct: number;
  wrong: number;
  accuracy: number;
}

export interface IntegratedReportData {
  studentId: string;
  studentName: string;
  className: string;
  grade: string;
  generatedAt: string;
  tests: PerTestSummary[];
  combinedTotalQuestions: number;
  combinedCorrect: number;
  combinedWrong: number;
  combinedAccuracy: number;
  averageScore: number;
  unitAnalysis: CategoryStat[];
  typeAnalysis: CategoryStat[];
  /** 객관식/서술형(question_type) 정답률 — page 1 "문제 타입 분석"용. */
  formatAnalysis: CategoryStat[];
  difficultyAnalysis: CategoryStat[];
  cognitiveAnalysis: CategoryStat[];
  weakTopics: CategoryStat[];
  strongTopics: CategoryStat[];
  /** 인지영역 데이터가 하나라도 "미분류"가 아닌 게 있는지 — 리포트에서 인지영역
   * 페이지를 실제로 그릴지, "데이터 준비 중" 안내를 보여줄지 판단하는 데 사용. */
  hasCognitiveData: boolean;
}


/**
 * "통합보고서 AI 총평" 요청 시 Edge Function에 넘길 텍스트 블록을 만든다.
 * buildIntegratedReportData()가 계산한 결과를 사람이 읽는 요약 문장들로 바꿔서
 * GPT 프롬프트에 그대로 넣을 수 있게 함(2026-08-29 추가 — "보고서 내용이
 * 빈약하다"는 실사용 피드백에 대응: 학부모님께 전하는 글 자체를 이 통합 데이터
 * 기반으로 다시 쓰게 해서 구체적인 내용이 들어가도록 함).
 */
export function summarizeForAiComment(data: IntegratedReportData): string {
  const lines: string[] = [];
  lines.push(`- 대상 기간 시험 ${data.tests.length}개, 평균 점수 ${data.averageScore}점, 통합 정답률 ${data.combinedAccuracy}% (${data.combinedCorrect}/${data.combinedTotalQuestions}문항)`);
  if (data.unitAnalysis.length > 0) {
    lines.push('- 단원별 정답률: ' + data.unitAnalysis.map((u) => `${u.label} ${u.accuracy}%(${u.correct}/${u.total})`).join(', '));
  }
  if (data.difficultyAnalysis.length > 0) {
    lines.push('- 난이도별 정답률: ' + data.difficultyAnalysis.map((d) => `${d.label} ${d.accuracy}%`).join(', '));
  }
  if (data.hasCognitiveData && data.cognitiveAnalysis.length > 0) {
    lines.push('- 인지영역별 정답률: ' + data.cognitiveAnalysis.filter((c) => c.label !== '미분류').map((c) => `${c.label} ${c.accuracy}%`).join(', '));
  }
  if (data.weakTopics.length > 0) {
    lines.push('- 취약 단원: ' + data.weakTopics.map((t) => `${t.label}(${t.accuracy}%)`).join(', '));
  }
  if (data.strongTopics.length > 0) {
    lines.push('- 강점 단원: ' + data.strongTopics.map((t) => `${t.label}(${t.accuracy}%)`).join(', '));
  }
  return lines.join('\n');
}

const DIFF_LABELS: Record<string, string> = { A: '최상', B: '상', C: '중', D: '하', E: '최하' };
const DIFF_ORDER = ['최상', '상', '중', '하', '최하'];
const COG_ORDER = ['계산', '이해', '추론', '해결', '미분류'];

function bump(map: Map<string, { total: number; correct: number }>, key: string, isCorrect: boolean) {
  const cur = map.get(key) ?? { total: 0, correct: 0 };
  cur.total += 1;
  if (isCorrect) cur.correct += 1;
  map.set(key, cur);
}

function toCategoryStats(
  map: Map<string, { total: number; correct: number }>,
  order?: string[],
): CategoryStat[] {
  const entries = Array.from(map.entries()).map(([label, v]) => ({
    label,
    total: v.total,
    correct: v.correct,
    wrong: v.total - v.correct,
    accuracy: v.total > 0 ? Math.round((v.correct / v.total) * 1000) / 10 : 0,
  }));
  if (order) {
    entries.sort((a, b) => {
      const ia = order.indexOf(a.label);
      const ib = order.indexOf(b.label);
      if (ia === -1 && ib === -1) return a.label.localeCompare(b.label);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  } else {
    entries.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  }
  return entries;
}

/**
 * "3단계: 여러 단원테스트 통합 집계 로직"의 핵심 함수.
 * 선택된 testIds(단원테스트 여러 개 + 전범위테스트 등)의 문항 데이터를 전부
 * 하나로 합쳐서, 단원별/유형별(question_method)/난이도별/인지영역별 정답률과
 * 취약·강점 단원, 그리고 시험별 백분위·석차(같은 반 학생 기준)를 계산한다.
 *
 * 학교시험/모의고사는 애초에 tests/test_questions/student_results 테이블에
 * 존재하지 않으므로(별도 external_scores 구조) 이 함수의 범위에 자연스럽게
 * 들어오지 않음 — 학원 자체 시험(단원테스트 등)만 다루려는 기획 의도와 일치.
 */
export async function buildIntegratedReportData(
  studentId: string,
  testIds: number[],
): Promise<IntegratedReportData> {
  if (testIds.length === 0) {
    throw new Error('선택된 시험이 없습니다.');
  }

  const { data: studentRow, error: studentError } = await supabase
    .from('students')
    .select('name, grade, class_id, classes ( name )')
    .eq('id', Number(studentId))
    .single();
  if (studentError) throw studentError;
  const student = studentRow as unknown as {
    name: string;
    grade: string | null;
    class_id: number | null;
    classes: { name: string } | null;
  };

  const { data: testsData, error: testsError } = await supabase
    .from('tests')
    .select('test_id, test_name, date, total_questions, test_type')
    .in('test_id', testIds);
  if (testsError) throw testsError;
  type TestMetaRow = { test_id: number; test_name: string; date: string; total_questions: number; test_type: string };
  const testMetaById = new Map<number, TestMetaRow>();
  for (const row of (testsData as TestMetaRow[]) ?? []) {
    testMetaById.set(row.test_id, row);
  }

  const { data: questionsData, error: qError } = await supabase
    .from('test_questions')
    .select('test_id, question_number, topic, question_type, difficulty, question_method, cognitive_domain')
    .in('test_id', testIds);
  if (qError) throw qError;
  type QRow = {
    test_id: number;
    question_number: string;
    topic: string;
    question_type: string;
    difficulty: string;
    question_method: string;
    cognitive_domain: string | null;
  };
  const questionsByTest = new Map<number, QRow[]>();
  for (const row of (questionsData as QRow[]) ?? []) {
    const list = questionsByTest.get(row.test_id) ?? [];
    list.push(row);
    questionsByTest.set(row.test_id, list);
  }

  const { data: resultsData, error: rError } = await supabase
    .from('student_results')
    .select('test_id, score, wrong_numbers')
    .eq('student_id', Number(studentId))
    .in('test_id', testIds);
  if (rError) throw rError;
  type RRow = { test_id: number; score: number; wrong_numbers: string | null };
  const resultByTest = new Map<number, { score: number; wrongSet: Set<number> }>();
  for (const row of (resultsData as RRow[]) ?? []) {
    let wrongSet = new Set<number>();
    try {
      const parsed = row.wrong_numbers ? JSON.parse(row.wrong_numbers) : [];
      if (Array.isArray(parsed)) {
        wrongSet = new Set(parsed.map((v) => Number(v)));
      }
    } catch {
      wrongSet = new Set();
    }
    resultByTest.set(row.test_id, { score: Number(row.score), wrongSet });
  }

  let classmateIds: number[] = [];
  if (student.class_id != null) {
    const { data: classmates, error: cError } = await supabase
      .from('students')
      .select('id')
      .eq('class_id', student.class_id);
    if (cError) throw cError;
    classmateIds = ((classmates as { id: number }[]) ?? []).map((c) => c.id);
  }
  const peerScoresByTest = new Map<number, number[]>();
  if (classmateIds.length > 0) {
    const { data: peerData, error: pError } = await supabase
      .from('student_results')
      .select('test_id, student_id, score')
      .in('test_id', testIds)
      .in('student_id', classmateIds);
    if (pError) throw pError;
    for (const row of (peerData as { test_id: number; student_id: number; score: number }[]) ?? []) {
      const list = peerScoresByTest.get(row.test_id) ?? [];
      list.push(Number(row.score));
      peerScoresByTest.set(row.test_id, list);
    }
  }

  const tests: PerTestSummary[] = [];
  for (const testId of testIds) {
    const meta = testMetaById.get(testId);
    const result = resultByTest.get(testId);
    if (!meta || !result) continue; // 이 학생이 아직 안 본 시험은 통합 분석에서 제외
    const total = Math.max(meta.total_questions, 1);
    const wrongCount = result.wrongSet.size;
    const correctCount = Math.max(total - wrongCount, 0);
    const peers = peerScoresByTest.get(testId) ?? [];
    tests.push({
      testId,
      testName: meta.test_name,
      date: meta.date,
      testType: meta.test_type,
      score: result.score,
      totalQuestions: total,
      correctCount,
      wrongCount,
      irt: computeIrtStats(result.score, peers),
    });
  }
  tests.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const unitMap = new Map<string, { total: number; correct: number }>();
  const typeMap = new Map<string, { total: number; correct: number }>();
  const formatMap = new Map<string, { total: number; correct: number }>();
  const diffMap = new Map<string, { total: number; correct: number }>();
  const cogMap = new Map<string, { total: number; correct: number }>();
  let combinedTotal = 0;
  let combinedCorrect = 0;
  let hasCognitiveData = false;

  for (const t of tests) {
    const result = resultByTest.get(t.testId);
    if (!result) continue;
    const questions = questionsByTest.get(t.testId) ?? [];
    for (const q of questions) {
      const qNum = Number(q.question_number);
      const isCorrect = !result.wrongSet.has(qNum);
      combinedTotal += 1;
      if (isCorrect) combinedCorrect += 1;

      const topic = (q.topic || '미분류').trim() || '미분류';
      bump(unitMap, topic, isCorrect);

      const method = (q.question_method || '').trim();
      if (method) bump(typeMap, method, isCorrect);

      const format = (q.question_type || '').trim() || '객관식';
      bump(formatMap, format, isCorrect);

      const diffLabel = DIFF_LABELS[q.difficulty] || '중';
      bump(diffMap, diffLabel, isCorrect);

      const cogLabel = (q.cognitive_domain || '미분류').trim() || '미분류';
      if (cogLabel !== '미분류') hasCognitiveData = true;
      bump(cogMap, cogLabel, isCorrect);
    }
  }

  const unitAnalysis = toCategoryStats(unitMap);
  const typeAnalysis = toCategoryStats(typeMap);
  const formatAnalysis = toCategoryStats(formatMap, ['객관식', '서술형']);
  const difficultyAnalysis = toCategoryStats(diffMap, DIFF_ORDER);
  const cognitiveAnalysis = toCategoryStats(cogMap, COG_ORDER);

  const topicCandidates = unitAnalysis.filter((u) => u.total >= 2);
  const weakTopics = [...topicCandidates].sort((a, b) => a.accuracy - b.accuracy).slice(0, 3);
  const strongTopics = [...topicCandidates].sort((a, b) => b.accuracy - a.accuracy).slice(0, 3);

  const averageScore =
    tests.length > 0 ? Math.round((tests.reduce((s, t) => s + t.score, 0) / tests.length) * 10) / 10 : 0;

  return {
    studentId,
    studentName: student.name,
    className: student.classes?.name ?? '반 미배정',
    grade: student.grade ?? '',
    generatedAt: nowStamp(),
    tests,
    combinedTotalQuestions: combinedTotal,
    combinedCorrect,
    combinedWrong: combinedTotal - combinedCorrect,
    combinedAccuracy: combinedTotal > 0 ? Math.round((combinedCorrect / combinedTotal) * 1000) / 10 : 0,
    averageScore,
    unitAnalysis,
    typeAnalysis,
    formatAnalysis,
    difficultyAnalysis,
    cognitiveAnalysis,
    weakTopics,
    strongTopics,
    hasCognitiveData,
  };
}
