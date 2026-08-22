import styles from './PasswordField.module.css';

interface PasswordFieldProps {
  value: string;
  onChange: (value: string) => void;
  hidden: boolean;
  onToggleHidden: () => void;
}

export function PasswordField({ value, onChange, hidden, onToggleHidden }: PasswordFieldProps) {
  return (
    <div>
      <label className={styles.label} htmlFor="teacher-password">
        비밀번호
      </label>
      <div className={styles.wrap}>
        <input
          id="teacher-password"
          type={hidden ? 'password' : 'text'}
          placeholder="비밀번호 입력"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={styles.input}
          autoComplete="current-password"
        />
        <button
          type="button"
          onClick={onToggleHidden}
          aria-label="비밀번호 보기 전환"
          className={styles.toggle}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(31,61,43,0.55)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1.5 12S5.2 5.5 12 5.5 22.5 12 22.5 12 18.8 18.5 12 18.5 1.5 12 1.5 12Z" />
            <circle cx="12" cy="12" r="3.2" />
            {hidden && <line x1="3.5" y1="20.5" x2="20.5" y2="3.5" />}
          </svg>
        </button>
      </div>
    </div>
  );
}
