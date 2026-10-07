import { supabase } from './supabaseClient';
import type { AttendanceStatus } from '../types/attendance';

// 데일리 Diary — 수업 후 학부모에게 "문자(요약+링크) → 링크 페이지(Diary 전체)"로 보내는 기능.
// 테이블 3개(supabase/sql/2026-10-07_daily_diary.sql): diary_settings, daily_diaries, daily_diary_entries.
//
// 학생별 progress/homework/message가 null이면 "공통값을 따른다"는 뜻 — 공통 칸을 고치면
// 개별 수정하지 않은 학생에게는 자동 반영되고, 개별 수정한 학생은 그대로 유지된다.

/** 학부모가 여는 Diary 페이지 주소 베이스 — reportLinks.ts의 PARENT_REPORT_BASE_URL과 같은 도메인. */
export const DIARY_BASE_URL = 'https://academy-manager-v2.vercel.app/diary';

const DEFAULT_ACADEMY_NAME = '사과나무 학원';

export interface DiaryCommon {
  /** 개별진도반: 학생마다 교재·진도·과제가 달라서 공통 칸 대신 학생별로 직접 쓴다. */
  individualMode: boolean;
  academyName: string;
  teacherName: string;
  course: string;
  textbook: string;
  progress: string;
  homework: string;
  message: string;
}

export interface DiaryEntry {
  studentId: string;
  studentName: string;
  schoolGrade: string;
  token: string;
  included: boolean;
  attendance: AttendanceStatus;
  hwPerformance: string;
  /** null = 공통값 사용 */
  course: string | null;
  textbook: string | null;
  progress: string | null;
  homework: string | null;
  message: string | null;
  sentAt: string | null;
}

export interface DiaryDoc {
  classId: string;
  date: string;
  common: DiaryCommon;
  entries: DiaryEntry[];
}

function nowStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Supabase 에러는 Error 인스턴스가 아니라서 message를 직접 꺼낸다. */
export function diaryErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  const m = (err as { message?: string } | null)?.message;
  return m || fallback;
}

