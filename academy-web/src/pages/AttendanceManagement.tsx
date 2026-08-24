import { useEffect, useMemo, useState } from 'react';
import { Tabs } from '../components/common/Tabs';
import { AttendanceCheckPanel } from '../components/attendance/AttendanceCheckPanel';
import { AttendanceHistoryPanel } from '../components/attendance/AttendanceHistoryPanel';
import { AttendanceSheetPanel } from '../components/attendance/AttendanceSheetPanel';
import { fetchClasses } from '../lib/classManagement';
import type { ClassInfo } from '../types/classManagement';
import styles from './AttendanceManagement.module.css';

/**
 * 2026-08-24부터: 반 목록을 실제 dev DB(Supabase)에서 조회(lib/classManagement.ts
 * 재사용 — 내 수업 관리 화면과 동일한 함수). 출석 체크/이력·통계는 각 하위
 * 패널(AttendanceCheckPanel/AttendanceHistoryPanel)에서 lib/attendance.ts로
 * 개별 연동. '출석부 만들기' 탭은 DB 쓰기가 필요 없는 순수 계산 화면이라
 * 반 목록만 실제 데이터면 그대로 동작함.
 */
export function AttendanceManagement() {
  const [monthValue, setMonthValue] = useState('2026-08');
  const [classList, setClassList] = useState<ClassInfo[]>([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [rosterError, setRosterError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setRosterLoading(true);
    setRosterError('');
    fetchClasses()
      .then((data) => {
        if (cancelled) return;
        setClassList(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setRosterError(err instanceof Error ? err.message : '반 목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setRosterLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const monthLabel = useMemo(() => {
    const [y, m] = monthValue.split('-');
    return `${y}년 ${Number(m)}월`;
  }, [monthValue]);

  const { fromDate, toDate } = useMemo(() => {
    const [y, m] = monthValue.split('-').map(Number);
    if (!y || !m) return { fromDate: monthValue, toDate: monthValue };
    const lastDay = new Date(y, m, 0).getDate();
    const pad = (n: number) => String(n).padStart(2, '0');
    return { fromDate: `${y}-${pad(m)}-01`, toDate: `${y}-${pad(m)}-${pad(lastDay)}` };
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

      {rosterLoading && <p className={styles.pageSub}>DB에서 반 목록을 불러오는 중입니다...</p>}
      {rosterError && !rosterLoading && (
        <p className={styles.pageSub}>반 목록을 불러오지 못했습니다: {rosterError}</p>
      )}
      {!rosterLoading && !rosterError && classList.length === 0 && (
        <p className={styles.pageSub}>등록된 수업이 없습니다. 먼저 '내 수업 관리'에서 수업을 만들어 주세요.</p>
      )}

      {!rosterLoading && !rosterError && classList.length > 0 && (
        <Tabs
          tabs={[
            { key: 'check', label: '출석 체크', content: <AttendanceCheckPanel classes={classList} /> },
            {
              key: 'history',
              label: '출석 이력 및 통계',
              content: (
                <AttendanceHistoryPanel
                  classes={classList}
                  monthLabel={monthLabel}
                  fromDate={fromDate}
                  toDate={toDate}
                />
              ),
            },
            { key: 'sheet', label: '출석부 만들기', content: <AttendanceSheetPanel classes={classList} /> },
          ]}
        />
      )}
    </>
  );
}
