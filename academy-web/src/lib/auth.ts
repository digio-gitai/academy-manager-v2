import { supabase } from './supabaseClient';

export type TeacherRole = 'teacher' | 'admin' | 'vice' | 'director';

export interface TeacherSession {
  id: number;
  name: string;
  role: TeacherRole;
}

export interface TeacherOption {
  id: number;
  name: string;
}

const STORAGE_KEY = 'jmath_teacher_session';

export const ROLE_LABEL_KR: Record<TeacherRole, string> = {
  teacher: '강사',
  admin: '관리자',
  vice: '부원장',
  director: '원장',
};

/**
 * 관리자급(admin/vice/director)이면 전체 권한(모든 반 조회), 일반 강사(teacher)면
 * 본인이 담당한 반만 — 운영 스트림릿 app.py의 _is_manager()/_ROLE_KR와 동일 규칙.
 */
export function isManagerRole(role: string): boolean {
  return role === 'admin' || role === 'vice' || role === 'director';
}

/**
 * 로그인 화면의 "이름 선택" 드롭다운용 — 이름만 조회(비밀번호는 절대 조회 안 함).
 * 운영 스트림릿 app.py의 get_all_teachers()와 동일하게, 이름에 "test"/"테스트"가
 * 들어간 계정(개발 중 테스트용으로 만들어둔 계정)은 로그인 목록에서 숨긴다.
 */
export async function fetchTeacherOptions(): Promise<TeacherOption[]> {
  const { data, error } = await supabase.from('teachers').select('id, name').order('name', { ascending: true });
  if (error) {
    throw error;
  }
  const all = (data as TeacherOption[]) ?? [];
  return all.filter((t) => !/test|테스트/i.test(t.name));
}

/**
 * 이름 + 4자리 비밀번호로 로그인.
 *
 * 비밀번호 대조는 브라우저가 아니라 DB 쪽 함수(login_teacher, SECURITY DEFINER)가
 * 서버 사이드로 처리한다 — teachers.password를 브라우저로 절대 내려보내지 않기
 * 위함(이 코드베이스의 기존 관례: "password는 절대 select 금지", students.ts 참고).
 * 함수 자체는 SQL Editor에서 한 번 만들어둬야 함(academy_dev/CLAUDE.md 또는
 * 사용자에게 전달한 마이그레이션 SQL 참고).
 *
 * 운영 스트림릿 app.py의 _nav_teacher_selectbox() 로그인 로직과 같은 테이블/
 * 컬럼(teachers.name, teachers.password, teachers.role)을 그대로 사용함.
 */
export async function loginTeacher(name: string, password: string): Promise<TeacherSession> {
  const { data, error } = await supabase.rpc('login_teacher', { p_name: name, p_password: password });
  if (error) {
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error('이름 또는 비밀번호가 올바르지 않습니다.');
  }
  const session: TeacherSession = {
    id: row.id,
    name: row.name,
    role: (row.role || 'teacher') as TeacherRole,
  };
  // 2026-09-03: localStorage 대신 sessionStorage에 저장 — 사용자가 "새로고침할
  // 때마다 로그인 화면 나오는 건 불편하다"고 재요청해서 절충함. sessionStorage는
  // 같은 탭에서 새로고침해도 유지되지만, 탭/브라우저를 완전히 닫거나 새 탭을
  // 열면 사라진다 — "지난 사람이 로그인된 채로 남아있는" 원래 문제(localStorage)도
  // 막으면서, 새로고침마다 재로그인해야 하는 불편함(세션 미저장)도 없앤 절충안.
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // sessionStorage를 못 쓰는 환경이어도 로그인 자체는 성공 처리.
  }
  return session;
}

/**
 * 로그인된 강사 본인의 비밀번호를 변경한다("설정" 화면에서 사용). 현재
 * 비밀번호 대조는 change_teacher_password() 함수 안에서만 이뤄진다(비밀번호
 * 칸은 브라우저에서 직접 SELECT하지 않는다는 프로젝트 규칙 유지).
 *
 * 반환값 false = 현재 비밀번호가 틀림. 서버 쪽 유효성 검사(4자리 숫자가
 * 아님 등) 실패 시에는 Supabase가 에러를 던지므로 그대로 throw됨.
 */
/** 같은 탭에서 새로고침해도 로그인 상태를 유지하기 위해 sessionStorage에서 세션을 읽어옴. */
export function getStoredSession(): TeacherSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.id !== 'number' || typeof parsed.name !== 'string') return null;
    return parsed as TeacherSession;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export async function changeTeacherPassword(
  teacherId: number,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('change_teacher_password', {
    p_teacher_id: teacherId,
    p_current_password: currentPassword,
    p_new_password: newPassword,
  });
  if (error) {
    throw error;
  }
  return Boolean(data);
}
