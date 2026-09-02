import { supabase } from './supabaseClient';
import type { HomeworkHistoryEntry, HomeworkLevel, StudentProfile } from '../types/student';

export interface ClassOption {
  id: string;
  name: string;
}

/**
 * 반 목록(id 포함) — 학생 반 재배정 드롭다운용. 2026-08-24: 기존에는 이 화면이
 * "지금 명부에 있는 학생들의 반 이름"만 모아서 드롭다운을 만들었는데, 그러면
 * 학생이 0명인 새 반은(예: 새로 만든 "프리미엄반")이 안 뜨는 버그가 있었음
 * (사용자가 실사용 중 발견). classes 테이블을 직접 조회해서 항상 전체 반
 * 목록이 뜨도록 수정.
 */
export async function fetchClassOptions(teacherId?: number | null): Promise<ClassOption[]> {
  let query = supabase.from('classes').select('id, name').order('name', { ascending: true });
  if (teacherId != null) {
    query = query.eq('teacher_id', teacherId);
  }
  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return ((data as { id: number; name: string }[]) ?? []).map((row) => ({ id: String(row.id), name: row.name }));
}

export interface UpdateStudentInput {
  name: string;
  school: string;
  grade: string;
  preVisitProgress: string;
  contactInfo: string; // 학부모 연락처 — parent_phone/contact_info 둘 다 이 값으로 갱신(addStudentIntake와 동일 규칙)
  studentPhone: string;
  expectations: string;
  notes: string;
}

/**
 * 학생 정보 수정(이름/학교/학년/연락처/메모 등). 2026-09-02 사용자 요청 —
 * 명부에 "등록" 기능만 있고 이미 등록된 학생 정보를 고치는 기능이 없어서
 * 추가함. 반 배정은 이미 별도의 reassignStudentClass가 있어서 여기서는
 * 다루지 않음.
 */
export async function updateStudentProfile(studentId: string, input: UpdateStudentInput): Promise<void> {
  const phone = input.contactInfo.trim() || '—';
  const { error } = await supabase
    .from('students')
    .update({
      name: input.name.trim(),
      parent_phone: phone,
      contact_info: input.contactInfo.trim(),
      school: input.school.trim(),
      grade: input.grade.trim(),
      pre_visit_progress: input.preVisitProgress.trim(),
      expectations: input.expectations.trim(),
      notes: input.notes.trim(),
      student_phone: input.studentPhone.trim(),
    })
    .eq('id', Number(studentId));
  if (error) {
    throw error;
  }
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

export interface NewStudentInput {
  name: string;
  registeredAt: string; // 'YYYY-MM-DD'
  school: string;
  grade: string;
  preVisitProgress: string;
  contactInfo: string; // 학부모 연락처
  studentPhone: string;
  expectations: string;
  notes: string;
  classId: string; // '' = 반 미배정
}

/**
 * 신규 학생 등록 (app.py의 add_student_intake / 대시보드 "신규 학생 등록" 탭 대응).
 * 2026-08-27: React 쪽은 대시보드가 아니라 학생 명부 화면(StudentRoster.tsx)에
 * 폼을 두기로 사용자와 상의해서 정함(반 재배정/삭제 등 다른 학생 관리 기능도
 * 전부 이 화면에 있어서). parent_phone은 app.py와 동일하게 contact_info와 같은
 * 값을 넣고, 비어있으면 "—"로 채움.
 */
export async function addStudentIntake(input: NewStudentInput): Promise<void> {
  const phone = input.contactInfo.trim() || '—';
  const { error } = await supabase.from('students').insert({
    name: input.name.trim(),
    parent_phone: phone,
    class_id: input.classId ? Number(input.classId) : null,
    registered_at: `${input.registeredAt} 00:00`,
    school: input.school.trim(),
    grade: input.grade.trim(),
    pre_visit_progress: input.preVisitProgress.trim(),
    contact_info: input.contactInfo.trim(),
    expectations: input.expectations.trim(),
    notes: input.notes.trim(),
    student_phone: input.studentPhone.trim(),
  });
  if (error) {
    throw error;
  }
}

// dev Supabase의 실제 컬럼(2026-08-22, SQL Editor로 확인한 값):
//   students: id, name, parent_phone, class_id, registered_at, school, grade,
//             pre_visit_progress, contact_info, expectations, notes,
//             student_phone, test_results
//   classes : id, name, description, teacher_id, schedule
//   teachers: id, name, ... (password는 절대 select 금지 — 아래도 name만 조회)
//
// 2026-08-27: teachers 이름 조인 추가(classes.teacher_id → teachers.name, 담당강사
// 표시용). 상담/성적/과제이력은 이 함수로 미리 채우지 않고, 학생 명부 화면
// (StudentRoster.tsx)에서 학생을 선택할 때마다 각각의 lib(consultation.ts/
// grades.ts/이 파일의 fetchHomeworkPerformance)로 지연 조회함 — 목록을 부를 때마다
// 전체 학생의 상세 데이터까지 다 끌어오면 불필요하게 무거워짐.
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
  classes: { name: string; teachers: { name: string } | null } | null;
}

