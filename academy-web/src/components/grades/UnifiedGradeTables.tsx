import type { ExamGroup, UnifiedGradeRecord } from '../../types/grades';
import { EXAM_GROUP_LABELS } from '../../types/grades';
import styles from './UnifiedGradeTables.module.css';

interface UnifiedGradeTablesProps {
  records: UnifiedGradeRecord[];
}

/**
 * 스트림릿 _render_unified_grade_tables(fixed_sections=True)와 동일하게
 * 학교/모의/학원시험 3개 섹션을 항상 고정으로 보여줌(데이터 없으면 안내 문구).
 */
export function UnifiedGradeTables({ records }: UnifiedGradeTablesProps) {
  return (
    <>
      {(['school', 'mock', 'academy'] as ExamGroup[]).map((group) => {
        const rows = records
          .filter((r) => r.examGroup === group)
          .sort((a, b) => (a.examDate < b.examDate ? 1 : -1));
        return (
          <div key={group} className={styles.section}>
            <h4 className={styles.sectionTitle}>{EXAM_GROUP_LABELS[group]}</h4>
            {rows.length === 0 ? (
              <p className={styles.emptyText}>등록된 성적 기록이 없습니다.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>시험</th>
                    <th>수학 점수</th>
                    <th>시험일</th>
                    <th>저장일</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.examLabel}</td>
                      <td>{r.score}점</td>
                      <td>{r.examDate}</td>
                      <td>{r.updatedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </>
  );
}
