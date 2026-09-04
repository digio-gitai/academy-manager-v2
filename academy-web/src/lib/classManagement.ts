import { supabase } from './supabaseClient';
import type { ClassInfo, ClassStudentInfo, ScheduleSlot, TeacherOption } from '../types/classManagement';

// dev Supabase의 실제 스키마(app.py CREATE TABLE 구문 기준, 2026-08-24 확인):
//   classes : id(SERIAL), name(TEXT NOT NULL UNIQUE), description(TEXT DEFAULT ''),
//     teacher_id(INTEGER, FK→teachers, nullable), schedule(TEXT DEFAULT '[]')
//   teachers: id, name, created_at, password, role — password는 절대 클라이언트로
//     select하지 않음(브라우저에 그대로 노출되는 Publishable key 접속이라 민감 컬럼
//     제외가 중요). id, name만 조회.
//   students: (students.ts와 동일 테이블) class_id로 반 소속 확인.
//
// schedule 컬럼의 실제 JSON 형태는 app.py의 대시보드 "신규 수업" 코드가 기준 —
// {days:[...], start, end} 묶음이 아니라 요일 하나당 한 행씩 펼친 배열:
//   [{"day":"월","start":"17:00","end":"18:30"}, {"day":"수","start":"17:00","end":"18:30"}, ...]
// React 쪽 ScheduleSlot 타입({days:[], start, end})은 화면 입력 편의를 위한 묶음
// 형태라서, DB에 저장/조회할 때 서로 변환해줘야 함(아래 parseSchedule/serializeSchedule).

interface ClassRow {
  id: number;
  name: string;
  description: string | null;
  teacher_id: number | null;
  schedule: string | null;
  teachers: { name: string } | null;
}

interface StudentRow {
  id: number;
  name: string;
  school: string | null;
  grade: string | null;
  class_id: number | null;
  registered_at: string | null;
  parent_phone: string | null;
  student_phone: string | null;
  pre_visit_progress: string | null;
  expectations: string | null;
  notes: string | null;
  is_paused: boolean | null;
  withdrawn_at: string | null;
}

interface FlatScheduleEntry {
  day: string;
  start: string;
  end: string;
}

function parseSchedule(json: string | null): ScheduleSlot[] {
  if (!json) return [];
  let flat: FlatScheduleEntry[];
  try {
    flat = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(flat)) return [];
  // 같은 시작/종료 시간을 쓰는 요일들을 하나의 슬롯으로 다시 묶음(화면 표시용).
  const order: string[] = [];
  const groups = new Map<string, ScheduleSlot>();
  for (const entry of flat) {
    const key = `${entry.start}|${entry.end}`;
    if (!groups.has(key)) {
      groups.set(key, { days: [], start: entry.start, end: entry.end });
      order.push(key);
    }
    groups.get(key)!.days.push(entry.day);
  }
  return order.map((key) => groups.get(key)!);
}

function serializeSchedule(slots: ScheduleSlot[]): string {
  const flat: FlatScheduleEntry[] = [];
  for (const slot of slots) {
    for (const day of slot.days) {
      flat.push({ day, start: slot.start, end: slot.end });
    }
  }
  return JSON.stringify(flat);
}

/** 강사 목록(id/이름만 — password 등 민감 컬럼 제외). app.py의 get_all_teachers() 대응. */
export async function fetchTeacherOptions(): Promise<TeacherOption[]> {
  const { data, error } = await supabase.from('teachers').select('id, name').order('name', { ascending: true });
  if (error) {
    throw error;
  }
  return ((data as { id: number; name: string }[]) ?? []).map((row) => ({ id: String(row.id), name: row.name }));
}

