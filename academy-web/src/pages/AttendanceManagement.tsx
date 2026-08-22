import { useMemo, useState } from 'react';
import { Tabs } from '../components/common/Tabs';
import { AttendanceCheckPanel } from '../components/attendance/AttendanceCheckPanel';
import { AttendanceHistoryPanel } from '../components/attendance/AttendanceHistoryPanel';
import { AttendanceSheetPanel } from '../components/attendance/AttendanceSheetPanel';
import { classes } from '../data/mockClasses';
import styles from './AttendanceManagement.module.css';

export function AttendanceManagement() {
  const [monthValue, setMonthValue] = useState('2026-08');

  const monthLabel = useMemo(() => {
    const [y, m] = monthValue.split('-');
    return `${y}년 ${Number(m)}월`;
  }, [monthValue]);

  return (
    <>
      <div className={styles.headerRow}>
        <h1 className={styles.pageTitle}>출석 관리</h1>
        <div className={styles.pageSub}>
          수업별로 학생 출결을 기록하고 월별 통계 · 인쇄용 출석부를 확인합니다.
        </div>
      </div>

      <div className={styles.monthCard}>
        <label>조회 월 (출석 이력·통계 탭 기준)</label>
        <input
          type="month"
          className={styles.monthInput}
          value={monthValue}
          onChange={(e) => setMonthValue(e.target.value)}
        />
        <div className={styles.monthCaption}>선택한 월 전체 출석 데이터가 '출석 이력 및 통계' 탭에 표시됩니다.</div>
      </div>

      <Tabs
        tabs={[
          { key: 'check', label: '출석 체크', content: <AttendanceCheckPanel classes={classes} /> },
          {
            key: 'history',
            label: '출석 이력 및 통계',
            content: <AttendanceHistoryPanel classes={classes} monthLabel={monthLabel} />,
          },
          { key: 'sheet', label: '출석부 만들기', content: <AttendanceSheetPanel classes={classes} /> },
        ]}
      />
    </>
  );
}
