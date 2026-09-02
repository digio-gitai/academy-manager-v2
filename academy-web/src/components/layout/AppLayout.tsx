import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from '../dashboard/Sidebar';
import { menuItems, teacherProfile } from '../../data/mockDashboard';
import styles from './AppLayout.module.css';

/**
 * 공용 teacher 앱 셸(사이드바 + 메인 영역).
 * teacher 화면(대시보드, 앞으로 추가될 내 수업 관리/학생 명부 등)은
 * 이 레이아웃 안에 <Outlet />으로 렌더링된다.
 * 화면마다 사이드바를 새로 만들 필요 없이 이 컴포넌트 하나만 재사용하면 됨.
 *
 * 2026-09-02: 모바일에서 자주 쓰겠다는 사용자 요청으로 반응형 처리 추가.
 * 화면이 좁아지면(860px 이하, Sidebar.module.css의 미디어쿼리와 동일 기준)
 * 사이드바가 기본적으로 화면 밖으로 숨고, 위쪽 햄버거 버튼을 눌러야 슬라이드
 * 인 메뉴로 나타남. 메뉴를 눌러 다른 화면으로 이동하면 자동으로 닫힘(아래
 * useEffect, location.pathname이 바뀔 때마다 실행).
 */
export function AppLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

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

      <Sidebar menuItems={menuItems} profile={teacherProfile} mobileOpen={mobileNavOpen} />

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