/** 반 목록(담당 강사 이름 + 반별 학생 목록 포함). app.py의 get_all_classes()+get_all_students() 조합 대응. */
export async function fetchClasses(): Promise<ClassInfo[]> {
  const [classesRes, studentsRes] = await Promise.all([
    supabase
      .from('classes')
      .select('id, name, description, teacher_id, schedule, teachers ( name )')
      .order('name', { ascending: true }),
    supabase
      .from('students')
      .select(
        'id, name, school, grade, class_id, registered_at, parent_phone, student_phone, pre_visit_progress, expectations, notes, is_paused, withdrawn_at',
      )
      .order('name', { ascending: true }),
  ]);

  if (classesRes.error) {
    throw classesRes.error;
  }
  if (studentsRes.error) {
    throw studentsRes.error;
  }

  // 2026-09-02: 휴원(수업중지) 처리된 학생은 반별 학생 목록에서 제외한다 —
  // 이 fetchClasses()가 출석 관리/과제 인증/성적 입력 대상 화면의 학생 목록으로
  // 공용으로 쓰이기 때문에(app.py의 get_students_by_class()와 동일한 역할),
  // 여기 한 곳만 고치면 그 화면들에 자연스럽게 다 반영된다. 학생 명부
  // (StudentRoster)는 별도의 fetchStudents()를 쓰므로 휴원 학생도 계속 보임.
  // 2026-09-04: 퇴원 처리된 학생도 동일하게 제외한다(과제/출석 등 활성 기능
  // 전체에서 자동으로 빠져야 하므로) — 단, 퇴원 학생은 fetchStudents() 쪽에서도
  // 기본적으로 제외되어 학생 명부에는 안 보이고, 별도 '퇴원생 목록'에서만 보임.
  const studentsByClass = new Map<number, Omit<ClassStudentInfo, 'className'>[]>();
  for (const row of (studentsRes.data as unknown as StudentRow[]) ?? []) {
    if (row.class_id == null || row.is_paused || (row.withdrawn_at ?? '').trim()) continue;
    const list = studentsByClass.get(row.class_id) ?? [];
    list.push({
      id: String(row.id),
      name: row.name,
      school: row.school ?? '',
      grade: row.grade ?? '',
      registeredAt: row.registered_at ?? '',
      parentPhone: row.parent_phone ?? '',
      studentPhone: row.student_phone ?? '',
      preVisitProgress: row.pre_visit_progress ?? '',
      expectations: row.expectations ?? '',
      notes: row.notes ?? '',
      recentConsultations: [], // 화면에서 학생을 펼칠 때 lib/consultation.ts로 따로 조회(불필요한 전체 조회 방지)
    });
    studentsByClass.set(row.class_id, list);
  }

  return ((classesRes.data as unknown as ClassRow[]) ?? []).map((row) => ({
    id: String(row.id),
    name: row.name,
    description: row.description ?? '',
    teacherId: row.teacher_id != null ? String(row.teacher_id) : null,
    teacherName: row.teachers?.name ?? '— 미지정 —',
    schedule: parseSchedule(row.schedule),
    students: (studentsByClass.get(row.id) ?? []).map((s) => ({ ...s, className: row.name })),
  }));
}

/** 새 수업 생성. app.py의 add_class() 대응 (이름 중복 시 UNIQUE 제약으로 에러). */
export async function addClass(params: {
  name: string;
  description: string;
  teacherId: string | null;
  schedule: ScheduleSlot[];
}): Promise<void> {
  const { error } = await supabase.from('classes').insert({
    name: params.name.trim(),
    description: params.description.trim(),
    teacher_id: params.teacherId != null ? Number(params.teacherId) : null,
    schedule: serializeSchedule(params.schedule),
  });
  if (error) {
    if (error.code === '23505') {
      throw new Error('같은 이름의 수업이 이미 존재합니다.');
    }
    throw error;
  }
}

/** 담당 강사 변경. app.py의 assign_teacher_to_class() 대응. */
export async function assignTeacherToClass(classId: string, teacherId: string | null): Promise<void> {
  const { error } = await supabase
    .from('classes')
    .update({ teacher_id: teacherId != null ? Number(teacherId) : null })
    .eq('id', Number(classId));
  if (error) {
    throw error;
  }
}

/** 수업 삭제. app.py의 delete_class() 대응. */
export async function deleteClass(classId: string): Promise<void> {
  const { error } = await supabase.from('classes').delete().eq('id', Number(classId));
  if (error) {
    throw error;
  }
}
