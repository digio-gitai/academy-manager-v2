import { useMemo, useState } from 'react';
import { students } from '../../data/mockStudents';
import { getGradesForStudent } from '../../data/mockGrades';
import { ExamSelectionChecklist } from './ExamSelectionChecklist';
import { ExamComparisonChart } from './ExamComparisonChart';
import { ParentCommentPanel } from './ParentCommentPanel';
import { IntegratedReportSection } from './IntegratedReportSection';
import styles from './ReportWritePanel.module.css';

function generateParentCommentFallback(studentName: string, avg: number): string {
  // 실제 앱의 _generate_parent_comment_ai() except 분기(AI 호출 실패 시 대체 문구)와 동일한 템플릿.
  return (
    `${studentName} 학생은 이번 시험에서 평균 ${avg.toFixed(1)}점을 기록하였습니다. ` +
    '전반적인 개념 이해도는 양호하나 응용 문제에서 보완이 필요합니다. ' +
    '앞으로 취약 단원 집중 훈련과 서술형 풀이 연습을 강화하겠습니다.'
  );
}

/**
 * 스트림릿 _render_student_report_write_panel() 재현: 학생 선택 → 시험
 * 선택 체크박스 → 시험별 비교 막대그래프 → 학부모님께 전하는 글(AI 초안) →
 * 통합보고서 생성(현재는 '학원시험 AI분석' 탭 의존이라 안내만 표시).
 */
export function ReportWritePanel() {
  const [studentId, setStudentId] = useState(students[0]?.id ?? '');
  const allRecords = useMemo(() => getGradesForStudent(studentId), [studentId]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(allRecords.map((r) => r.id)));
  const [comment, setComment] = useState('');

  const selected = students.find((s) => s.id === studentId);
  const selectedRecords = allRecords.filter((r) => selectedIds.has(r.id));

  function handleStudentChange(id: string) {
    setStudentId(id);
    const records = getGradesForStudent(id);
    setSelectedIds(new Set(records.map((r) => r.id)));
    setComment('');
  }

  function toggleExam(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleGenerateComment() {
    if (!selected || selectedRecords.length === 0) return;
    const avg = selectedRecords.reduce((sum, r) => sum + r.score, 0) / selectedRecords.length;
    setComment(generateParentCommentFallback(selected.name, avg));
  }

  if (!selected) {
    return <p className={styles.emptyText}>등록된 학생이 없습니다.</p>;
  }

  if (allRecords.length === 0) {
    return (
      <>
        <div className={styles.selectRow}>
          <label className={styles.label}>학생 선택</label>
          <select
            className={styles.selectInput}
            value={studentId}
            onChange={(e) => handleStudentChange(e.target.value)}
          >
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.className}
              </option>
            ))}
          </select>
        </div>
        <p className={styles.emptyText}>이 학생의 통합 성적 기록이 없습니다. 성적을 먼저 등록해 주세요.</p>
      </>
    );
  }

  return (
    <>
      <div className={styles.selectRow}>
        <label className={styles.label}>학생 선택</label>
        <select className={styles.selectInput} value={studentId} onChange={(e) => handleStudentChange(e.target.value)}>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.className}
            </option>
          ))}
        </select>
      </div>

      <ExamSelectionChecklist records={allRecords} selectedIds={selectedIds} onToggle={toggleExam} />

      {selectedRecords.length === 0 ? (
        <p className={styles.emptyText}>시험을 하나 이상 선택해 주세요.</p>
      ) : (
        <>
          <ExamComparisonChart studentName={selected.name} records={selectedRecords} />
          <ParentCommentPanel
            studentName={selected.name}
            records={selectedRecords}
            comment={comment}
            onCommentChange={setComment}
            onGenerate={handleGenerateComment}
          />
          <IntegratedReportSection />
        </>
      )}
    </>
  );
}
