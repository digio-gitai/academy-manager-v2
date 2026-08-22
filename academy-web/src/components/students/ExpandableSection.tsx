import type { ReactNode } from 'react';
import styles from './ExpandableSection.module.css';

interface ExpandableSectionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

/**
 * 스트림릿의 st.expander와 동일한 느낌의 접이식 섹션(기본은 접힘).
 * 학생 명부 상세 화면의 "학생 성적 통합 조회 / 과제 수행 이력 / 학생 반 재배정 / 학생 삭제"
 * 4개 섹션에 재사용됨.
 */
export function ExpandableSection({ title, children, defaultOpen = false }: ExpandableSectionProps) {
  return (
    <details className={styles.details} open={defaultOpen}>
      <summary className={styles.summary}>
        <svg className={styles.chevron} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M9 18l6-6-6-6" />
        </svg>
        {title}
      </summary>
      <div className={styles.body}>{children}</div>
    </details>
  );
}
