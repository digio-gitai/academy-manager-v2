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

const STORAGE_KEY = 'jmath_teacher_session';

/** 로그인 화면의 "이름 선택" 드롭다운용 — 이름만 조회(비밀번호는 절대 조회 안 함). */
export async function fetchTeacherOptions(): Promise<TeacherOption[]> {
  const { data, error } = await supabase.from('teachers').select('id, name').order('name', { ascending: true });
  if (error) {
    throw error;
  }
  return (data as TeacherOption[]) ?? [];
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // localStorage를 못 쓰는 환경이어도 로그인 자체는 성공 처리 — 새로고침 시
    // 세션 유지만 안 될 뿐, 지금 이 화면에서 로그인된 상태로 계속 쓸 수 있음.
  }
  return session;
}

/** 새로고침 후에도 로그인 상태를 유지하기 위해 저장해둔 세션을 읽어옴. */
export function getStoredSession(): TeacherSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
