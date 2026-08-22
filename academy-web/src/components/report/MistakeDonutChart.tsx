import { useMemo } from 'react';
import type { MistakeSegment } from '../../types/report';
import styles from './MistakeDonutChart.module.css';

interface MistakeDonutChartProps {
  segments: MistakeSegment[];
  accuracyPct: number;
}

export function MistakeDonutChart({ segments, accuracyPct }: MistakeDonutChartProps) {
  const gradient = useMemo(() => {
    let acc = 0;
    const stops = segments.map((s) => {
      const start = acc;
      acc += s.pct;
      return `${s.color} ${start}% ${acc}%`;
    });
    return `conic-gradient(${stops.join(', ')})`;
  }, [segments]);

  return (
    <div className={styles.card}>
      <span className={styles.title}>문제유형별 오답 분포</span>
      <div className={styles.row}>
        <div className={styles.donut} style={{ background: gradient }}>
          <div className={styles.donutHole}>
            <span className={styles.donutPct}>{accuracyPct}%</span>
            <span className={styles.donutLabel}>정답률</span>
          </div>
        </div>
        <div className={styles.legend}>
          {segments.map((g) => (
            <div key={g.label} className={styles.legendRow}>
              <div className={styles.legendKey}>
                <span className={styles.dot} style={{ background: g.color }} />
                <span className={styles.legendLabel}>{g.label}</span>
              </div>
              <span className={styles.legendPct}>{g.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
