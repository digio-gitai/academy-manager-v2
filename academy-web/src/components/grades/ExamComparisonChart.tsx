import type { UnifiedGradeRecord } from '../../types/grades';
import styles from './ExamComparisonChart.module.css';

interface ExamComparisonChartProps {
  studentName: string;
  records: UnifiedGradeRecord[];
}

/**
 * 스트림릿 _render_exam_comparison_chart() 재현: 선택된 시험들의 정답률/오답률을
 * 가로 누적 막대로 비교. 원본은 Plotly, 여기선 순수 CSS flex 막대로 구현.
 */
export function ExamComparisonChart({ studentName, records }: ExamComparisonChartProps) {
  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>시험별 성적 비교</h3>
      <p className={styles.subTitle}>{studentName} — 시험별 정답률 비교</p>

      {records.length === 0 ? (
        <p className={styles.emptyText}>비교할 시험이 없습니다.</p>
      ) : (
        <>
          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: '#2563eb' }} />
              정답률
            </span>
            <span className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: '#e2e8f0' }} />
              오답률
            </span>
          </div>
          {records.map((r) => {
            const correct = Math.min(r.score, 100);
            const wrong = Math.max(0, 100 - correct);
            return (
              <div key={r.id} className={styles.row}>
                <span className={styles.rowLabel}>{r.examLabel}</span>
                <div className={styles.barTrack}>
                  <div className={styles.correctSeg} style={{ width: `${correct}%` }}>
                    {correct >= 12 ? `${correct.toFixed(1)}%` : ''}
                  </div>
                  <div className={styles.wrongSeg} style={{ width: `${wrong}%` }}>
                    {wrong >= 12 ? `${wrong.toFixed(1)}%` : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
