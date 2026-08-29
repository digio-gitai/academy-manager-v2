import { supabase } from './supabaseClient';
import type { ExamGroup, UnifiedGradeRecord } from '../types/grades';
import { MATH_SUBJECT, type SchoolGradeRecord } from '../types/schoolGrades';
import type { MockExamGradeRecord } from '../types/mockExamGrades';

// dev Supabase 실제 스키마(2026-08-26, database.py/app.py 소스 확인):
//   external_grade_sessions: id(SERIAL), exam_source('school_exam'|'mock_exam'),
//     school_year(INT), grade_level(TEXT), semester(TEXT), exam_kind(TEXT),
//     exam_month(INT, nullable — 학교시험은 항상 NULL, 모의고사만 사용),
//     created_at, updated_at
//   external_grade_records: id(SERIAL), session_id(FK→sessions),
//     student_id(FK→students), subject_name(TEXT), score(REAL),
//     created_at, updated_at, UNIQUE(session_id, student_id, subject_name)
//
// ⚠️ 2026-08-26 발견 + 수정한 버그: external_grade_sessions의 원래 UNIQUE 제약이
// (exam_source, school_year, grade_level, semester, exam_kind)뿐이라 exam_month가
// 빠져 있었음. 모의고사는 semester/exam_kind를 항상 빈 문자열로 쓰고 exam_month로만
// 구분하는데, 이 제약에 exam_month가 없어서 같은 연도+학년으로 다른 달 모의고사를
// 저장하면 두 번째 저장부터 DB 에러가 나는 버그였음(운영 DB도 dev와 스키마를 그대로
// 복제해서 만들었으므로 아직 반영 전이라면 동일 버그 있음 — academy-web_현황.md 참고).
// dev DB에는 COALESCE 표현식 유니크 인덱스로 교체하는 SQL을 사용자가 적용함.
// 이 파일의 getOrCreateSession()은 (조회 → 없으면 INSERT) 방식이라 이 스키마 수정에
// 의존하지 않고도 정상 동작하지만, 수정 전에는 동시에 두 사람이 같은 조합을 처음
// 저장할 때 레이스 컨디션으로 실패할 수 있었음(수정 후에는 DB가 안전망 역할).
//
// '학원시험'(academy) 그룹: 2026-08-29부터 tests/student_results(AI 테스트 결과,
// '학원시험 AI분석' 탭 3단계에서 저장됨)를 반영. 원본 스트림릿은 여기에 수기 입력
// (exams/student_scores)도 합치지만, 그 경로는 React에 아직 없는 별도 레거시
// 기능이라 이번엔 포함하지 않음(필요해지면 나중에 추가).

const EXAM_SOURCE_SCHOOL = 'school_exam';
const EXAM_SOURCE_MOCK = 'mock_exam';

interface SessionRow {
  id: number;
  exam_source: string;
  school_year: number;
  grade_level: string;
  semester: string;
  exam_kind: string;
  exam_month: number | null;
}

interface RecordRow {
  id: number;
  student_id: number;
  score: number;
  updated_at: string;
  external_grade_sessions: SessionRow;
}

interface AcademyTestRow {
  id: number;
  score: number;
  recorded_at: string;
  tests: { test_name: string; date: string } | null;
}

function nowStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function schoolLabel(s: SessionRow): string {
  return `${s.school_year} ${s.grade_level} ${s.semester} ${s.exam_kind} · ${MATH_SUBJECT}`;
}
function schoolDate(s: SessionRow): string {
  return `${s.school_year}-06-01`;
}
function mockLabel(s: SessionRow): string {
  return s.exam_month
    ? `${s.school_year} ${s.grade_level} ${s.exam_month}월 모의고사 · ${MATH_SUBJECT}`
    : `${s.school_year} ${s.grade_level} 모의고사 · ${MATH_SUBJECT}`;
}
function mockDate(s: SessionRow): string {
  return s.exam_month
    ? `${s.school_year}-${String(s.exam_month).padStart(2, '0')}-01`
    : `${s.school_year}-01-01`;
}

