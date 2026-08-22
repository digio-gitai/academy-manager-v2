import { Sidebar } from '../components/dashboard/Sidebar';
import { KpiRow } from '../components/dashboard/KpiRow';
import { ClassListCard } from '../components/dashboard/ClassListCard';
import { HomeworkStatusCard } from '../components/dashboard/HomeworkStatusCard';
import { ReportsTable } from '../components/dashboard/ReportsTable';
import {
  classes,
  homeworkStudents,
  kpis,
  menuItems,
  reports,
  teacherProfile,
  todayLabel,
} from '../data/mockDashboard';
import styles from './TeacherDashboard.module.css';

export function TeacherDashboard() {
  return (
    <div className={styles.page}>
      <Sidebar menuItems={menuItems} profile={teacherProfile} />

      <main className={styles.main}>
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
      </main>
    </div>
  );
}
