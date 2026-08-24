import { supabase } from './supabaseClient';
import type { TuitionRecord, TuitionStatus } from '../types/tuition';

// dev Supabase의 실제 스키마(app.py CREATE TABLE 구문 기준, 2026-08-24 확인):
//   tuition_payments: id(SERIAL), student_id(INTEGER, FK→students),
//     month(TEXT, "YYYY-MM"), status(TEXT, CHECK: paid/pending/overdue),
//     amount(REAL DEFAULT 0), paid_date(TEXT or NULL), notes(TEXT DEFAULT ''),
//     updated_at(TEXT), UNIQUE(student_id, month)
//   classes: id, name, description, teacher_id, schedule (students.ts와 동일 테이블)
//
// 화면 자체가 "반 + 월" 조건으로 학생을 필터링해야 해서, 학생 명부용
// fetchStudents()(className 문자열만 있음)와 별개로 class_id를 포함한
// 가벼운 조회를 이 파일에 따로 둠.

interface ClassRow {
  id: number;
  name: string;
}

export interface TuitionClassOption {
  id: string;
  name: string;
}

/** 반 목록(반 선택 드롭다운용) — app.py의 get_all_classes() 대응. */
export async function fetchClassOptions(): Promise<TuitionClassOption[]> {
  const { data, error } = await supabase.from('classes').select('id, name').order('name', { ascending: true });
  if (error) {
    throw error;
  }
  return ((data as ClassRow[]) ?? []).map((row) => ({ id: String(row.id), name: row.name }));
}

interface StudentForTuitionRow {
  id: number;
  name: string;
  class_id: number | null;
  classes: { name: string } | null;
}

export interface TuitionStudentRow {
  id: string;
  name: string;
  classId: string | null;
  className: string;
}

/** 학생 목록(반 id 포함) — app.py의 get_all_students() 대응(반별 필터에 필요한 class_id까지 포함). */
export async function fetchStudentsForTuition(): Promise<TuitionStudentRow[]> {
  const { data, error } = await supabase
    .from('students')
    .select('id, name, class_id, classes ( name )')
    .order('name', { ascending: true });
  if (error) {
    throw error;
  }
  return ((data as unknown as StudentForTuitionRow[]) ?? []).map((row) => ({
    id: String(row.id),
    name: row.name,
    classId: row.class_id != null ? String(row.class_id) : null,
    className: row.classes?.name ?? '반 미배정',
  }));
}

interface TuitionRow {
  student_id: number;
  month: string;
  status: TuitionStatus;
  amount: number | null;
  paid_date: string | null;
}

/**
 * 특정 월의 수강료 기록을 전부 조회 (app.py의 get_tuition_for_month 대응).
 * 원본은 SQL LEFT JOIN으로 기록 없는 학생도 status='pending'으로 채워 반환하지만,
 * 여기서는 기록이 "있는" 행만 가져오고, 화면(TuitionManagement.tsx)에서 학생
 * 목록과 합칠 때 기록 없는 학생을 pending/0원으로 채움(결과는 동일).
 */
export async function fetchTuitionRecordsForMonth(month: string): Promise<TuitionRecord[]> {
  const { data, error } = await supabase
    .from('tuition_payments')
    .select('student_id, month, status, amount, paid_date')
    .eq('month', month);
  if (error) {
    throw error;
  }
  return ((data as TuitionRow[]) ?? []).map((row) => ({
    studentId: String(row.student_id),
    month: row.month,
    status: row.status,
    amount: Number(row.amount ?? 0),
    paidDate: row.paid_date ?? undefined,
  }));
}

function nowStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 수강료 상태 저장(같은 학생+월 조합은 덮어쓰기) — app.py의 save_tuition_status 대응. */
export async function saveTuitionStatus(params: {
  studentId: string;
  month: string;
  status: TuitionStatus;
  amount: number;
  paidDate?: string;
}): Promise<void> {
  const { error } = await supabase.from('tuition_payments').upsert(
    {
      student_id: Number(params.studentId),
      month: params.month,
      status: params.status,
      amount: params.amount,
      paid_date: params.paidDate ?? null,
      notes: '',
      updated_at: nowStr(),
    },
    { onConflict: 'student_id,month' },
  );
  if (error) {
    throw error;
  }
}
