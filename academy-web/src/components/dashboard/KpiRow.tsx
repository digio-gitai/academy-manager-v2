import type { DashboardKpi } from '../../types/dashboard';
import styles from './KpiRow.module.css';

interface KpiRowProps {
  kpis: DashboardKpi[];
}

export function KpiRow({ kpis }: KpiRowProps) {
  return (
    <div className={styles.grid}>
      {kpis.map((k) => (
        <div key={k.label} className={styles.card}>
          <div className={styles.labelRow}>
            <span className={styles.dot} data-tone={k.dot} />
            <span className={styles.label}>{k.label}</span>
          </div>
          <div className={styles.valueRow}>
            <span className={styles.value}>{k.value}</span>
            <span className={styles.unit}>{k.unit}</span>
          </div>
          <div className={styles.sub}>{k.sub}</div>
        </div>
      ))}
    </div>
  );
}