export function genDiaryToken(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ───────────── 설정(학원명) ─────────────

/** 저장된 학원명. 아직 없으면 기본값. */
export async function fetchAcademyName(): Promise<string> {
  const { data, error } = await supabase.from('diary_settings').select('value').eq('key', 'academy_name').maybeSingle();
  if (error) throw error;
  const v = ((data as { value: string } | null)?.value ?? '').trim();
  return v || DEFAULT_ACADEMY_NAME;
}

export async function saveAcademyName(name: string): Promise<void> {
  const { error } = await supabase
    .from('diary_settings')
    .upsert({ key: 'academy_name', value: name.trim() }, { onConflict: 'key' });
  if (error) throw error;
}

// ───────────── 선생님 화면: 불러오기 / 저장 ─────────────

interface DiaryRow {
  id: number;
  individual_mode: boolean;
  academy_name: string;
  teacher_name: string;
  course: string;
  textbook: string;
  common_progress: string;
  common_homework: string;
  common_message: string;
}

interface EntryRow {
  student_id: number;
  token: string;
  included: boolean;
  student_name: string;
  school_grade: string;
  attendance_status: string;
  hw_performance: string;
  course: string | null;
  textbook: string | null;
  progress: string | null;
  homework: string | null;
  message: string | null;
  sent_at: string | null;
}

function toAttendance(v: string): AttendanceStatus {
  return v === 'late' || v === 'absent' || v === 'cancelled' ? v : 'present';
}

/** 이 반+날짜에 저장된 Diary(임시저장 포함). 없으면 null. */
export async function fetchDiary(classId: string, date: string): Promise<DiaryDoc | null> {
  const { data, error } = await supabase
    .from('daily_diaries')
    .select('id, individual_mode, academy_name, teacher_name, course, textbook, common_progress, common_homework, common_message')
    .eq('class_id', Number(classId))
    .eq('diary_date', date)
    .maybeSingle();
  if (error) throw error;
  const row = data as DiaryRow | null;
  if (!row) return null;

  const { data: entryRows, error: eErr } = await supabase
    .from('daily_diary_entries')
    .select(
      'student_id, token, included, student_name, school_grade, attendance_status, hw_performance, course, textbook, progress, homework, message, sent_at',
    )
    .eq('diary_id', row.id);
  if (eErr) throw eErr;

  return {
    classId,
    date,
    common: {
      individualMode: row.individual_mode,
      academyName: row.academy_name,
      teacherName: row.teacher_name,
      course: row.course,
      textbook: row.textbook,
      progress: row.common_progress,
      homework: row.common_homework,
      message: row.common_message,
    },
    entries: ((entryRows as EntryRow[]) ?? []).map((e) => ({
      studentId: String(e.student_id),
      studentName: e.student_name,
      schoolGrade: e.school_grade,
      token: e.token,
      included: e.included,
      attendance: toAttendance(e.attendance_status),
      hwPerformance: e.hw_performance,
      course: e.course,
      textbook: e.textbook,
      progress: e.progress,
      homework: e.homework,
      message: e.message,
      sentAt: e.sent_at,
    })),
  };
}

/** 자동저장 — 같은 반+날짜는 덮어쓰기(upsert). 이미 발송 기록(sent_at)은 유지됨. */
export async function saveDiary(doc: DiaryDoc): Promise<void> {
  const { data, error } = await supabase
    .from('daily_diaries')
    .upsert(
      {
        class_id: Number(doc.classId),
        diary_date: doc.date,
        individual_mode: doc.common.individualMode,
        academy_name: doc.common.academyName,
        teacher_name: doc.common.teacherName,
        course: doc.common.course,
        textbook: doc.common.textbook,
        common_progress: doc.common.progress,
        common_homework: doc.common.homework,
        common_message: doc.common.message,
        updated_at: nowStr(),
      },
      { onConflict: 'class_id,diary_date' },
    )
    .select('id')
    .single();
  if (error) throw error;
  const diaryId = (data as { id: number }).id;

  if (doc.entries.length === 0) return;
  const rows = doc.entries.map((e) => ({
    diary_id: diaryId,
    student_id: Number(e.studentId),
    token: e.token,
    included: e.included,
    student_name: e.studentName,
    school_grade: e.schoolGrade,
    attendance_status: e.attendance,
    hw_performance: e.hwPerformance,
    course: e.course,
    textbook: e.textbook,
    progress: e.progress,
    homework: e.homework,
    message: e.message,
  }));
  // sent_at / viewed_at은 일부러 넣지 않음 → upsert해도 기존 값이 지워지지 않는다.
  const { error: eErr } = await supabase.from('daily_diary_entries').upsert(rows, { onConflict: 'diary_id,student_id' });
  if (eErr) throw eErr;
}

/** 문자 발송 성공 직후 발송 시각 기록. */
export async function markDiarySent(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  const { error } = await supabase.from('daily_diary_entries').update({ sent_at: nowStr() }).in('token', tokens);
  if (error) throw error;
}

/** 이 반의 가장 최근 Diary 과정/교재/개별진도 여부 — 새 Diary를 열 때 미리 채워 둔다. */
export async function fetchLastCourse(
  classId: string,
  beforeDate: string,
): Promise<{ course: string; textbook: string; individualMode: boolean }> {
  const { data, error } = await supabase
    .from('daily_diaries')
    .select('course, textbook, individual_mode')
    .eq('class_id', Number(classId))
    .lt('diary_date', beforeDate)
    .order('diary_date', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = (data as { course: string; textbook: string; individual_mode: boolean }[] | null)?.[0];
  return { course: row?.course ?? '', textbook: row?.textbook ?? '', individualMode: row?.individual_mode ?? false };
}

/** 개별진도반용 — 학생별로 가장 최근에 쓴 교재/과정. {studentId: {course, textbook}} */
export async function fetchLastStudentCourses(
  classId: string,
  beforeDate: string,
): Promise<Record<string, { course: string; textbook: string }>> {
  const { data, error } = await supabase
    .from('daily_diary_entries')
    .select('student_id, course, textbook, daily_diaries!inner ( class_id, diary_date )')
    .eq('daily_diaries.class_id', Number(classId))
    .lt('daily_diaries.diary_date', beforeDate);
  if (error) throw error;
  const rows = ((data as unknown as {
    student_id: number;
    course: string | null;
    textbook: string | null;
    daily_diaries: { diary_date: string };
  }[]) ?? [])
    .filter((r) => (r.course ?? '') || (r.textbook ?? ''))
    .sort((a, b) => b.daily_diaries.diary_date.localeCompare(a.daily_diaries.diary_date));
  const out: Record<string, { course: string; textbook: string }> = {};
  for (const r of rows) {
    const k = String(r.student_id);
    if (!out[k]) out[k] = { course: r.course ?? '', textbook: r.textbook ?? '' };
  }
  return out;
}

// ───────────── 문자 문구 ─────────────

function mdLabel(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/** 학생이 실제로 보게 될 값(개별 수정 > 공통). */
export function resolveField(entryValue: string | null, commonValue: string): string {
  return entryValue ?? commonValue;
}

/** 문자: 인사 + 오늘 진도 한 줄 + 링크. 상세 내용은 링크 페이지에서 본다. */
export function buildDiarySmsText(params: {
  academyName: string;
  studentName: string;
  date: string;
  progress: string;
  attendance: AttendanceStatus;
  token: string;
}): string {
  const { academyName, studentName, date, progress, attendance, token } = params;
  const lines = [`[${academyName}] ${studentName} 학생 ${mdLabel(date)} 수업 Diary 도착`];
  if (attendance === 'absent') lines.push('오늘 결석 · 수업 내용을 안내드립니다.');
  const firstLine = progress.trim().split('\n')[0];
  if (firstLine) lines.push(`오늘 진도: ${firstLine.length > 30 ? `${firstLine.slice(0, 30)}…` : firstLine}`);
  lines.push(`${DIARY_BASE_URL}?token=${token}`);
  return lines.join('\n');
}

// ───────────── 전하는 말씀 AI 초안 ─────────────

/**
 * 공통 "공지사항 및 전하는 말씀" AI 초안. API 키는 서버(Edge Function generate-daily-comment)에만 있음.
 * 배포 방법은 supabase/functions/generate-daily-comment/index.ts 상단 주석 참고.
 */
export async function generateDailyComment(params: {
  className: string;
  progress: string;
  homework: string;
  tags: string[];
  /** 학생 개별 초안일 때만 */
  studentName?: string;
  attendance?: AttendanceStatus;
  hwPerformance?: string;
}): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ comment?: string; error?: string }>(
    'generate-daily-comment',
    { body: params },
  );
  if (error) throw error;
  if (!data || data.error || !data.comment) throw new Error(data?.error || 'AI 초안 생성에 실패했습니다.');
  return data.comment;
}

// ───────────── 학부모 페이지(로그인 없음, ?token=) ─────────────

export interface PublicDiaryReport {
  token: string;
  label: string;
}

export interface PublicDiaryPast {
  token: string;
  date: string;
  progress: string;
}

export interface PublicDiary {
  academyName: string;
  teacherName: string;
  date: string;
  studentName: string;
  schoolGrade: string;
  className: string;
  course: string;
  textbook: string;
  attendance: AttendanceStatus;
  hwPerformance: string;
  progress: string;
  homework: string;
  message: string;
  reports: PublicDiaryReport[];
  past: PublicDiaryPast[];
}

interface PublicEntryRow extends EntryRow {
  id: number;
  daily_diaries: (DiaryRow & { diary_date: string; classes: { name: string } | null }) | null;
}

function reportLabel(testType: string, testName: string): string {
  const base = (testName || testType || '').trim();
  if (!base) return '성적 보고서';
  return /보고서|리포트/.test(base) ? base : `${base} 보고서`;
}

export async function fetchPublicDiary(token: string): Promise<PublicDiary | null> {
  const { data, error } = await supabase
    .from('daily_diary_entries')
    .select(
      'id, student_id, token, included, student_name, school_grade, attendance_status, hw_performance, course, textbook, progress, homework, message, sent_at, daily_diaries ( id, diary_date, academy_name, teacher_name, course, textbook, common_progress, common_homework, common_message, classes ( name ) )',
    )
    .eq('token', token)
    .maybeSingle();
  if (error) throw error;
  const row = data as unknown as PublicEntryRow | null;
  const dd = row?.daily_diaries;
  if (!row || !dd) return null;

  // 오늘 이 학생의 테스트 보고서(report_links) — 보고서를 Diary 발송보다 나중에 만들어도 열 때 자동으로 붙는다.
  const [reportsRes, pastRes] = await Promise.all([
    supabase
      .from('report_links')
      .select('token, test_type, test_name')
      .eq('student_id', row.student_id)
      .eq('test_date', dd.diary_date)
      .order('created_at', { ascending: true }),
    supabase
      .from('daily_diary_entries')
      .select('token, progress, daily_diaries ( diary_date, common_progress )')
      .eq('student_id', row.student_id)
      .not('sent_at', 'is', null)
      .neq('token', token),
  ]);

  const reports = ((reportsRes.data as { token: string; test_type: string | null; test_name: string | null }[]) ?? []).map(
    (r) => ({ token: r.token, label: reportLabel(r.test_type ?? '', r.test_name ?? '') }),
  );

  const past = (
    (pastRes.data as unknown as {
      token: string;
      progress: string | null;
      daily_diaries: { diary_date: string; common_progress: string } | null;
    }[]) ?? []
  )
    .filter((p) => p.daily_diaries && p.daily_diaries.diary_date < dd.diary_date)
    .map((p) => ({
      token: p.token,
      date: p.daily_diaries!.diary_date,
      progress: p.progress ?? p.daily_diaries!.common_progress,
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);

  return {
    academyName: dd.academy_name || DEFAULT_ACADEMY_NAME,
    teacherName: dd.teacher_name,
    date: dd.diary_date,
    studentName: row.student_name,
    schoolGrade: row.school_grade,
    className: dd.classes?.name ?? '',
    course: resolveField(row.course, dd.course),
    textbook: resolveField(row.textbook, dd.textbook),
    attendance: toAttendance(row.attendance_status),
    hwPerformance: row.hw_performance,
    progress: resolveField(row.progress, dd.common_progress),
    homework: resolveField(row.homework, dd.common_homework),
    message: resolveField(row.message, dd.common_message),
    reports,
    past,
  };
}

/** 최초 열람 시각만 기록(이미 있으면 그대로). */
export async function markDiaryViewed(token: string): Promise<void> {
  await supabase.from('daily_diary_entries').update({ viewed_at: nowStr() }).eq('token', token).is('viewed_at', null);
}
