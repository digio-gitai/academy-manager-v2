import { supabase } from './supabaseClient';
import type { CalendarEvent, EventType, ExamScope, ExamScopeType, Textbook } from '../types/schoolInfo';

// dev Supabase(kpimhidgkrqtegcumrul)의 실제 스키마(database.py의
// ensure_school_info_tables() DDL 기준, 2026-08-24 확인 — 학사정보는 최근
// 추가된 모듈이라 app.py 옛 SQLite DDL이 아니라 database.py의 Postgres DDL을
// 그대로 신뢰함):
//   school_calendar_events: id, school, grade, year, event_type, event_name,
//     start_date, end_date, note, semester, math_exam_date, created_by,
//     created_at, updated_at
//   school_textbooks: id, school, grade, year, textbook_name, publisher,
//     note, created_by, created_at, updated_at
//   school_exam_scopes: id, school, grade, year, semester, exam_type, scope,
//     note, created_by, created_at, updated_at
//     (UNIQUE(school, grade, year, semester, exam_type))
//
// [2026-09-09] semester/math_exam_date 컬럼과 school_exam_scopes 테이블은 이번에
// 새로 추가함(시험범위 메뉴 + "수학 시험 보는 날 체크" 기능) — dev DB에는
// school_calendar_events/school_textbooks 테이블 자체가 아예 없어서(운영에만
// 있었음) 같이 새로 만듦.
//
// created_by(작성 강사 id)는 React 쪽에 아직 로그인 연동이 없어서(로그인
// 화면도 mock) 지금 단계에서는 항상 null로 저장함 — 컬럼이
// "ON DELETE SET NULL"이라 비워도 안전.

function nowStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 학생명부(students.school)에 등록된 학교명 목록 (app.py의 get_school_options 대응). */
export async function fetchSchoolOptions(): Promise<string[]> {
  const { data, error } = await supabase.from('students').select('school');
  if (error) {
    throw error;
  }
  const set = new Set(
    (data ?? [])
      .map((row) => (row as { school: string | null }).school)
      .filter((v): v is string => Boolean(v && v.trim())),
  );
  return Array.from(set).sort();
}

// ── 학사일정 ─────────────────────────────────────────────

interface CalendarEventRow {
  id: number;
  school: string;
  grade: string;
  year: number;
  event_type: string;
  event_name: string | null;
  start_date: string;
  end_date: string | null;
  note: string | null;
  semester: number | null;
  math_exam_date: string | null;
}

function mapCalendarRow(row: CalendarEventRow): CalendarEvent {
  return {
    id: String(row.id),
    school: row.school,
    grade: row.grade,
    year: row.year,
    eventType: row.event_type as EventType,
    eventName: row.event_name ?? '',
    startDate: row.start_date,
    endDate: row.end_date ?? '',
    note: row.note ?? '',
    semester: row.semester,
    mathExamDate: row.math_exam_date,
  };
}

export async function fetchCalendarEvents(school: string, year: number): Promise<CalendarEvent[]> {
  const { data, error } = await supabase
    .from('school_calendar_events')
    .select('id, school, grade, year, event_type, event_name, start_date, end_date, note, semester, math_exam_date')
    .eq('school', school)
    .eq('year', year)
    .order('start_date', { ascending: true });

  if (error) {
    throw error;
  }
  return ((data as CalendarEventRow[]) ?? []).map(mapCalendarRow);
}

/** 새 학사일정 등록(학년 1개당 행 1개 — 여러 학년 선택 시 화면에서 여러 번 호출). */
export async function insertCalendarEvent(params: {
  school: string;
  grade: string;
  year: number;
  eventType: EventType;
  eventName: string;
  startDate: string;
  endDate: string;
  note: string;
  semester: number | null;
}): Promise<void> {
  const ts = nowStr();
  const { error } = await supabase.from('school_calendar_events').insert({
    school: params.school,
    grade: params.grade,
    year: params.year,
    event_type: params.eventType,
    event_name: params.eventName.trim(),
    start_date: params.startDate,
    end_date: params.endDate,
    note: params.note.trim(),
    semester: params.semester,
    created_by: null,
    created_at: ts,
    updated_at: ts,
  });
  if (error) {
    throw error;
  }
}

export async function updateCalendarEvent(
  id: string,
  params: { eventType: EventType; eventName: string; startDate: string; endDate: string; note: string; semester: number | null },
): Promise<void> {
  const { error } = await supabase
    .from('school_calendar_events')
    .update({
      event_type: params.eventType,
      event_name: params.eventName.trim(),
      start_date: params.startDate,
      end_date: params.endDate,
      note: params.note.trim(),
      semester: params.semester,
      updated_at: nowStr(),
    })
    .eq('id', Number(id));
  if (error) {
    throw error;
  }
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  const { error } = await supabase.from('school_calendar_events').delete().eq('id', Number(id));
  if (error) {
    throw error;
  }
}

/** "수학 시험 보는 날" 기록/수정 — 시험기간(start~end)은 먼저 나오고 과목별
 * 세부시간표는 나중에 나오는 경우가 많아, 알게 된 시점에 따로 기록할 수 있게 함. */
