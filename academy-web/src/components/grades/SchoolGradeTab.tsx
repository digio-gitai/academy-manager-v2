import { useEffect, useState } from 'react';
import { fetchStudents } from '../../lib/students';
import { fetchSchoolGradeHistory, saveSchoolGrade } from '../../lib/grades';
import type { StudentProfile } from '../../types/student';
import {
  GRADE_LEVEL_OPTIONS,
  SEMESTER_OPTIONS,
  SCHOOL_EXAM_KIND_OPTIONS,
  MATH_SUBJECT,
  type SchoolGradeRecord,
} from '../../types/schoolGrades';
import styles from './SchoolGradeTab.module.css';

const YEAR_OPTIONS = [2024, 2025, 2026, 2027];

/**
 * 스트림릿 _render_school_grade_tab() 재현: 학생 먼저 선택 → 연도/학년/학기/
 * 시험종류 선택 → 점수 입력 → 저장(같은 조합이면 덮어쓰기) → 선택 학생의
 * 학교시험 전체 이력 표.
 *
 * 2026-08-26: mock 데이터 → 실제 dev DB(Supabase) 연동. lib/grades.ts의
 * saveSchoolGrade()/fetchSchoolGradeHistory() 사용. 저장 성공 시 이력을 다시 조회.
 */
export function SchoolGradeTab() {
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentsError, setStudentsError] = useState('');
  const [studentId, setStudentId] = useState('');

  const [year, setYear] = useState(2026);
  const [gradeLevel, setGradeLevel] = useState(GRADE_LEVEL_OPTIONS[1]);
  const [semester, setSemester] = useState(SEMESTER_OPTIONS[0]);
  const [examKind, setExamKind] = useState(SCHOOL_EXAM_KIND_OPTIONS[0]);
  const [score, setScore] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  const [history, setHistory] = useState<SchoolGradeRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

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

  function loadHistory(id: string) {
    if (!id) return;
    setHistoryLoading(true);
    setHistoryError('');
    fetchSchoolGradeHistory(id)
      .then(setHistory)
      .catch((err) => setHistoryError(err instanceof Error ? err.message : '이력을 불러오지 못했습니다.'))
      .finally(() => setHistoryLoading(false));
  }

  useEffect(() => {
    loadHistory(studentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  const selectedStudent = students.find((s) => s.id === studentId);

  async function handleSave() {
    if (!studentId) return;
    setSaving(true);
    setSaveMessage('');
    try {
      await saveSchoolGrade({ studentId, schoolYear: year, gradeLevel, semester, examKind, score });
      setSaveMessage(`${MATH_SUBJECT} 성적이 저장되었습니다.`);
      loadHistory(studentId);
    } catch (err) {
      setSaveMessage(err instanceof Error ? `저장 실패: ${err.message}` : '저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  const historyRows = [...history].sort((a, b) => {
    if (a.schoolYear !== b.schoolYear) return b.schoolYear - a.schoolYear;
    return a.semester.localeCompare(b.semester);
  });

  if (studentsLoading) {
    return <p className={styles.emptyText}>학생 목록을 불러오는 중입니다...</p>;
  }
  if (studentsError) {
    return <p className={styles.emptyText}>학생 목록을 불러오지 못했습니다: {studentsError}</p>;
  }

  return (
    <>
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>학교시험 성적관리</h3>
        <p className={styles.caption}>{MATH_SUBJECT} 성적 입력 · 학생을 먼저 선택하세요.</p>

        <div className={styles.field}>
          <label className={styles.label}>학생 선택</label>
          <select
            className={styles.selectInput}
            value={studentId}
            onChange={(e) => {
              setStudentId(e.target.value);
              setSaveMessage('');
            }}
          >
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.className}
              </option>
            ))}
          </select>
        </div>

        <hr className={styles.divider} />

        <div className={styles.gridRow}>
          <div className={styles.field} style={{ marginBottom: 0 }}>
            <label className={styles.label}>연도</label>
            <select className={styles.selectInput} value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field} style={{ marginBottom: 0 }}>
            <label className={styles.label}>학년</label>
            <select className={styles.selectInput} value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)}>
              {GRADE_LEVEL_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field} style={{ marginBottom: 0 }}>
            <label className={styles.label}>학기</label>
            <select className={styles.selectInput} value={semester} onChange={(e) => setSemester(e.target.value)}>
              {SEMESTER_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field} style={{ marginBottom: 0 }}>
            <label className={styles.label}>시험 종류</label>
            <select className={styles.selectInput} value={examKind} onChange={(e) => setExamKind(e.target.value)}>
              {SCHOOL_EXAM_KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.scoreRow}>
          <div className={`${styles.field} ${styles.scoreField}`} style={{ marginBottom: 0 }}>
            <label className={styles.label}>{MATH_SUBJECT} 점수</label>
            <input
              type="number"
              className={styles.numberInput}
              min={0}
              max={100}
              step={0.5}
              value={score}
              onChange={(e) => setScore(Number(e.target.value))}
            />
          </div>
          <button type="button" className={styles.saveButton} onClick={handleSave} disabled={saving || !studentId}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>

        {saveMessage && <p className={styles.successText}>{saveMessage}</p>}
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>{selectedStudent?.name ?? ''} 학생 — 학교시험 전체 성적</h3>
        {historyLoading && <p className={styles.emptyText}>불러오는 중입니다...</p>}
        {historyError && !historyLoading && <p className={styles.emptyText}>불러오지 못했습니다: {historyError}</p>}
        {!historyLoading && !historyError && historyRows.length === 0 && (
          <p className={styles.emptyText}>저장된 학교시험 성적이 없습니다.</p>
        )}
        {!historyLoading && !historyError && historyRows.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>연도</th>
                <th>학년</th>
                <th>학기</th>
                <th>시험종류</th>
                <th>수학 점수</th>
                <th>저장일</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.map((r, i) => (
                <tr key={i}>
                  <td>{r.schoolYear}</td>
                  <td>{r.gradeLevel}</td>
                  <td>{r.semester}</td>
                  <td>{r.examKind}</td>
                  <td>{r.score}점</td>
                  <td>{r.updatedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
