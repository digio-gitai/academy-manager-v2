import { supabase } from './supabaseClient';
import type { StudentProfile } from '../types/student';

export interface ClassOption {
  id: string;
  name: string;
}

/**
 * 반 목록(id 포함) — 학생 반 재배정 드롭다운용. 2026-08-24: 기존에는 이 화면이
 * "지금 명부에 있는 학생들의 반 이름"만 모아서 드롭다운을 만들었는데, 그러면
 * 학생이 0명인 새 반(예: 새로 만든 "프리미엄반")이 안 뜨는 버그가 있었음
 * (사용자가 실사용 중 발견). classes 테이블을 직접 조회해서 항상 전체 반
 * 목록이 뜨도록 수정.
 */
export async function fetchClassOptions(): Promise<ClassOption[]> {
  const { data, error } = await supabase.from('classes').select('id, name').order('name', { ascending: true });
  if (error) {
    throw error;
  }
  return ((data as { id: number; name: string }[]) ?? []).map((row) => ({ id: String(row.id), name: row.name }));
}

/** 학생의 반 배정 변경(class_id 갱신). 2026-08-24: 화면에서만 바뀌던 걸 실제 DB 저장으로 연결. */
export async function reassignStudentClass(studentId: string, classId: string): Promise<void> {
  const { error } = await supabase
    .from('students')
    .update({ class_id: Number(classId) })
    .eq('id', Number(studentId));
  if (error) {
    throw error;
  }
}

// dev Supabase의 실제 컬럼(2026-08-22, SQL Editor로 확인한 값):
//   students: id, name, parent_phone, class_id, registered_at, school, grade,
//             pre_visit_progress, contact_info, expectations, notes,
//             student_phone, test_results
//   classes : id, name, description, teacher_id, schedule
//
// 지금 단계(파일럿)에서는 "조회"만 실제 DB에 연결함. 과제 이력/성적/상담 기록은
// 각각 다른 테이블(consultation_logs, student_scores, hw_ 관련 테이블 등)과
// 조인해야 해서 다음 단계에서 화면별로 하나씩 연결할 예정 — 지금은 빈 값으로 둠.
interface StudentRow {
  id: number;
  name: string;
  parent_phone: string | null;
  class_id: number | null;
  registered_at: string | null;
  school: string | null;
  grade: string | null;
  pre_visit_progress: string | null;
  contact_info: string | null;
  expectations: string | null;
  notes: string | null;
  student_phone: string | null;
  test_results: string | null;
  classes: { name: string } | null;
}

export async function fetchStudents(): Promise<StudentProfile[]> {
  const { data, error } = await supabase
    .from('students')
    .select(
      'id, name, parent_phone, class_id, registered_at, school, grade, pre_visit_progress, contact_info, expectations, notes, student_phone, test_results, classes ( name )',
    )
    .order('id', { ascending: true });

  if (error) {
    throw error;
  }

  return ((data as unknown as StudentRow[]) ?? []).map((row) => ({
    id: String(row.id),
    name: row.name,
    initial: row.name?.charAt(0) ?? '',
    school: row.school ?? '',
    grade: row.grade ?? '',
    className: row.classes?.name ?? '반 미배정',
    teacherName: '—', // teachers 테이블 연동은 다음 단계에서 진행
    registeredAt: row.registered_at ?? '',
    studentPhone: row.student_phone ?? '',
    parentPhone: row.parent_phone ?? '',
    preVisitProgress: row.pre_visit_progress ?? '',
    expectations: row.expectations ?? '',
    notes: row.notes ?? '',
    homeworkCompletionRate: 0,
    recentHomeworkLevel: '중',
    homeworkHistory: [],
    grades: [],
    consultations: [],
  }));
}