export async function updateMathExamDate(id: string, mathExamDate: string): Promise<void> {
  const { error } = await supabase
    .from('school_calendar_events')
    .update({ math_exam_date: mathExamDate, updated_at: nowStr() })
    .eq('id', Number(id));
  if (error) {
    throw error;
  }
}

// ── 시험범위 ─────────────────────────────────────────────

interface ExamScopeRow {
  id: number;
  school: string;
  grade: string;
  year: number;
  semester: number;
  exam_type: string;
  scope: string | null;
  note: string | null;
}

function mapExamScopeRow(row: ExamScopeRow): ExamScope {
  return {
    id: String(row.id),
    school: row.school,
    grade: row.grade,
    year: row.year,
    semester: row.semester,
    examType: row.exam_type as ExamScopeType,
    scope: row.scope ?? '',
    note: row.note ?? '',
  };
}

/** school+year 전체(모든 학년)의 시험범위 — 학사일정 표에 범위를 같이 보여줄 때 씀. */
export async function fetchExamScopesForYear(school: string, year: number): Promise<ExamScope[]> {
  const { data, error } = await supabase
    .from('school_exam_scopes')
    .select('id, school, grade, year, semester, exam_type, scope, note')
    .eq('school', school)
    .eq('year', year);
  if (error) {
    throw error;
  }
  return ((data as ExamScopeRow[]) ?? []).map(mapExamScopeRow);
}

/** 시험범위 탭에서 특정 학년의 범위 4건(1/2학기 × 중간/기말)을 가져올 때 씀. */
export async function fetchExamScopes(school: string, grade: string, year: number): Promise<ExamScope[]> {
  const { data, error } = await supabase
    .from('school_exam_scopes')
    .select('id, school, grade, year, semester, exam_type, scope, note')
    .eq('school', school)
    .eq('grade', grade)
    .eq('year', year);
  if (error) {
    throw error;
  }
  return ((data as ExamScopeRow[]) ?? []).map(mapExamScopeRow);
}

/** 시험범위 저장 — (school, grade, year, semester, exam_type) 조합마다 항상 1건만
 * 존재하므로 upsert로 있으면 덮어쓰고 없으면 새로 만든다. */
export async function saveExamScope(params: {
  school: string;
  grade: string;
  year: number;
  semester: number;
  examType: ExamScopeType;
  scope: string;
  note: string;
}): Promise<void> {
  const ts = nowStr();
  const { error } = await supabase.from('school_exam_scopes').upsert(
    {
      school: params.school,
      grade: params.grade,
      year: params.year,
      semester: params.semester,
      exam_type: params.examType,
      scope: params.scope.trim(),
      note: params.note.trim(),
      created_by: null,
      created_at: ts,
      updated_at: ts,
    },
    { onConflict: 'school,grade,year,semester,exam_type' },
  );
  if (error) {
    throw error;
  }
}

// ── 교과서 목록 ───────────────────────────────────────────

interface TextbookRow {
  id: number;
  school: string;
  grade: string;
  year: number;
  textbook_name: string;
  publisher: string | null;
  note: string | null;
}

function mapTextbookRow(row: TextbookRow): Textbook {
  return {
    id: String(row.id),
    school: row.school,
    grade: row.grade,
    year: row.year,
    textbookName: row.textbook_name,
    publisher: row.publisher ?? '',
    note: row.note ?? '',
  };
}

export async function fetchTextbooks(school: string, year: number): Promise<Textbook[]> {
  const { data, error } = await supabase
    .from('school_textbooks')
    .select('id, school, grade, year, textbook_name, publisher, note')
    .eq('school', school)
    .eq('year', year)
    .order('textbook_name', { ascending: true });

  if (error) {
    throw error;
  }
  return ((data as TextbookRow[]) ?? []).map(mapTextbookRow);
}

export async function insertTextbook(params: {
  school: string;
  grade: string;
  year: number;
  textbookName: string;
  publisher: string;
  note: string;
}): Promise<void> {
  const ts = nowStr();
  const { error } = await supabase.from('school_textbooks').insert({
    school: params.school,
    grade: params.grade,
    year: params.year,
    textbook_name: params.textbookName.trim(),
    publisher: params.publisher.trim(),
    note: params.note.trim(),
    created_by: null,
    created_at: ts,
    updated_at: ts,
  });
  if (error) {
    throw error;
  }
}

export async function updateTextbook(
  id: string,
  params: { textbookName: string; publisher: string; note: string },
): Promise<void> {
  const { error } = await supabase
    .from('school_textbooks')
    .update({
      textbook_name: params.textbookName.trim(),
      publisher: params.publisher.trim(),
      note: params.note.trim(),
      updated_at: nowStr(),
    })
    .eq('id', Number(id));
  if (error) {
    throw error;
  }
}

export async function deleteTextbook(id: string): Promise<void> {
  const { error } = await supabase.from('school_textbooks').delete().eq('id', Number(id));
  if (error) {
    throw error;
  }
}
