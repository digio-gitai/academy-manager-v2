import type { UnifiedGradeRecord } from '../../types/grades';
import styles from './GradeSummaryCards.module.css';

interface GradeSummaryCardsProps {
  studentName: string;
  className: string;
  gradeLevel: string;
  records: UnifiedGradeRecord[];
}

/**
 * 스트림릿 _render_grade_dashboard_summary_cards()와 동일한 3개 카드:
 * 학생 / 학년·반 / 누적 성적(횟수·평균·카테고리별 개수·최근 점수).
 */
export function GradeSummaryCards({ studentName, className, gradeLevel, records }: GradeSummaryCardsProps) {
  const n = records.length;
  const avg = n > 0 ? (records.reduce((sum, r) => sum + r.score, 0) / n).toFixed(1) : null;
  const sorted = [...records].sort((a, b) => (a.examDate < b.examDate ? 1 : -1));
  const latest = sorted[0];

  const schoolN = records.filter((r) => r.examGroup === 'school').length;
  const mockN = records.filter((r) => r.examGroup === 'mock').length;
  const academyN = records.filter((r) => r.examGroup === 'academy').length;

  return (
    <div className={styles.row}>
      <div className={styles.card}>
        <p className={styles.label}>학생</p>
        <p className={styles.value}>{studentName}</p>
        <p className={styles.sub}>Academy Grade Report</p>
      </div>
      <div className={styles.card}>
        <p className={styles.label}>학년 · 반</p>
        <p className={styles.value}>
          {gradeLevel} · {className}
        </p>
        <p className={styles.sub}>현재 배정 기준</p>
      </div>
      <div className={`${styles.card} ${styles.cardAccent}`}>
        <p className={styles.label}>누적 성적</p>
        <p className={styles.value}>
          {n}회 · 평균 {avg ? `${avg}점` : '—'}
        </p>
        <p className={styles.sub}>
          학교 {schoolN} · 모의 {mockN} · 학원 {academyN} · 최근 {latest ? `${latest.score.toFixed(1)}점` : '—'}
        </p>
      </div>
    </div>
  );
}
