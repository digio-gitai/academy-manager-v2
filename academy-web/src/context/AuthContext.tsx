import { createContext, useContext, useState, type ReactNode } from 'react';
import { getStoredSession, clearSession, isManagerRole, type TeacherSession } from '../lib/auth';

interface AuthContextValue {
  session: TeacherSession | null;
  /** 관리자급(admin/vice/director)인지 — true면 전체 데이터 조회 가능. */
  isManager: boolean;
  /**
   * 학생/반 등을 조회할 때 이 값을 필터로 넘기면 됨.
   * 관리자면 null(=전체 조회), 일반 강사면 본인 teacher id로 좁혀서 조회.
   * 운영 스트림릿의 get_all_students(teacher_id)/get_all_classes(teacher_id)와 같은 개념.
   */
  scopeTeacherId: number | null;
  login: (session: TeacherSession) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * 로그인 세션을 앱 전체에서 공유하기 위한 Context. 2026-09-02 신규 추가 —
 * 그동안 로그인 화면은 있었지만 실제로 인증하지 않고 그냥 대시보드로
 * 넘어가는 mock이었음. 이제 teachers 테이블과 실제로 연동됨(src/lib/auth.ts).
 *
 * 세션은 localStorage에도 저장해서(auth.ts) 새로고침해도 로그인 상태가
 * 유지되게 했고, 여기서는 그 값을 초기 state로 읽어와 앱 전체에 공유한다.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<TeacherSession | null>(() => getStoredSession());

  function login(next: TeacherSession) {
    setSession(next);
  }

  function logout() {
    clearSession();
    setSession(null);
  }

  const isManager = session ? isManagerRole(session.role) : false;

  return (
    <AuthContext.Provider
      value={{
        session,
        isManager,
        scopeTeacherId: isManager ? null : (session?.id ?? null),
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth()는 AuthProvider 안에서만 사용할 수 있습니다.');
  }
  return ctx;
}
