import { useMemo } from 'react';
import styles from './ScoreTrendChart.module.css';

interface ScoreTrendChartProps {
  studentScores: number[];
  classScores: number[];
  lineLabels: string[];
}

const CHART_WIDTH = 300;
const CHART_MIN = 60;
const CHART_MAX = 100;

function toPoints(values: number[]) {
  return values.map((v, i) => {
    const x = (i / (values.length - 1)) * CHART_WIDTH;
    const y = 116 - ((v - CHART_MIN) / (CHART_MAX - CHART_MIN)) * 96;
    return { x, y };
  });
}

export function ScoreTrendChart({ studentScores, classScores, lineLabels }: ScoreTrendChartProps) {
  const studentPoints = useMemo(() => toPoints(studentScores), [studentScores]);
  const classPoints = useMemo(() => toPoints(classScores), [classScores]);

  const studentLine = studentPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const classLine = classPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <div className={styles.card}>
      <div className={styles.titleRow}>
        <span className={styles.title}>최근 8회 점수 추이</span>
      </div>
      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <span className={styles.swatch} data-variant="student" />
          <span className={styles.legendLabel}>지우</span>
        </div>
        <div className={styles.legendItem}>
          <span className={styles.swatch} data-variant="class" />
          <span className={styles.legendLabel}>반 평균</span>
        </div>
      </div>
      <svg viewBox="0 0 300 130" className={styles.svg}>
        <line x1="0" y1="20" x2="300" y2="20" stroke="rgba(31,61,43,0.08)" strokeWidth="1" />
        <line x1="0" y1="60" x2="300" y2="60" stroke="rgba(31,61,43,0.08)" strokeWidth="1" />
        <line x1="0" y1="100" x2="300" y2="100" stroke="rgba(31,61,43,0.08)" strokeWidth="1" />
        <polyline points={classLine} fill="none" stroke="#C9A961" strokeWidth="2" strokeDasharray="4,4" />
        <polyline points={studentLine} fill="none" stroke="#1F3D2B" strokeWidth="2.5" />
        {studentPoints.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="#1F3D2B" />
        ))}
      </svg>
      <div className={styles.axisRow}>
        {lineLabels.map((l) => (
          <span key={l} className={styles.axisLabel}>
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