/**
 * dev DB student_results + tests 조인 — 학생의 '학원시험'(AI 테스트) 결과 조회.
 * 스트림릿의 라벨 규칙과 동일하게 `{시험명} · AI 테스트` 형식으로 표시.
 */
async function fetchAcademyTestRecords(studentId: string): Promise<UnifiedGradeRecord[]> {
  const { data, error } = await supabase
    .from('student_results')
    .select('id, score, recorded_at, tests ( test_name, date )')
    .eq('student_id', Number(studentId));

  if (error) {
    throw error;
  }

  const rows = (data as unknown as AcademyTestRow[]) ?? [];
  return rows.map((r) => {
    const testName = r.tests?.test_name || '학원시험';
    const examDate = (r.tests?.date || r.recorded_at || '').slice(0, 10);
    return {
      id: `ai-${r.id}`,
      studentId,
      examGroup: 'academy' as ExamGroup,
      examLabel: `${testName} · AI 테스트`,
      score: Number(r.score),
      examDate,
      updatedAt: r.recorded_at,
    };
  });
}

/**
 * 학생 한 명의 통합 성적(성적 조회 / 통합보고서 작성 탭용).
 * 스트림릿 get_student_unified_grades()를 재현: 학교시험/모의고사
 * (external_grade_records+sessions) + 학원시험 AI 테스트(student_results+tests)를
 * 합쳐서 exam_date 내림차순(동률이면 updated_at 내림차순)으로 정렬해 반환.
 */
export async function fetchUnifiedGrades(studentId: string): Promise<UnifiedGradeRecord[]> {
  const [{ data, error }, academyRecords] = await Promise.all([
    supabase
      .from('external_grade_records')
      .select(
        'id, student_id, score, updated_at, external_grade_sessions ( id, exam_source, school_year, grade_level, semester, exam_kind, exam_month )',
      )
      .eq('student_id', Number(studentId))
      .eq('subject_name', MATH_SUBJECT),
    fetchAcademyTestRecords(studentId),
  ]);

  if (error) {
    throw error;
  }

  const rows = (data as unknown as RecordRow[]) ?? [];
  const externalRecords: UnifiedGradeRecord[] = rows
    .filter((r) => r.external_grade_sessions)
    .map((r) => {
      const s = r.external_grade_sessions;
      const group: ExamGroup = s.exam_source === EXAM_SOURCE_SCHOOL ? 'school' : 'mock';
      return {
        id: `ext-${r.id}`,
        studentId,
        examGroup: group,
        examLabel: group === 'school' ? schoolLabel(s) : mockLabel(s),
        score: Number(r.score),
        examDate: group === 'school' ? schoolDate(s) : mockDate(s),
        updatedAt: r.updated_at,
      };
    });

  return [...externalRecords, ...academyRecords].sort((a, b) => {
    if (a.examDate !== b.examDate) return a.examDate < b.examDate ? 1 : -1;
    return a.updatedAt < b.updatedAt ? 1 : -1;
  });
}

