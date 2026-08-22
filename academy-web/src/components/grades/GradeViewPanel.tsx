import { useState } from 'react';
import { Tabs } from '../common/Tabs';
import { GradeSummaryCards } from './GradeSummaryCards';
import { UnifiedGradeTables } from './UnifiedGradeTables';
import { GradeTrendChart } from './GradeTrendChart';
import { students } from '../../data/mockStudents';
import { getGradesForStudent } from '../../data/mockGrades';
import styles from './GradeViewPanel.module.css';

/**
 * 스트림릿 "성적 조회" 탭(_render_student_grade_view_page) 재현:
 * 히어로 배너 → 학생 선택 → 요약 카드 3개 → (통합 성적표 / 성적 추이 그래프) 내부 탭.
 */
export function GradeViewPanel() {
  const [studentId, setStudentId] = useState(students[0]?.id ?? '');
  const selected = students.find((s) => s.id === studentId);

  if (!selected) {
    return <p className={styles.emptyText}>등록된 학생이 없습니다.</p>;
  }

  const records = getGradesForStudent(selected.id);

  return (
    <>
      <div className={styles.hero}>
        <h2 className={styles.heroTitle}>Math Management</h2>
        <p className={styles.heroSub}>학교 · 모의 · 학원시험 성적을 한눈에 확인합니다.</p>
      </div>

      <div className={styles.selectRow}>
        <label className={styles.label}>학생 선택</label>
        <select className={styles.selectInput} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.className}
            </option>
          ))}
        </select>
      </div>

      <GradeSummaryCards
        studentName={selected.name}
        className={selected.className}
        gradeLevel={selected.grade}
        records={records}
      />

      <Tabs
        tabs={[
          { key: 'table', label: '통합 성적표', content: <UnifiedGradeTables records={records} /> },
          { key: 'chart', label: '성적 추이 그래프', content: <GradeTrendChart records={records} /> },
        ]}
      />
    </>
  );
}
