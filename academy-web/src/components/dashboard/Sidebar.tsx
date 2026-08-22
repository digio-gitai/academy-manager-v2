import { Link, useLocation } from 'react-router-dom';
import type { MenuItem, TeacherProfile } from '../../types/dashboard';
import styles from './Sidebar.module.css';

interface SidebarProps {
  menuItems: MenuItem[];
  profile: TeacherProfile;
}

export function Sidebar({ menuItems, profile }: SidebarProps) {
  const location = useLocation();

  return (
    <aside className={styles.sidebar}>
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
