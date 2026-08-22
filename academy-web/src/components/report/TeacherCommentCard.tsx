import type { TeacherComment } from '../../types/report';
import styles from './TeacherCommentCard.module.css';

interface TeacherCommentCardProps {
  comment: TeacherComment;
}

export function TeacherCommentCard({ comment }: TeacherCommentCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.avatar}>
          <span className={styles.avatarInitial}>{comment.initial}</span>
        </div>
        <div>
          <div className={styles.name}>{comment.teacherName}</div>
          <div className={styles.date}>{comment.date}</div>
        </div>
      </div>
      <p className={styles.text}>{comment.text}</p>
    </div>
  );
}
