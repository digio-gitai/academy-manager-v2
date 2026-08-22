import { useState } from 'react';
import type { ClassInfo } from '../../types/classManagement';
import type { HwAssignment, HwItem, HwSubmission } from '../../types/homework';
import styles from './IncompleteStudentsPanel.module.css';

interface IncompleteStudentsPanelProps {
  classInfo: ClassInfo;
  assignments: HwAssignment[];
  items: HwItem[];
  submissions: HwSubmission[];
}

/**
 * 스트림릿 render_incomplete_students_section() 재현: 미완료 항목이 있는
 * 학생만 모아서 보여주고, 펼치면 과제별 · 항목별 완료 현황을 확인할 수 있음.
 * 페이지 범위형은 진행률 막대, 오답정리형은 완료/미완료 캡션으로 표시(원본과 동일).
 */
export function IncompleteStudentsPanel({ classInfo, assignments, items, submissions }: IncompleteStudentsPanelProps) {
  const [openStudentId, setOpenStudentId] = useState<string | null>(null);

  const studentsWithIncomplete = classInfo.students.filter((s) =>
    submissions.some((sub) => sub.studentId === s.id && sub.itemStates.some((st) => st.status === 'incomplete')),
  );

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>미완료 학생</h3>

      {studentsWithIncomplete.length === 0 ? (
        <p className={styles.emptyText}>현재 미완료 항목이 있는 학생이 없습니다.</p>
      ) : (
        studentsWithIncomplete.map((s) => {
          const isOpen = openStudentId === s.id;
          const studentSubs = submissions.filter((sub) => sub.studentId === s.id);

          return (
            <div key={s.id} className={styles.studentBlock}>
              <button type="button" className={styles.studentToggle} onClick={() => setOpenStudentId(isOpen ? null : s.id)}>
                {isOpen ? '▾' : '▸'} {s.name}
              </button>

              {isOpen &&
                studentSubs.map((sub) => {
                  const assignment = assignments.find((a) => a.id === sub.assignmentId);
                  if (!assignment) return null;
                  const assignmentItems = items.filter(
                    (it) => it.assignmentId === assignment.id && (!it.studentId || it.studentId === s.id),
                  );

                  return (
                    <div key={sub.id} className={styles.assignmentBlock}>
                      <div className={styles.assignmentDate}>{assignment.assignedDate} 부여 과제</div>
                      {assignmentItems.map((item) => {
                        const state = sub.itemStates.find((st) => st.itemId === item.id);
                        if (item.itemType === 'page_range') {
                          const start = item.pageStart ?? 0;
                          const end = item.pageEnd ?? 0;
                          const total = Math.max(end - start + 1, 1);
                          const done = state?.completedPages.length ?? 0;
                          const percent = Math.min(100, Math.round((done / total) * 100));
                          return (
                            <div key={item.id} className={styles.itemRow}>
                              <div className={styles.itemLabel}>
                                {item.materialName} ({start}~{end}p)
                              </div>
                              <div className={styles.progressBarOuter}>
                                <div className={styles.progressBarInner} style={{ width: `${percent}%` }} />
                              </div>
                              <div className={styles.progressText}>
                                {done}/{total}p ({percent}%)
                                {state?.status === 'incomplete' && ' · 미완료'}
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div key={item.id} className={styles.itemRow}>
                            <div className={styles.itemLabel}>{item.materialName} (오답정리)</div>
                            <div className={styles.wrongNoteStatus} data-done={state?.status === 'done'}>
                              {state?.status === 'done' ? '완료' : '미완료'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
            </div>
          );
        })
      )}
    </div>
  );
}
