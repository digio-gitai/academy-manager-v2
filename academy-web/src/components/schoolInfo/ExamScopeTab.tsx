import { useEffect, useState } from 'react';
import { SchoolYearPicker } from './SchoolYearPicker';
import { fetchExamScopes, saveExamScope } from '../../lib/schoolInfo';
import { EXAM_SCOPE_TYPES, GRADE_OPTIONS, type ExamScope, type ExamScopeType } from '../../types/schoolInfo';
import styles from './CalendarTab.module.css';

const SLOTS: { semester: number; examType: ExamScopeType }[] = [
  { semester: 1, examType: '중간고사' },
  { semester: 1, examType: '기말고사' },
  { semester: 2, examType: '중간고사' },
  { semester: 2, examType: '기말고사' },
];

function slotKey(semester: number, examType: ExamScopeType): string {
  return `${semester}|${examType}`;
}

/**
 * [2026-09-09] 새 "시험범위" 탭 — 학교·학년·연도별로 1/2학기 중간·기말고사
 * 수학 시험범위를 기록한다. 학사일정(CalendarTab)의 중간고사/기말고사 행에
 * 이 값을 가져다 같이 보여준다(school_exam_scopes를 grade+semester+exam_type로
 * 매칭). 4칸이 항상 고정으로 있고(사용자 요청), 칸마다 저장 버튼이 따로 있어서
 * 일부만 채워도 된다.
 */
export function ExamScopeTab() {
  const [school, setSchool] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [grade, setGrade] = useState('');
  const [scopesByKey, setScopesByKey] = useState<Record<string, ExamScope>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');

  function handlePick(nextSchool: string, nextYear: number) {
    setSchool(nextSchool);
    setYear(nextYear);
  }

  useEffect(() => {
    if (!school || !grade) return;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setSaveError('');
    setSavedKey(null);
    fetchExamScopes(school, grade, year)
      .then((rows) => {
        if (cancelled) return;
        const byKey: Record<string, ExamScope> = {};
        const draftValues: Record<string, string> = {};
        for (const row of rows) {
          const key = slotKey(row.semester, row.examType);
          byKey[key] = row;
          draftValues[key] = row.scope;
        }
        setScopesByKey(byKey);
        setDrafts(draftValues);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : '시험범위를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [school, grade, year]);

  async function handleSaveSlot(semester: number, examType: ExamScopeType) {
    const key = slotKey(semester, examType);
    setSavingKey(key);
    setSaveError('');
    setSavedKey(null);
    try {
      await saveExamScope({
        school,
        grade,
        year,
        semester,
        examType,
        scope: drafts[key] ?? '',
        note: '',
      });
      setSavedKey(key);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.');
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <>
      <p className={styles.caption}>
        학교 · 학년 · 연도별로 1학기/2학기 중간·기말고사의 수학 시험범위를 기록합니다. 학사일정 표에도 함께 표시됩니다.
      </p>

      <div className={styles.card}>
        <SchoolYearPicker onChange={handlePick} />
      </div>

      {!school ? (
        <p className={styles.emptyText}>학교명을 선택하거나 입력해 주세요.</p>
      ) : (
        <div className={styles.card}>
          <div className={styles.field}>
            <label className={styles.label}>학년</label>
            <select className={styles.textInput} value={grade} onChange={(e) => setGrade(e.target.value)}>
              <option value="">학년을 선택하세요</option>
              {GRADE_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>

          {!grade ? (
            <p className={styles.emptyText}>학년을 선택해 주세요.</p>
          ) : loading ? (
            <p className={styles.inlineNotice}>불러오는 중입니다...</p>
          ) : loadError ? (
            <p className={styles.inlineNotice}>시험범위를 불러오지 못했습니다: {loadError}</p>
          ) : (
            <>
              <h4 className={styles.formTitle}>
                🧮 {school} · {grade} · {year}년 수학 시험범위
              </h4>
              {EXAM_SCOPE_TYPES.length > 0 &&
                [1, 2].map((semester) => (
                  <div key={semester} className={styles.gradeGroup}>
                    <h5 className={styles.gradeGroupTitle}>{semester}학기</h5>
                    {SLOTS.filter((s) => s.semester === semester).map(({ examType }) => {
                      const key = slotKey(semester, examType);
                      const existing = scopesByKey[key];
                      return (
                        <div key={key} className={styles.field}>
                          <label className={styles.label}>
                            {semester}학기 {examType}
                            {existing && existing.scope && ' · 저장됨'}
                          </label>
                          <textarea
                            className={styles.textarea}
                            placeholder="예) 다항식의 연산 ~ 인수분해 (교과서 1~3단원)"
                            value={drafts[key] ?? ''}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                          />
                          <div className={styles.buttonRow} style={{ marginTop: 8 }}>
                            <button
                              type="button"
                              className={styles.saveButton}
                              onClick={() => handleSaveSlot(semester, examType)}
                              disabled={savingKey === key}
                            >
                              {savingKey === key ? '저장 중...' : '저장'}
                            </button>
                          </div>
                          {savedKey === key && <p className={styles.successText}>저장했습니다.</p>}
                        </div>
                      );
                    })}
                  </div>
                ))}
              {saveError && <p className={styles.errorText}>{saveError}</p>}
            </>
          )}
        </div>
      )}
    </>
  );
}
