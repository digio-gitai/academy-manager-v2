import { useState, type ReactNode } from 'react';
import styles from './Tabs.module.css';

export interface TabDef {
  key: string;
  label: string;
  content: ReactNode;
}

interface TabsProps {
  tabs: TabDef[];
  defaultKey?: string;
}

/**
 * 스트림릿 st.tabs()에 대응하는 범용 탭 컴포넌트.
 * 출석 관리 · 성적 리포트 등 여러 화면에서 재사용됨.
 */
export function Tabs({ tabs, defaultKey }: TabsProps) {
  const [active, setActive] = useState(defaultKey ?? tabs[0]?.key);
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div>
      <div className={styles.tabBar} role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            className={styles.tabButton}
            data-active={t.key === active}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className={styles.tabPanel}>{activeTab?.content}</div>
    </div>
  );
}
