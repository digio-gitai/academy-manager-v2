import styles from './RememberToggle.module.css';

interface RememberToggleProps {
  checked: boolean;
  onToggle: () => void;
}

export function RememberToggle({ checked, onToggle }: RememberToggleProps) {
  return (
    <div
      className={styles.row}
      onClick={onToggle}
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onToggle();
      }}
    >
      <div className={styles.box} data-checked={checked}>
        {checked && <span className={styles.check}>✓</span>}
      </div>
      <span className={styles.label}>로그인 상태 유지</span>
    </div>
  );
}
