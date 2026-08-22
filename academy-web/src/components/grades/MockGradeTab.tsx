import { useState } from 'react';
import { students } from '../../data/mockStudents';
import { initialMockExamGrades } from '../../data/mockMockExamGrades';
import {
  MOCK_GRADE_LEVEL_OPTIONS,
  MOCK_MONTH_OPTIONS,
  mockExamGradeKey,
  type MockExamGradeRecord,
} from '../../types/mockExamGrades';
import { MATH_SUBJECT } from '../../types/schoolGrades';
import styles from './MockGradeTab.module.css';

const YEAR_OPTIONS = [2024, 2025, 2026, 2027];

/**
 * 스트림릿 _render_mock_grade_tab() 재현: 학교시험 탭과 구조는 같고
 * 학기/시험종류 대신 월(3·4·6·9·11월)을 쓰고, 학년 선택지는 고1~3뿐.
 */
export function MockGradeTab() {
  const [records, setRecords] = useState<MockExamGradeRecord[]>(initialMockExamGrades);
  const [studentId, setStudentId] = useState(students[0]?.id ?? '');
  const [year, setYear] = useState(2026);
  const [examMonth, setExamMonth] = useState(MOCK_MONTH_OPTIONS[0]);
  const [gradeLevel, setGradeLevel] = useState(MOCK_GRADE_LEVEL_OPTIONS[0]);
  const [score, setScore] = useState(0);
  const [saveMessage, setSaveMessage] = useState('');

  const selectedStudent = students.find((s) => s.id === studentId);

  function handleSave() {
    const newRecord: MockExamGradeRecord = {
      studentId,
      schoolYear: year,
      gradeLevel,
      examMonth,
      score,
      updatedAt: '방금 저장됨',
    };
    const newKey = mockExamGradeKey(newRecord);
    setRecords((prev) => {
      const exists = prev.some((r) => mockExamGradeKey(r) === newKey);
      if (exists) {
        return prev.map((r) => (mockExamGradeKey(r) === newKey ? newRecord : r));
      }
      return [...prev, newRecord];
    });
    setSaveMessage(`${MATH_SUBJECT} 성적이 저장되었습니다.`);
  }

  const historyRows = records
    .filter((r) => r.studentId === studentId)
    .sort((a, b) => {
      if (a.schoolYear !== b.schoolYear) return b.schoolYear - a.schoolYear;
      return b.examMonth - a.examMonth;
    });

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
          <button type="button" className={styles.saveButton} onClick={handleSave}>
            저장
          </button>
        </div>

        {saveMessage && <p className={styles.successText}>{saveMessage}</p>}
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>{selectedStudent?.name ?? ''} 학생 — 모의고사 전체 성적</h3>
        {historyRows.length === 0 ? (
          <p className={styles.emptyText}>저장된 모의고사 성적이 없습니다.</p>
        ) : (
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
        )}
      </div>
    </>
  );
}
