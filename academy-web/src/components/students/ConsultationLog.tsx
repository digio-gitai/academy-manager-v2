import type { ConsultationEntry } from '../../types/student';
import styles from './ConsultationLog.module.css';

interface ConsultationLogProps {
  entries: ConsultationEntry[];
}

/**
 * 학생 상세 화면 안에서 "상담 일지" 메뉴에 기록된 내용을 모아 보여주는 섹션.
 * 실제 데이터 연동 단계에서는 상담 일지(consultation) 테이블에서
 * 이 학생의 기록만 최신순으로 가져오면 됨.
 */
export function ConsultationLog({ entries }: ConsultationLogProps) {
  if (entries.length === 0) {
    return <p className={styles.empty}>아직 작성된 상담 일지가 없습니다.</p>;
  }

  return (
    <div className={styles.wrap}>
      {entries.map((entry, i) => (
        <div key={i} className={styles.entry}>
          <span className={styles.dot} />
          <div className={styles.body}>
            <div className={styles.date}>{entry.date}</div>
            <div className={styles.content}>{entry.content}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
