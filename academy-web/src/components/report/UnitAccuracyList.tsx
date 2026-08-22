import type { UnitAccuracy } from '../../types/report';
import styles from './UnitAccuracyList.module.css';

interface UnitAccuracyListProps {
  units: UnitAccuracy[];
}

export function UnitAccuracyList({ units }: UnitAccuracyListProps) {
  return (
    <div className={styles.card}>
      <span className={styles.title}>단원별 정답률</span>
      <div className={styles.list}>
        {units.map((u) => (
          <div key={u.name}>
            <div className={styles.row}>
              <span className={styles.name}>{u.name}</span>
              <span className={styles.pct}>{u.pct}%</span>
            </div>
            <div className={styles.track}>
              <div className={styles.fill} style={{ width: `${u.pct}%`, background: u.color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
