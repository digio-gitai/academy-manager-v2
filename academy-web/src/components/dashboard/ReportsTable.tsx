import type { ReportRow } from '../../types/dashboard';
import { toneForReportStatus } from './badgePalette';
import styles from './ReportsTable.module.css';

interface ReportsTableProps {
  reports: ReportRow[];
}

export function ReportsTable({ reports }: ReportsTableProps) {
  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h2 className={styles.title}>최근 발송한 리포트</h2>
        <a href="#" className={styles.link} onClick={(e) => e.preventDefault()}>
          전체 보기
        </a>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.th}>학생</th>
              <th className={styles.th}>반</th>
              <th className={styles.th}>리포트 유형</th>
              <th className={styles.th}>발송일</th>
              <th className={styles.thRight}>상태</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r, i) => {
              const tone = toneForReportStatus(r.status);
              return (
                <tr key={`${r.name}-${i}`}>
                  <td className={styles.tdName}>{r.name}</td>
                  <td className={styles.td}>{r.cls}</td>
                  <td className={styles.td}>{r.type}</td>
                  <td className={styles.td}>{r.date}</td>
                  <td className={styles.tdRight}>
                    <span
                      className={styles.statusBadge}
                      style={{ background: tone.badgeBg, color: tone.badgeColor }}
                    >
                      {r.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
