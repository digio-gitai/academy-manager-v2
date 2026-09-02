import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { Sidebar } from '../dashboard/Sidebar';
import { menuItems } from '../../data/mockDashboard';
import { useAuth } from '../../context/AuthContext';
import { ROLE_LABEL_KR } from '../../lib/auth';
import styles from './AppLayout.module.css';

/**
 * 공용 teacher 앱 셸(사이드바 + 메인 영역).
 * teacher 화면(대시보드, 학생 명부 등)은 이 레이아웃 안에 <Outlet />으로
 * 렌더링된다. 화면마다 사이드바를 새로 만들 필요 없이 이 컴포넌트 하나만
 * 재사용하면 됨.
 *
 * 2026-09-02: 로그인 기능을 실제로 연동하면서 이 레이아웃에 로그인 가드를
 * 추가함 — 로그인 세션(useAuth)이 없으면 /login으로 돌려보낸다. 예전에는
 * 로그인 화면이 있어도 그냥 지나칠 수 있었음(App.tsx가 "/"를 /dashboard로
 * 바로 리다이렉트하고, 이 레이아웃 자체가 세션을 검사하지 않았음).
 * 사이드바 하단 프로필도 더 이상 mockDashboard.ts의 고정값이 아니라 실제
 * 로그인한 강사 이름/역할을 보여줌.
 *
 * 모바일 반응형(860px 이하 햄버거 메뉴)은 그대로 유지.
 */
export function AppLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { session, logout } = useAuth();

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  const profile = {
    name: session.name,
    email: ROLE_LABEL_KR[session.role] ?? session.role,
    initial: session.name.charAt(0),
  };

  return (
    <div className={styles.page}>
      <div className={styles.mobileTopBar}>
        <button
          type="button"
          className={styles.hamburgerButton}
          onClick={() => setMobileNavOpen((v) => !v)}
          aria-label="메뉴 열기/닫기"
        >
          <span />
          <span />
          <span />
        </button>
        <span className={styles.mobileTopBarTitle}>J MATH</span>
      </div>

      {mobileNavOpen && (
        <div className={styles.overlay} onClick={() => setMobileNavOpen(false)} aria-hidden="true" />
      )}

      <Sidebar menuItems={menuItems} profile={profile} mobileOpen={mobileNavOpen} onLogout={handleLogout} />

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
