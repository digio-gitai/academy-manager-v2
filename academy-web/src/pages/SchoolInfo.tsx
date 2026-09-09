import { Tabs } from '../components/common/Tabs';
import { CalendarTab } from '../components/schoolInfo/CalendarTab';
import { TextbookTab } from '../components/schoolInfo/TextbookTab';
import { ExamScopeTab } from '../components/schoolInfo/ExamScopeTab';
import styles from './SchoolInfo.module.css';

/**
 * 스트림릿 render_school_info_page() 재현 + 시험범위 탭 신규 추가(2026-09-09).
 * 탭 3개: 학사일정 / 교과서 목록 / 시험범위.
 */
export function SchoolInfo() {
  return (
    <>
      <div className={styles.headerRow}>
        <h1 className={styles.pageTitle}>학사정보</h1>
        <div className={styles.pageSub}>
          학교·학년별 학사일정(중간고사/기말고사/방학/기타), 교과서 목록, 수학 시험범위를 연도별로 관리합니다.
        </div>
      </div>

      <Tabs
        tabs={[
          { key: 'calendar', label: '📅 학사일정', content: <CalendarTab /> },
          { key: 'textbook', label: '📚 교과서 목록', content: <TextbookTab /> },
          { key: 'examScope', label: '🧮 시험범위', content: <ExamScopeTab /> },
        ]}
      />
    </>
  );
}
