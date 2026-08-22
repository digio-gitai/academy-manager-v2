import type { ClassInfo } from '../../types/dashboard';
import styles from './ClassListCard.module.css';

interface ClassListCardProps {
  classes: ClassInfo[];
}

export function ClassListCard({ classes }: ClassListCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h2 className={styles.title}>반 목록</h2>
        <span className={styles.meta}>전체 {classes.length}개 반</span>
      </div>
      <div className={styles.list}>
        {classes.map((c, i) => (
          <div key={c.name} className={styles.row} data-alt={i % 2 === 0}>
            <div className={styles.rowLeft}>
              <div className={styles.chip} data-today={c.isToday}>
                <span className={styles.chipLabel} data-today={c.isToday}>
                  {c.grade}
                </span>
              </div>
              <div>
                <div className={styles.name}>{c.name}</div>
                <div className={styles.detail}>
                  학생 {c.count}명 · {c.time}
                </div>
              </div>
            </div>
            <span className={styles.badge} data-today={c.isToday}>
              {c.isToday ? '오늘 수업' : '휴강'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
