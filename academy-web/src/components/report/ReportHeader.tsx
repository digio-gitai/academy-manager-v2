import styles from './ReportHeader.module.css';

interface ReportHeaderProps {
  weekLabel: string;
  studentName: string;
  subjectLine: string;
}

export function ReportHeader({ weekLabel, studentName, subjectLine }: ReportHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.row}>
        <span className={styles.logo}>J MATH</span>
        <span className={styles.week}>{weekLabel}</span>
      </div>
      <h1 className={styles.title}>{studentName}</h1>
      <p className={styles.subtitle}>{subjectLine}</p>
    </div>
  );
}
