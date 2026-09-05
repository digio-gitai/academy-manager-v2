import { useEffect, useState } from 'react';
import { fetchStudents } from '../../lib/students';
import { fetchMockGradeHistory, saveMockGrade } from '../../lib/grades';
import type { StudentProfile } from '../../types/student';
import {
  MOCK_GRADE_LEVEL_OPTIONS,
  MOCK_MONTH_OPTIONS,
  type MockExamGradeRecord,
} from '../../types/mockExamGrades';
import { MATH_SUBJECT } from '../../types/schoolGrades';
import styles from './MockGradeTab.module.css';

const YEAR_OPTIONS = [2024, 2025, 2026, 2027];

/**
 * 스트림릿 _render_mock_grade_tab() 재현: 학교시험 탭과 구조는 같고
 * 학기/시험종류 대신 월(3·4·6·9·11월)을 쓰고, 학년 선택지는 고1~3뿐.
 *
 * 2026-08-26: mock 데이터 → 실제 dev DB(Supabase) 연동. lib/grades.ts의
 * saveMockGrade()/fetchMockGradeHistory() 사용.
 *
 * ⚠️ 이 화면을 만들다가 external_grade_sessions의 UNIQUE 제약에 exam_month가
 * 빠져 있던 버그를 발견 — 같은 연도+학년으로 다른 달 모의고사를 저장하면 실패할 수
 * 있었음. 사용자 확인 후 dev DB 스키마를 고쳐서 지금은 정상 동작(lib/grades.ts
 * 상단 주석 참고). 운영 DB는 아직 미반영이라 나중에 같은 SQL을 반영해야 함.
 */
export function MockGradeTab() {
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentsError, setStudentsError] = useState('');
  const [studentId, setStudentId] = useState('');

  const [year, setYear] = useState(2026);
  const [examMonth, setExamMonth] = useState(MOCK_MONTH_OPTIONS[0]);
  const [gradeLevel, setGradeLevel] = useState(MOCK_GRADE_LEVEL_OPTIONS[0]);
  const [score, setScore] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  const [history, setHistory] = useState<MockExamGradeRecord[]>([]);
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
    fetchMockGradeHistory(id)
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
      await saveMockGrade({ studentId, schoolYear: year, gradeLevel, examMonth, score });
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
    return b.examMonth - a.examMonth;
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
        <h3 className={styles.cardTitle}>모의고사 성적관리</h3>
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
            <label className={styles.label}>월</label>
            <select
              className={styles.selectInput}
              value={examMonth}
              onChange={(e) => setExamMonth(Number(e.target.value))}
            >
              {MOCK_MONTH_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}월
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field} style={{ marginBottom: 0 }}>
            <label className={styles.label}>학년</label>
            <select className={styles.selectInput} value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)}>
              {MOCK_GRADE_LEVEL_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
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
        <h3 className={styles.cardTitle}>{selectedStudent?.name ?? ''} 학생 — 모의고사 전체 성적</h3>
        {historyLoading && <p className={styles.emptyText}>불러오는 중입니다...</p>}
        {historyError && !historyLoading && <p className={styles.emptyText}>불러오지 못했습니다: {historyError}</p>}
        {!historyLoading && !historyError && historyRows.length === 0 && (
          <p className={styles.emptyText}>저장된 모의고사 성적이 없습니다.</p>
        )}
        {!historyLoading && !historyError && historyRows.length > 0 && (
          <div className={styles.tableWrap}>
              <table className={styles.table}>
            <thead>
              <tr>
                <th>연도</th>
                <th>학년</th>
                <th>월</th>
                <th>수학 점수</th>
                <th>저장일</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.map((r, i) => (
                <tr key={i}>
                  <td>{r.schoolYear}</td>
                  <td>{r.gradeLevel}</td>
                  <td>{r.examMonth}월</td>
                  <td>{r.score}점</td>
                  <td>{r.updatedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
            </div>
        )}
      </div>
    </>
  );
}
