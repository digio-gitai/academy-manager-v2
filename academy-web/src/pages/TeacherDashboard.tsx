import { KpiRow } from '../components/dashboard/KpiRow';
import { ClassListCard } from '../components/dashboard/ClassListCard';
import { HomeworkStatusCard } from '../components/dashboard/HomeworkStatusCard';
import { ReportsTable } from '../components/dashboard/ReportsTable';
import {
  classes,
  homeworkStudents,
  kpis,
  reports,
  todayLabel,
} from '../data/mockDashboard';
import styles from './TeacherDashboard.module.css';

/**
 * 대시보드 "내용" 부분만 렌더링. 사이드바/전체 레이아웃은
 * components/layout/AppLayout이 감싸서 제공함(App.tsx의 라우트 구조 참고).
 */
export function TeacherDashboard() {
  return (
    <>
      <div className={styles.headerRow}>
        <div>
          <div className={styles.dateLabel}>{todayLabel}</div>
          <h1 className={styles.pageTitle}>오늘의 학원 현황</h1>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.secondaryButton}>
            출결 입력
          </button>
          <button type="button" className={styles.primaryButton}>
            리포트 생성
          </button>
        </div>
      </div>

      <KpiRow kpis={kpis} />

      <div className={styles.twoColumn}>
        <ClassListCard classes={classes} />
        <HomeworkStatusCard students={homeworkStudents} />
      </div>

      <ReportsTable reports={reports} />
    </>
  );
}
