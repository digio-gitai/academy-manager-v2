import { useMemo } from 'react';
import type { HomeworkStudent } from '../../types/dashboard';
import { toneForHomeworkStatus } from './badgePalette';
import styles from './HomeworkStatusCard.module.css';

interface HomeworkStatusCardProps {
  students: HomeworkStudent[];
}

export function HomeworkStatusCard({ students }: HomeworkStatusCardProps) {
  const { done, prog, todo, donePct, progPct, todoPct } = useMemo(() => {
    const done = students.filter((s) => s.status === '완료').length;
    const prog = students.filter((s) => s.status === '진행중').length;
    const todo = students.length - done - prog;
    const pct = (n: number) => Math.round((n / students.length) * 100);
    return { done, prog, todo, donePct: pct(done), progPct: pct(prog), todoPct: pct(todo) };
  }, [students]);

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h2 className={styles.title}>오늘 과제 인증 현황</h2>
        <span className={styles.meta}>
          완료 {done} · 진행중 {prog} · 미완료 {todo}
        </span>
      </div>
      <div className={styles.progressTrack}>
        <div className={styles.progressDone} style={{ width: `${donePct}%` }} />
        <div className={styles.progressProg} style={{ width: `${progPct}%` }} />
        <div className={styles.progressTodo} style={{ width: `${todoPct}%` }} />
      </div>
      <div className={styles.studentGrid}>
        {students.map((s) => {
          const tone = toneForHomeworkStatus(s.status);
          return (
            <div key={s.name} className={styles.studentRow}>
              <div className={styles.studentInfo}>
                <div className={styles.studentName}>{s.name}</div>
                <div className={styles.studentClass}>{s.cls}</div>
              </div>
              <span
                className={styles.statusBadge}
                style={{ background: tone.badgeBg, color: tone.badgeColor }}
              >
                <span className={styles.statusDot} style={{ background: tone.dotColor }} />
                {s.status}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
