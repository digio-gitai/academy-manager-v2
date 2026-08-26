import { useEffect, useState } from 'react';
import { Tabs } from '../common/Tabs';
import { GradeSummaryCards } from './GradeSummaryCards';
import { UnifiedGradeTables } from './UnifiedGradeTables';
import { GradeTrendChart } from './GradeTrendChart';
import { fetchStudents } from '../../lib/students';
import { fetchUnifiedGrades } from '../../lib/grades';
import type { StudentProfile } from '../../types/student';
import type { UnifiedGradeRecord } from '../../types/grades';
import styles from './GradeViewPanel.module.css';

/**
 * 스트림릿 "성적 조회" 탭(_render_student_grade_view_page) 재현:
 * 히어로 배너 → 학생 선택 → 요약 카드 3개 → (통합 성적표 / 성적 추이 그래프) 내부 탭.
 *
 * 2026-08-26: mock 데이터 → 실제 dev DB(Supabase) 연동. 학생 목록은 lib/students.ts의
 * fetchStudents(), 성적은 lib/grades.ts의 fetchUnifiedGrades()로 조회. '학원시험'
 * 그룹은 AI분석 탭이 아직 없어 항상 빈 상태(lib/grades.ts 주석 참고).
 */
export function GradeViewPanel() {
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentsError, setStudentsError] = useState('');
  const [studentId, setStudentId] = useState('');

  const [records, setRecords] = useState<UnifiedGradeRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchStudents()
      .then((data) => {
        if (cancelled) return;
        setStudents(data);
        setStudentId((prev) => prev || data[0]?.id || '');
      })
      .catch((err) => {
        if (cancelled) return;
        setStudentsError(err instanceof Error ? err.message : '학생 목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setStudentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!studentId) return;
    let cancelled = false;
    setRecordsLoading(true);
    setRecordsError('');
    fetchUnifiedGrades(studentId)
      .then((data) => {
        if (cancelled) return;
        setRecords(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setRecordsError(err instanceof Error ? err.message : '성적 기록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setRecordsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  const selected = students.find((s) => s.id === studentId);

  if (studentsLoading) {
    return <p className={styles.emptyText}>학생 목록을 불러오는 중입니다...</p>;
  }
  if (studentsError) {
    return <p className={styles.emptyText}>학생 목록을 불러오지 못했습니다: {studentsError}</p>;
  }
  if (!selected) {
    return <p className={styles.emptyText}>등록된 학생이 없습니다.</p>;
  }

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

      {recordsLoading && <p className={styles.emptyText}>성적 기록을 불러오는 중입니다...</p>}
      {recordsError && !recordsLoading && (
        <p className={styles.emptyText}>성적 기록을 불러오지 못했습니다: {recordsError}</p>
      )}

      {!recordsLoading && !recordsError && (
        <>
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
      )}
    </>
  );
}
