import type { ReportKpi } from '../../types/report';
import styles from './KpiGrid.module.css';

interface KpiGridProps {
  kpis: ReportKpi[];
}

export function KpiGrid({ kpis }: KpiGridProps) {
  return (
    <div className={styles.grid}>
      {kpis.map((k) => (
        <div key={k.label} className={styles.card}>
          <div className={styles.label}>{k.label}</div>
          <div className={styles.valueRow}>
            <span className={styles.value}>{k.value}</span>
            <span className={styles.unit}>{k.unit}</span>
          </div>
          <div className={styles.delta} style={{ color: k.deltaColor }}>
            {k.delta}
          </div>
        </div>
      ))}
    </div>
  );
}
