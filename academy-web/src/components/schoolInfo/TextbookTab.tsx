import { useMemo, useState } from 'react';
import { SchoolYearPicker } from './SchoolYearPicker';
import { initialTextbooks } from '../../data/mockSchoolInfo';
import { GRADE_OPTIONS, type Textbook } from '../../types/schoolInfo';
import styles from './CalendarTab.module.css';

interface FormState {
  grades: string[];
  textbookName: string;
  publisher: string;
  note: string;
}

function emptyForm(): FormState {
  return { grades: [], textbookName: '', publisher: '', note: '' };
}

/**
 * 스트림릿 _render_textbook_tab() 재현: 학교+연도 선택 → 학년(복수 선택)별
 * 교과서명·출판사 등록 → 학년별로 묶어서 목록 표시, 항목별 수정/삭제.
 */
export function TextbookTab() {
  const [school, setSchool] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [textbooks, setTextbooks] = useState<Textbook[]>(initialTextbooks);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const editingTextbook = editId ? textbooks.find((t) => t.id === editId) : undefined;

  const scopedTextbooks = useMemo(
    () => textbooks.filter((t) => t.school === school && t.year === year),
    [textbooks, school, year],
  );

  function handlePick(nextSchool: string, nextYear: number) {
    setSchool(nextSchool);
    setYear(nextYear);
    setError('');
    setMessage('');
  }

  function startEdit(tb: Textbook) {
    setEditId(tb.id);
    setForm({ grades: [tb.grade], textbookName: tb.textbookName, publisher: tb.publisher, note: tb.note });
    setError('');
    setMessage('');
  }

  function cancelEdit() {
    setEditId(null);
    setForm(emptyForm());
    setError('');
  }

  function toggleGrade(g: string) {
    if (editId) return;
    setForm((prev) => ({
      ...prev,
      grades: prev.grades.includes(g) ? prev.grades.filter((x) => x !== g) : [...prev.grades, g],
    }));
  }

  function handleSave() {
    setError('');
    setMessage('');
    if (!form.textbookName.trim()) {
      setError('교과서명을 입력해 주세요.');
      return;
    }
    if (!editingTextbook && form.grades.length === 0) {
      setError('학년을 1개 이상 선택해 주세요.');
      return;
    }

    if (editingTextbook) {
      setTextbooks((prev) =>
        prev.map((t) =>
          t.id === editingTextbook.id
            ? { ...t, textbookName: form.textbookName, publisher: form.publisher, note: form.note }
            : t,
        ),
      );
      setMessage('수정했습니다.');
      setEditId(null);
      setForm(emptyForm());
    } else {
      const newBooks: Textbook[] = form.grades.map((g, i) => ({
        id: `tb_${Date.now()}_${i}`,
        school,
        grade: g,
        year,
        textbookName: form.textbookName,
        publisher: form.publisher,
        note: form.note,
      }));
      setTextbooks((prev) => [...prev, ...newBooks]);
      setMessage(`${form.grades.length}개 학년에 교과서를 등록했습니다.`);
      setForm(emptyForm());
    }
  }

  function handleDelete(id: string) {
    setTextbooks((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <>
      <p className={styles.caption}>학교 · 학년 · 연도별로 사용 중인 교과서(출판사 포함)를 기록합니다. 출판사가 해마다 바뀌어도 이력이 남습니다.</p>

      <div className={styles.card}>
        <SchoolYearPicker onChange={handlePick} />
      </div>

      {!school ? (
        <p className={styles.emptyText}>학교명을 선택하거나 입력해 주세요.</p>
      ) : (
        <>
          <div className={styles.card}>
            <h4 className={styles.formTitle}>{editingTextbook ? '✏️ 교과서 정보 수정' : '➕ 새 교과서 추가'}</h4>

            <div className={styles.field}>
              <label className={styles.label}>학년 (여러 학년에 같은 교과서를 한 번에 등록할 수 있어요)</label>
              <div className={styles.chipRow}>
                {GRADE_OPTIONS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={styles.gradeChip}
                    data-active={form.grades.includes(g)}
                    disabled={Boolean(editingTextbook)}
                    onClick={() => toggleGrade(g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
              {editingTextbook && (
                <p className={styles.hintText}>수정 중인 항목은 학년을 바꿀 수 없습니다 (학년: {editingTextbook.grade}).</p>
              )}
            </div>

            <div className={styles.dateRow}>
              <div className={styles.field} style={{ marginBottom: 0 }}>
                <label className={styles.label}>교과서명</label>
                <input
                  type="text"
                  className={styles.textInput}
                  placeholder="예) 수학2"
                  value={form.textbookName}
                  onChange={(e) => setForm((prev) => ({ ...prev, textbookName: e.target.value }))}
                />
              </div>
              <div className={styles.field} style={{ marginBottom: 0 }}>
                <label className={styles.label}>출판사</label>
                <input
                  type="text"
                  className={styles.textInput}
                  placeholder="예) 미래엔"
                  value={form.publisher}
                  onChange={(e) => setForm((prev) => ({ ...prev, publisher: e.target.value }))}
                />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>비고 (선택)</label>
              <textarea
                className={styles.textarea}
                value={form.note}
                onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
              />
            </div>

            {error && <p className={styles.errorText}>{error}</p>}

            <div className={styles.buttonRow}>
              <button type="button" className={styles.saveButton} onClick={handleSave}>
                {editingTextbook ? '수정 저장' : '저장'}
              </button>
              {editingTextbook && (
                <button type="button" className={styles.cancelButton} onClick={cancelEdit}>
                  취소
                </button>
              )}
            </div>

            {message && <p className={styles.successText}>{message}</p>}
          </div>

          <div className={styles.card}>
            <h4 className={styles.formTitle}>
              📚 {school} · {year}년 교과서 목록
            </h4>
            {scopedTextbooks.length === 0 ? (
              <p className={styles.emptyText}>등록된 교과서가 없습니다. 위에서 추가해 주세요.</p>
            ) : (
              GRADE_OPTIONS.map((grade) => {
                const rows = scopedTextbooks.filter((t) => t.grade === grade);
                if (rows.length === 0) return null;
                return (
                  <div key={grade} className={styles.gradeGroup}>
                    <h5 className={styles.gradeGroupTitle}>
                      {grade} ({rows.length}건)
                    </h5>
                    {rows.map((row) => (
                      <div key={row.id} className={styles.eventRow}>
                        <div className={styles.eventInfo}>
                          <strong>{row.textbookName}</strong>
                          {row.publisher && ` (${row.publisher})`}
                          {row.note && <div className={styles.eventNote}>💬 {row.note}</div>}
                        </div>
                        <div className={styles.rowActions}>
                          <button type="button" className={styles.smallButton} onClick={() => startEdit(row)}>
                            수정
                          </button>
                          <button type="button" className={styles.smallDeleteButton} onClick={() => handleDelete(row.id)}>
                            삭제
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </>
  );
}
