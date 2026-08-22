import { useMemo, useState } from 'react';
import type { ClassInfo } from '../../types/classManagement';
import type { AttendanceStatus } from '../../types/attendance';
import { attendanceStats, attendanceLog } from '../../data/mockAttendance';
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
}

/**
 * 스트림릿 page_attendance()의 "출석 이력 및 통계" 탭과 동일한 기능:
 * 학생별 출석 통계 + 세션별 출석 로그 + 출석부 PDF 출력.
 */
export function AttendanceHistoryPanel({ classes, monthLabel }: AttendanceHistoryPanelProps) {
  const [classFilter, setClassFilter] = useState(CLASS_FILTER_ALL);
  const [pdfMessage, setPdfMessage] = useState('');

  const filteredStats = useMemo(
    () => (classFilter === CLASS_FILTER_ALL ? attendanceStats : attendanceStats.filter((s) => s.className === classFilter)),
    [classFilter],
  );
  const filteredLog = useMemo(
    () => (classFilter === CLASS_FILTER_ALL ? attendanceLog : attendanceLog.filter((l) => l.className === classFilter)),
    [classFilter],
  );

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
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.rangeCaption}>조회 기간: {monthLabel}</div>
        </div>
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>학생별 출석 통계</h3>
        {filteredStats.length === 0 ? (
          <p className={styles.emptyText}>해당 기간에 출결 기록이 없습니다.</p>
        ) : (
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
              {filteredStats.map((row, i) => (
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
        )}
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>세션별 출석 로그</h3>
        {filteredLog.length === 0 ? (
          <p className={styles.emptyText}>해당 기간에 출결 기록이 없습니다.</p>
        ) : (
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
              {filteredLog.map((row, i) => {
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
        )}
      </div>

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
