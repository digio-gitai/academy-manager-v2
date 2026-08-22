import styles from './PageChecklist.module.css';

interface PageChecklistProps {
  pageStart: number;
  pageEnd: number;
  checkedPages: Record<number, boolean>;
  onTogglePage: (page: number) => void;
}

export function PageChecklist({ pageStart, pageEnd, checkedPages, onTogglePage }: PageChecklistProps) {
  const pages = [];
  for (let n = pageStart; n <= pageEnd; n++) pages.push(n);

  return (
    <div className={styles.list}>
      {pages.map((num) => {
        const checked = !!checkedPages[num];
        return (
          <div
            key={num}
            className={styles.item}
            data-checked={checked}
            onClick={() => onTogglePage(num)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onTogglePage(num);
            }}
          >
            <div className={styles.box} data-checked={checked}>
              {checked && <span className={styles.mark}>✓</span>}
            </div>
            <span className={styles.label}>{num}페이지</span>
          </div>
        );
      })}
    </div>
  );
}
