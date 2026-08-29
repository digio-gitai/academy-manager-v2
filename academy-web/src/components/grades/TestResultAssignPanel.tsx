import { useEffect, useState } from 'react';
import { fetchClasses } from '../../lib/classManagement';
import type { ClassInfo, ClassStudentInfo } from '../../types/classManagement';
import {
  fetchExistingTestResults,
  saveStudentTestResult,
  computeScoreFromWrong,
} from '../../lib/testResults';
import type { StudentTestResult } from '../../lib/testResults';
import styles from './AiTestOcrPanel.module.css';
import panelStyles from './TestResultAssignPanel.module.css';

/** catch(err)를 사람이 읽을 수 있는 문장으로 — AiTestOcrPanel.tsx의 동일 헬퍼와 같은 목적. */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [e.message, e.details, e.hint].filter(
      (v): v is string => typeof v === 'string' && v.trim() !== '',
    );
    if (parts.length > 0) {
      return parts.join(' — ') + (e.code ? ` (code: ${String(e.code)})` : '');
    }
  }
  return String(err);
}

interface StudentEntry {
  className: string;
  student: ClassStudentInfo;
}

interface StudentUiState {
  included: boolean;
  wrong: Set<number>;
}

interface Props {
  testId: number;
  testName: string;
  totalQuestions: number;
  /** 편집 화면(2단계)에 있던 문항번호 중 숫자로 된 것만(오답 체크박스용). */
  questionNumbers: number[];
}

/**
 * "학원시험 AI분석" 4단계 계획 중 3단계 — 확정된 TEST(testId)에 반/학생을
 * 배정하고, 학생별로 틀린 문항 번호를 체크해서 student_results에 저장하는
 * 화면. 스트림릿의 _render_ocr_class_student_picker() / save_student_result()와
 * 동일한 방식(반 여러 개 동시 선택 → 학생별로 펼쳐서 오답 체크 → "전원 일괄
 * 저장" 한 번에 처리, 점수는 (총문항-오답)/총문항*100으로 자동 계산).
 *
 * 원본과 다른 점: 스트림릿은 st.form으로 체크박스 입력 중 화면이 재실행되지
 * 않게 최적화했지만, React는 컴포넌트 리렌더 자체가 가볍기 때문에 별도
 * form 없이 그냥 state로 처리 — 동작은 동일함.
 */
