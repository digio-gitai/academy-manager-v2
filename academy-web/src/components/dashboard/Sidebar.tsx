import { useState } from 'react';
import type { MenuItem, TeacherProfile } from '../../types/dashboard';
import styles from './Sidebar.module.css';

interface SidebarProps {
  menuItems: MenuItem[];
  profile: TeacherProfile;
}

export function Sidebar({ menuItems, profile }: SidebarProps) {
  const [activeId, setActiveId] = useState(menuItems[0]?.id);

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logoRow}>
        <div className={styles.logoBadge}>
          <span className={styles.logoLetter}>J</span>
        </div>
        <span className={styles.logoText}>J MATH</span>
      </div>

      <nav className={styles.nav}>
        {menuItems.map((m) => {
          const active = m.id === activeId;
          return (
            <div
              key={m.id}
              className={styles.navItem}
              data-active={active}
              onClick={() => setActiveId(m.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setActiveId(m.id);
              }}
            >
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
            </div>
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
