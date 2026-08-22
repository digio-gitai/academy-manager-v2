import { Outlet } from 'react-router-dom';
import { Sidebar } from '../dashboard/Sidebar';
import { menuItems, teacherProfile } from '../../data/mockDashboard';
import styles from './AppLayout.module.css';

/**
 * 공용 teacher 앱 셸(사이드바 + 메인 영역).
 * teacher 화면(대시보드, 앞으로 추가될 내 수업 관리/학생 명부 등)은
 * 이 레이아웃 안에 <Outlet />으로 렌더링된다.
 * 화면마다 사이드바를 새로 만들 필요 없이 이 컴포넌트 하나만 재사용하면 됨.
 */
export function AppLayout() {
  return (
    <div className={styles.page}>
      <Sidebar menuItems={menuItems} profile={teacherProfile} />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