export function TestResultAssignPanel({ testId, testName, totalQuestions, questionNumbers }: Props) {
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [classesError, setClassesError] = useState('');

  const [existingResults, setExistingResults] = useState<Map<string, StudentTestResult>>(new Map());
  const [resultsLoading, setResultsLoading] = useState(true);
  const [resultsError, setResultsError] = useState('');

  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(new Set());
  const [studentState, setStudentState] = useState<Map<string, StudentUiState>>(new Map());

  const [saving, setSaving] = useState(false);
  const [saveSummary, setSaveSummary] = useState<{ success: number; fail: number; failNames: string[] } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    setClassesLoading(true);
    setClassesError('');
    fetchClasses()
      .then((list) => {
        if (cancelled) return;
        setClasses(list);
        if (list.length > 0) {
          setSelectedClassIds(new Set([list[0].id]));
        }
      })
      .catch((err) => {
        if (!cancelled) setClassesError(describeError(err));
      })
      .finally(() => {
        if (!cancelled) setClassesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setResultsLoading(true);
    setResultsError('');
    setSaveSummary(null);
    fetchExistingTestResults(testId)
      .then((map) => {
        if (cancelled) return;
        setExistingResults(map);
        // 기존 저장 기록을 체크박스 초기값으로 채움(이미 초기화된 학생은 건드리지 않음 —
        // 사용자가 화면에서 이미 고친 체크 상태를 되돌리지 않기 위함).
        setStudentState((prev) => {
          const next = new Map(prev);
          for (const [sid, result] of map) {
            if (!next.has(sid)) {
              next.set(sid, { included: true, wrong: new Set(result.wrongNumbers) });
            }
          }
          return next;
        });
      })
      .catch((err) => {
        if (!cancelled) setResultsError(describeError(err));
      })
      .finally(() => {
        if (!cancelled) setResultsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [testId]);

  function toggleClass(classId: string) {
    setSelectedClassIds((prev) => {
      const next = new Set(prev);
      if (next.has(classId)) next.delete(classId);
      else next.add(classId);
      return next;
    });
  }

  function getStudentState(studentId: string): StudentUiState {
    return studentState.get(studentId) ?? { included: true, wrong: new Set<number>() };
  }

  function setIncluded(studentId: string, included: boolean) {
    setStudentState((prev) => {
      const next = new Map(prev);
      const cur = getStudentState(studentId);
      next.set(studentId, { ...cur, included });
      return next;
    });
  }

  function toggleWrong(studentId: string, num: number) {
    setStudentState((prev) => {
      const next = new Map(prev);
      const cur = getStudentState(studentId);
      const wrong = new Set(cur.wrong);
      if (wrong.has(num)) wrong.delete(num);
      else wrong.add(num);
      next.set(studentId, { ...cur, wrong });
      return next;
    });
  }

  const entries: StudentEntry[] = [];
  for (const cls of classes) {
    if (!selectedClassIds.has(cls.id)) continue;
    for (const student of cls.students) {
      entries.push({ className: cls.name, student });
    }
  }

  async function handleSaveAll() {
    setSaving(true);
    setSaveSummary(null);
    let success = 0;
    const failNames: string[] = [];
    for (const { student } of entries) {
      const state = getStudentState(student.id);
      if (!state.included) continue;
      try {
        const result = await saveStudentTestResult({
          studentId: student.id,
          testId,
          totalQuestions,
          wrongNumbers: state.wrong,
        });
        setExistingResults((prev) => new Map(prev).set(student.id, result));
        success += 1;
      } catch {
        failNames.push(student.name);
      }
    }
    setSaving(false);
    setSaveSummary({ success, fail: failNames.length, failNames });
  }

  if (classesLoading || resultsLoading) {
    return (
      <div className={styles.analyzeSection}>
        <span className={styles.badge}>반/학생 배정 · 오답 체크</span>
        <p className={styles.caption}>불러오는 중...</p>
      </div>
    );
  }

  if (classesError) {
    return (
      <div className={styles.analyzeSection}>
        <span className={styles.badge}>반/학생 배정 · 오답 체크</span>
        <p className={styles.errorText}>{classesError}</p>
      </div>
    );
  }

  if (classes.length === 0) {
    return (
      <div className={styles.analyzeSection}>
        <span className={styles.badge}>반/학생 배정 · 오답 체크</span>
        <p className={styles.caption}>등록된 반이 없습니다. "내 수업 관리"에서 반을 먼저 만들어 주세요.</p>
      </div>
    );
  }

  return (
    <div className={styles.analyzeSection}>
      <span className={styles.badge}>반/학생 배정 · 오답 체크</span>
      <h3 className={styles.cardTitle}>👥 학생별 오답 체크 → 점수 저장</h3>
      <p className={styles.caption}>
        확정 TEST: <strong>{testName}</strong> · {totalQuestions}문항. 반을 선택하면 그 반 학생들이 아래
        목록에 나타나요. 학생을 펼쳐서 틀린 문항 번호를 체크한 뒤, 맨 아래 "전원 오답 일괄 저장"을 누르면
        점수가 자동 계산되어 저장됩니다.
      </p>
      {resultsError && <p className={styles.errorText}>{resultsError}</p>}

      <p className={styles.fieldLabel}>① 반 선택 (여러 반 동시 선택 가능)</p>
      <div className={panelStyles.classChips}>
        {classes.map((cls) => (
          <button
            key={cls.id}
            type="button"
            className={`${panelStyles.classChip} ${selectedClassIds.has(cls.id) ? panelStyles.classChipActive : ''}`}
            onClick={() => toggleClass(cls.id)}
          >
            {cls.name} ({cls.students.length}명)
          </button>
        ))}
      </div>

      {entries.length === 0 ? (
        <p className={styles.caption} style={{ marginTop: 12 }}>
          선택한 반에 학생이 없습니다.
        </p>
      ) : (
        <>
          <p className={styles.fieldLabel} style={{ marginTop: 16 }}>
            ② 학생별 오답 체크 — 총 {entries.length}명
          </p>
          <div className={panelStyles.studentList}>
            {entries.map(({ className, student }) => {
              const state = getStudentState(student.id);
              const existing = existingResults.get(student.id);
              const previewScore = computeScoreFromWrong(totalQuestions, state.wrong);
              return (
                <details key={student.id} className={panelStyles.studentDetails}>
                  <summary className={panelStyles.studentSummary}>
                    <span>
                      {className} · {student.name}
                    </span>
                    <span className={existing ? panelStyles.statusSaved : panelStyles.statusUnsaved}>
                      {existing
                        ? `✅ 저장됨 · ${existing.score.toFixed(1)}점 (오답 ${existing.wrongCount}개)`
                        : '⬜ 미저장'}
                    </span>
                  </summary>
                  <div className={panelStyles.studentBody}>
                    <label className={panelStyles.includeLabel}>
                      <input
                        type="checkbox"
                        checked={state.included}
                        onChange={(e) => setIncluded(student.id, e.target.checked)}
                      />
                      이 학생 시험 봤음 (저장 포함)
                    </label>
                    <div className={panelStyles.wrongGrid}>
                      {questionNumbers.map((num) => (
                        <label key={num} className={panelStyles.wrongCheckLabel}>
                          <input
                            type="checkbox"
                            checked={state.wrong.has(num)}
                            onChange={() => toggleWrong(student.id, num)}
                          />
                          {num}번
                        </label>
                      ))}
                    </div>
                    <p className={panelStyles.previewText}>
                      현재 체크: 오답 {state.wrong.size}개 → 예상 {previewScore.toFixed(1)}점
                    </p>
                  </div>
                </details>
              );
            })}
          </div>

          <button
            type="button"
            className={styles.extractButton}
            style={{ marginTop: 14 }}
            onClick={handleSaveAll}
            disabled={saving}
          >
            {saving ? '저장 중...' : '💾 전원 오답 일괄 저장'}
          </button>

          {saveSummary && (
            <p className={saveSummary.fail > 0 ? styles.errorText : styles.successText}>
              {saveSummary.success}명 저장 완료
              {saveSummary.fail > 0 && ` · ${saveSummary.fail}명 실패 (${saveSummary.failNames.join(', ')})`}
            </p>
          )}
        </>
      )}
    </div>
  );
}
