import { Link, useLocation } from 'react-router-dom';
import type { MenuItem, TeacherProfile } from '../../types/dashboard';
import styles from './Sidebar.module.css';

interface SidebarProps {
  menuItems: MenuItem[];
  profile: TeacherProfile;
  /** 2026-09-02 모바일 대응 추가 — true면 좁은 화면에서 슬라이드인으로 펼쳐짐(AppLayout이 관리). */
  mobileOpen?: boolean;
}

export function Sidebar({ menuItems, profile, mobileOpen }: SidebarProps) {
  const location = useLocation();

  return (
    <aside className={styles.sidebar} data-mobile-open={mobileOpen ? 'true' : 'false'}>
      <Link to="/dashboard" className={styles.logoRow}>
        <div className={styles.logoBadge}>
          <span className={styles.logoLetter}>J</span>
        </div>
        <span className={styles.logoText}>J MATH</span>
      </Link>

      <nav className={styles.nav}>
        {menuItems.map((m) => {
          const active = location.pathname === m.path;
          return (
            <Link key={m.id} to={m.path} className={styles.navItem} data-active={active}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke={active ? 'var(--color-accent)' : 'rgba(240,230,210,0.6)'}
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={styles.navIcon}
              >
                <path d={m.icon} />
              </svg>
              <span className={styles.navLabel} data-active={active}>
                {m.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className={styles.profile}>
        <div className={styles.avatar}>
          <span className={styles.avatarInitial}>{profile.initial}</span>
        </div>
        <div>
          <div className={styles.profileName}>{profile.name}</div>
          <div className={styles.profileEmail}>{profile.email}</div>
        </div>
      </div>
    </aside>
  );
}
