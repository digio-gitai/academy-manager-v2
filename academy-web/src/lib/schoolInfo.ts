import { supabase } from './supabaseClient';
import type { CalendarEvent, EventType, Textbook } from '../types/schoolInfo';

// dev Supabase(kpimhidgkrqtegcumrul)의 실제 스키마(database.py의
// ensure_school_info_tables() DDL 기준, 2026-08-24 확인 — 학사정보는 최근
// 추가된 모듈이라 app.py 옛 SQLite DDL이 아니라 database.py의 Postgres DDL을
// 그대로 신뢰함):
//   school_calendar_events: id, school, grade, year, event_type, event_name,
//     start_date, end_date, note, created_by, created_at, updated_at
//   school_textbooks: id, school, grade, year, textbook_name, publisher,
//     note, created_by, created_at, updated_at
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
  };
}

export async function fetchCalendarEvents(school: string, year: number): Promise<CalendarEvent[]> {
  const { data, error } = await supabase
    .from('school_calendar_events')
    .select('id, school, grade, year, event_type, event_name, start_date, end_date, note')
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
  params: { eventType: EventType; eventName: string; startDate: string; endDate: string; note: string },
): Promise<void> {
  const { error } = await supabase
    .from('school_calendar_events')
    .update({
      event_type: params.eventType,
      event_name: params.eventName.trim(),
      start_date: params.startDate,
      end_date: params.endDate,
      note: params.note.trim(),
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
