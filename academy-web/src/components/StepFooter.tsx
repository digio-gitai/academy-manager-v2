import styles from './StepFooter.module.css';

interface StepFooterProps {
  showBack: boolean;
  onBack: () => void;
  primaryLabel: string;
  primaryDisabled: boolean;
  primaryVariant: 'default' | 'accent';
  onPrimaryAction: () => void;
}

export function StepFooter({
  showBack,
  onBack,
  primaryLabel,
  primaryDisabled,
  primaryVariant,
  onPrimaryAction,
}: StepFooterProps) {
  return (
    <div className={styles.footer}>
      {showBack && (
        <button type="button" className={styles.backButton} onClick={onBack} aria-label="이전 단계">
          ←
        </button>
      )}
      <button
        type="button"
        className={styles.primaryButton}
        data-variant={primaryVariant}
        disabled={primaryDisabled}
        onClick={onPrimaryAction}
      >
        {primaryLabel}
      </button>
    </div>
  );
}
