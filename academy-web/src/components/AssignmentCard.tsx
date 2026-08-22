import type { Assignment } from '../types/assignment';
import styles from './AssignmentCard.module.css';

interface AssignmentCardProps {
  assignment: Assignment;
  selected: boolean;
  onSelect: (id: number) => void;
}

export function AssignmentCard({ assignment, selected, onSelect }: AssignmentCardProps) {
  return (
    <div
      className={styles.card}
      data-selected={selected}
      onClick={() => onSelect(assignment.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect(assignment.id);
      }}
    >
      <div className={styles.row}>
        <div>
          <div className={styles.subject}>{assignment.subject}</div>
          <div className={styles.title}>{assignment.title}</div>
          <div className={styles.pageRange}>
            {assignment.pageStart}~{assignment.pageEnd}페이지
          </div>
        </div>
        {selected && (
          <span className={styles.check}>
            <span className={styles.checkMark}>✓</span>
          </span>
        )}
      </div>
    </div>
  );
}
