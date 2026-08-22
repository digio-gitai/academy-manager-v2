import type { ExamGroup, UnifiedGradeRecord } from '../../types/grades';
import { EXAM_GROUP_LABELS } from '../../types/grades';
import styles from './ExamSelectionChecklist.module.css';

interface ExamSelectionChecklistProps {
  records: UnifiedGradeRecord[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}

/**
 * 스트림릿 _collect_report_exam_selection() 재현: 카테고리별로 시험 체크박스
 * (기본 전체 선택)를 보여주고, 체크된 시험만 보고서에 포함시킴.
 */
export function ExamSelectionChecklist({ records, selectedIds, onToggle }: ExamSelectionChecklistProps) {
  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>보고서에 포함할 시험</h3>
      <p className={styles.caption}>카테고리별로 시험을 선택하세요.</p>

      {(['school', 'mock', 'academy'] as ExamGroup[]).map((group) => {
        const rows = records.filter((r) => r.examGroup === group);
        return (
          <div key={group} className={styles.group}>
            <p className={styles.groupTitle}>{EXAM_GROUP_LABELS[group]}</p>
            {rows.length === 0 ? (
              <p className={styles.emptyText}>선택할 시험이 없습니다.</p>
            ) : (
              rows.map((r) => (
                <label key={r.id} className={styles.checkRow}>
                  <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => onToggle(r.id)} />
                  {r.examLabel} · {r.score.toFixed(1)}점 ({r.examDate})
                </label>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}
