import styles from './StepHeader.module.css';

interface StepHeaderProps {
  step: number;
  totalSteps: number;
  stepLabel: string;
}

export function StepHeader({ step, totalSteps, stepLabel }: StepHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.row}>
        <span className={styles.logo}>J MATH</span>
        <span className={styles.stepLabel}>
          {step} / {totalSteps} · {stepLabel}
        </span>
      </div>
      <div className={styles.progress}>
        {Array.from({ length: totalSteps }, (_, i) => i + 1).map((n) => (
          <div key={n} className={styles.bar} data-filled={n <= step} />
        ))}
      </div>
    </div>
  );
}
