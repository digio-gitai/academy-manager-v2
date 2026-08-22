import type { StudentProfile } from '../../types/student';
import styles from './StudentListItem.module.css';

interface StudentListItemProps {
  student: StudentProfile;
  active: boolean;
  onSelect: () => void;
}

export function StudentListItem({ student, active, onSelect }: StudentListItemProps) {
  return (
    <button type="button" className={styles.item} data-active={active} onClick={onSelect}>
      <div className={styles.avatar}>
        <span className={styles.avatarInitial}>{student.initial}</span>
      </div>
      <div className={styles.info}>
        <div className={styles.name}>{student.name}</div>
        <div className={styles.meta}>{student.className}</div>
      </div>
    </button>
  );
}