export async function fetchStudents(teacherId?: number | null): Promise<StudentProfile[]> {
  // teacherId가 주어지면(비관리자 로그인) 본인이 맡은 반의 학생만 조회한다.
  // PostgREST에서 embed된 테이블(classes)의 컬럼으로 필터링하려면 !inner 조인
  // 힌트가 필요함 — 안 쓰면 filter가 무시된다. 반이 없는 학생까지 보여줘야
  // 하는 관리자(teacherId 없음) 조회에서는 !inner를 쓰면 안 되므로 분기한다.
  const classesEmbed =
    teacherId != null ? 'classes!inner ( name, teacher_id, teachers ( name ) )' : 'classes ( name, teachers ( name ) )';

  let query = supabase
    .from('students')
    .select(
      `id, name, parent_phone, class_id, registered_at, school, grade, pre_visit_progress, contact_info, expectations, notes, student_phone, test_results, ${classesEmbed}`,
    )
    .order('id', { ascending: true });

  if (teacherId != null) {
    query = query.eq('classes.teacher_id', teacherId);
  }

  const { data, error } = await query;

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
    teacherName: row.classes?.teachers?.name ?? '—',
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

/**
 * 학생 삭제 (app.py의 delete_student 대응). 2026-08-27: 화면에서만 지워지던 걸
 * 실제 DB 삭제로 연결. 상담일지/출결/성적 등 이 학생을 참조하는 다른 테이블에
 * ON DELETE CASCADE가 안 걸려있으면 Postgres가 FK 위반 에러로 삭제를 막아주고,
 * 그 에러 메시지가 그대로 호출한 쪽(화면)에 전달됨 — 즉 "일부만 지워지고 나머지는
 * 남는" 상태는 발생하지 않고, 되거나 전혀 안 되거나 둘 중 하나임.
 */
export async function deleteStudent(studentId: string): Promise<void> {
  const { error } = await supabase.from('students').delete().eq('id', Number(studentId));
  if (error) {
    throw error;
  }
}

// student_homework_performance: 출석 관리에서 매 수업 직전 과제를 상/중/하로
// 체크하는 (구) 기능의 기록 테이블(homework.py, 2026-08-06 운영 앱에 추가됨).
// 컬럼: id(SERIAL), student_id, class_id(nullable), session_date, level('상'|'중'|'하'),
// created_at, updated_at, UNIQUE(student_id, session_date).
// ⚠️ 이 테이블은 dev DB가 스키마 복제로 만들어진 2026-08-01보다 나중(08-06)에
// 추가된 기능이라, dev DB에는 아직 없을 수 있음 — 없으면 이 조회만 에러로 실패하고
// (테이블이 없다는 Postgres 에러) 화면에는 그 에러 메시지만 표시됨, 다른 상세 정보
// (상담/성적)는 정상 표시됨. 없다는 게 확인되면 아래 SQL을 dev DB에 실행하면 됨:
//   CREATE TABLE IF NOT EXISTS student_homework_performance (
//     id SERIAL PRIMARY KEY,
//     student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
//     class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
//     session_date TEXT NOT NULL,
//     level TEXT NOT NULL DEFAULT '중',
//     created_at TEXT NOT NULL,
//     updated_at TEXT NOT NULL,
//     UNIQUE(student_id, session_date)
//   );
interface HomeworkPerformanceRow {
  session_date: string;
  level: string;
}

export interface HomeworkPerformanceSummary {
  entries: HomeworkHistoryEntry[];
  completionRate: number;
  recentLevel: HomeworkLevel;
}

/**
 * 학생 한 명의 과제 수행도(상/중/하) 이력 + 수행률.
 * app.py의 get_student_homework_performance_stats()와 동일한 계산식(상=100/중=50/하=0
 * 으로 환산한 평균)을 그대로 재현.
 */
export async function fetchHomeworkPerformance(studentId: string): Promise<HomeworkPerformanceSummary> {
  const { data, error } = await supabase
    .from('student_homework_performance')
    .select('session_date, level')
    .eq('student_id', Number(studentId))
    .order('session_date', { ascending: false });

  if (error) {
    throw error;
  }

  const rows = (data as HomeworkPerformanceRow[]) ?? [];
  const high = rows.filter((r) => r.level === '상').length;
  const mid = rows.filter((r) => r.level === '중').length;
  const total = rows.length;
  const completionRate = total ? Math.round(((high * 100 + mid * 50) / total) * 10) / 10 : 0;
  const recentLevel = (rows[0]?.level as HomeworkLevel) ?? '중';
  const entries: HomeworkHistoryEntry[] = rows.map((r) => ({
    date: r.session_date,
    level: (r.level as HomeworkLevel) ?? '중',
  }));

  return { entries, completionRate, recentLevel };
}
