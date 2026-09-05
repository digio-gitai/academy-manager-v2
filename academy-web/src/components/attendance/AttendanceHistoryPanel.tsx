import { useEffect, useMemo, useState } from 'react';
import type { ClassInfo } from '../../types/classManagement';
import type { AttendanceStatsRow, AttendanceLogRow, AttendanceStatus } from '../../types/attendance';
import { fetchAttendanceHistory } from '../../lib/attendance';
import { badgePalette } from '../dashboard/badgePalette';
import styles from './AttendanceHistoryPanel.module.css';

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: '출석',
  late: '지각',
  absent: '결석',
};

function toneForStatus(status: AttendanceStatus) {
  if (status === 'present') return badgePalette.green;
  if (status === 'late') return badgePalette.gold;
  return badgePalette.gray;
}

const CLASS_FILTER_ALL = '전체 수업';

interface AttendanceHistoryPanelProps {
  classes: ClassInfo[];
  monthLabel: string;
  fromDate: string;
  toDate: string;
}

/**
 * 스트림릿 page_attendance()의 "출석 이력 및 통계" 탭과 동일한 기능:
 * 학생별 출석 통계 + 세션별 출석 로그 + 출석부 PDF 출력.
 *
 * 2026-08-24부터: 통계/로그 전부 실제 dev DB(Supabase) 연동
 * (lib/attendance.ts의 fetchAttendanceHistory가 원본 스트림릿의
 * get_attendance_summary()/get_attendance_history()를 화면단 계산으로 재현).
 * PDF 출력은 서버 쪽 한글 폰트 PDF 생성기(fpdf2)를 그대로 옮기기엔 범위가 커서
 * 지금은 데모 안내 문구만 유지 — 운영 전환 단계에서 별도 처리 예정.
 */
export function AttendanceHistoryPanel({ classes, monthLabel, fromDate, toDate }: AttendanceHistoryPanelProps) {
  const [classFilter, setClassFilter] = useState(CLASS_FILTER_ALL);
  const [stats, setStats] = useState<AttendanceStatsRow[]>([]);
  const [log, setLog] = useState<AttendanceLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pdfMessage, setPdfMessage] = useState('');

  const selectedClassId = useMemo(
    () => (classFilter === CLASS_FILTER_ALL ? null : classFilter),
    [classFilter],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    fetchAttendanceHistory(fromDate, toDate, selectedClassId)
      .then(({ stats: statsData, log: logData }) => {
        if (cancelled) return;
        setStats(statsData);
        setLog(logData);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : '출석 이력을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fromDate, toDate, selectedClassId]);

  function handlePdfExport() {
    setPdfMessage('PDF가 생성되었습니다. (데모 화면이라 실제 다운로드는 운영 연동 후 제공됩니다.)');
  }

  return (
    <>
      <div className={styles.card}>
        <div className={styles.controlRow}>
          <div className={styles.field}>
            <label className={styles.label}>수업 필터</label>
            <select
              className={styles.selectInput}
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
            >
              <option value={CLASS_FILTER_ALL}>{CLASS_FILTER_ALL}</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.rangeCaption}>조회 기간: {monthLabel}</div>
        </div>
      </div>

      {loading && <p className={styles.emptyText}>출석 이력을 불러오는 중입니다...</p>}
      {loadError && !loading && <p className={styles.emptyText}>불러오지 못했습니다: {loadError}</p>}

      {!loading && !loadError && (
        <>
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>학생별 출석 통계</h3>
            {stats.length === 0 ? (
              <p className={styles.emptyText}>해당 기간에 출결 기록이 없습니다.</p>
            ) : (
              <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>학생</th>
                    <th>수업</th>
                    <th>출석</th>
                    <th>지각</th>
                    <th>결석</th>
                    <th>출석률</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((row, i) => (
                    <tr key={i}>
                      <td>{row.studentName}</td>
                      <td>{row.className}</td>
                      <td>{row.present}</td>
                      <td>{row.late}</td>
                      <td>{row.absent}</td>
                      <td>{row.attendanceRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </div>

          <div className={styles.card}>
            <h3 className={styles.cardTitle}>세션별 출석 로그</h3>
            {log.length === 0 ? (
              <p className={styles.emptyText}>해당 기간에 출결 기록이 없습니다.</p>
            ) : (
              <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>학생</th>
                    <th>수업</th>
                    <th>상태</th>
                    <th>비고</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((row, i) => {
                    const tone = toneForStatus(row.status);
                    return (
                      <tr key={i}>
                        <td>
                          {row.date} ({row.weekday})
                        </td>
                        <td>{row.studentName}</td>
                        <td>{row.className}</td>
                        <td>
                          <span
                            className={styles.statusTag}
                            style={{ background: tone.badgeBg, color: tone.badgeColor }}
                          >
                            {STATUS_LABELS[row.status]}
                          </span>
                        </td>
                        <td>{row.note || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </div>
        </>
      )}

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>출석부 내보내기</h3>
        <p className={styles.emptyText}>현재 조회 중인 월 · 수업 필터 기준으로 PDF 초안을 생성합니다.</p>
        <button type="button" className={styles.pdfButton} onClick={handlePdfExport}>
          출석부 인쇄 (PDF)
        </button>
        {pdfMessage && <p className={styles.downloadNotice}>{pdfMessage}</p>}
      </div>
    </>
  );
}
