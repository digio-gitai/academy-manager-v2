import type { HomeworkHistoryEntry, HomeworkLevel } from '../../types/student';
import { badgePalette } from '../dashboard/badgePalette';
import styles from './HomeworkHistoryList.module.css';

function toneForLevel(level: HomeworkLevel) {
  if (level === '상') return badgePalette.green;
  if (level === '중') return badgePalette.gold;
  return badgePalette.gray;
}

interface HomeworkHistoryListProps {
  entries: HomeworkHistoryEntry[];
}

/**
 * 과제 인증(사진) 완료율 + 과제 수행도(상/중/하) 기록을 최신순으로 보여줌.
 * 실제 스트림릿의 "과제 수행 이력" 섹션과 같은 목적.
 */
export function HomeworkHistoryList({ entries }: HomeworkHistoryListProps) {
  if (entries.length === 0) {
    return <p className={styles.empty}>아직 과제 수행 기록이 없습니다.</p>;
  }

  return (
    <div>
      {entries.map((entry, i) => {
        const tone = toneForLevel(entry.level);
        return (
          <div key={i} className={styles.row}>
            <span className={styles.date}>{entry.date}</span>
            <span className={styles.note}>{entry.note ?? ''}</span>
            <span className={styles.badge} style={{ background: tone.badgeBg, color: tone.badgeColor }}>
              {entry.level}
            </span>
          </div>
        );
      })}
    </div>
  );
}