async function getOrCreateSession(params: {
  examSource: string;
  schoolYear: number;
  gradeLevel: string;
  semester: string;
  examKind: string;
  examMonth: number | null;
}): Promise<number> {
  let query = supabase
    .from('external_grade_sessions')
    .select('id')
    .eq('exam_source', params.examSource)
    .eq('school_year', params.schoolYear)
    .eq('grade_level', params.gradeLevel)
    .eq('semester', params.semester)
    .eq('exam_kind', params.examKind);
  query = params.examMonth === null ? query.is('exam_month', null) : query.eq('exam_month', params.examMonth);

  const { data: existing, error: findError } = await query.maybeSingle();
  if (findError) {
    throw findError;
  }
  if (existing) {
    await supabase.from('external_grade_sessions').update({ updated_at: nowStr() }).eq('id', existing.id);
    return existing.id;
  }

  const now = nowStr();
  const { data: created, error: insertError } = await supabase
    .from('external_grade_sessions')
    .insert({
      exam_source: params.examSource,
      school_year: params.schoolYear,
      grade_level: params.gradeLevel,
      semester: params.semester,
      exam_kind: params.examKind,
      exam_month: params.examMonth,
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();
  if (insertError) {
    throw insertError;
  }
  return created.id;
}

async function upsertGradeRecord(sessionId: number, studentId: string, score: number): Promise<void> {
  const now = nowStr();
  const { error } = await supabase.from('external_grade_records').upsert(
    {
      session_id: sessionId,
      student_id: Number(studentId),
      subject_name: MATH_SUBJECT,
      score,
      created_at: now,
      updated_at: now,
    },
    { onConflict: 'session_id,student_id,subject_name' },
  );
  if (error) {
    throw error;
  }
}

/** 학교시험 수학 성적 저장 — app.py save_school_math_grade() 대응. 같은 조합이면 덮어쓰기. */
export async function saveSchoolGrade(params: {
  studentId: string;
  schoolYear: number;
  gradeLevel: string;
  semester: string;
  examKind: string;
  score: number;
}): Promise<void> {
  const sessionId = await getOrCreateSession({
    examSource: EXAM_SOURCE_SCHOOL,
    schoolYear: params.schoolYear,
    gradeLevel: params.gradeLevel,
    semester: params.semester,
    examKind: params.examKind,
    examMonth: null,
  });
  await upsertGradeRecord(sessionId, params.studentId, params.score);
}

/** 모의고사 수학 성적 저장 — app.py save_mock_math_grade() 대응. 같은 조합이면 덮어쓰기. */
export async function saveMockGrade(params: {
  studentId: string;
  schoolYear: number;
  gradeLevel: string;
  examMonth: number;
  score: number;
}): Promise<void> {
  const sessionId = await getOrCreateSession({
    examSource: EXAM_SOURCE_MOCK,
    schoolYear: params.schoolYear,
    gradeLevel: params.gradeLevel,
    semester: '',
    examKind: '',
    examMonth: params.examMonth,
  });
  await upsertGradeRecord(sessionId, params.studentId, params.score);
}

async function fetchHistory(studentId: string, examSource: string): Promise<RecordRow[]> {
  const { data, error } = await supabase
    .from('external_grade_records')
    .select(
      'id, student_id, score, updated_at, external_grade_sessions!inner ( id, exam_source, school_year, grade_level, semester, exam_kind, exam_month )',
    )
    .eq('student_id', Number(studentId))
    .eq('subject_name', MATH_SUBJECT)
    .eq('external_grade_sessions.exam_source', examSource);
  if (error) {
    throw error;
  }
  return (data as unknown as RecordRow[]) ?? [];
}

/** 학생의 학교시험 전체 이력 — SchoolGradeTab 하단 표용. */
export async function fetchSchoolGradeHistory(studentId: string): Promise<SchoolGradeRecord[]> {
  const rows = await fetchHistory(studentId, EXAM_SOURCE_SCHOOL);
  return rows.map((r) => ({
    studentId,
    schoolYear: r.external_grade_sessions.school_year,
    gradeLevel: r.external_grade_sessions.grade_level,
    semester: r.external_grade_sessions.semester,
    examKind: r.external_grade_sessions.exam_kind,
    score: Number(r.score),
    updatedAt: r.updated_at,
  }));
}

/** 학생의 모의고사 전체 이력 — MockGradeTab 하단 표용. */
export async function fetchMockGradeHistory(studentId: string): Promise<MockExamGradeRecord[]> {
  const rows = await fetchHistory(studentId, EXAM_SOURCE_MOCK);
  return rows.map((r) => ({
    studentId,
    schoolYear: r.external_grade_sessions.school_year,
    gradeLevel: r.external_grade_sessions.grade_level,
    examMonth: r.external_grade_sessions.exam_month ?? 0,
    score: Number(r.score),
    updatedAt: r.updated_at,
  }));
}
