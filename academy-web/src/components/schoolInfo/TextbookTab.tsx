import { useEffect, useState } from 'react';
import { SchoolYearPicker } from './SchoolYearPicker';
import { fetchTextbooks, insertTextbook, updateTextbook, deleteTextbook } from '../../lib/schoolInfo';
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
 *
 * 2026-08-24부터: 실제 dev DB(school_textbooks)와 조회/저장/수정/삭제 전부
 * 연동됨.
 */
export function TextbookTab() {
  const [school, setSchool] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [scopedTextbooks, setScopedTextbooks] = useState<Textbook[]>([]);
  const [textbooksLoading, setTextbooksLoading] = useState(false);
  const [textbooksError, setTextbooksError] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const editingTextbook = editId ? scopedTextbooks.find((t) => t.id === editId) : undefined;

  function loadTextbooks(sch: string, yr: number) {
    if (!sch) return;
    let cancelled = false;
    setTextbooksLoading(true);
    setTextbooksError('');
    fetchTextbooks(sch, yr)
      .then((data) => {
        if (cancelled) return;
        setScopedTextbooks(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setTextbooksError(err instanceof Error ? err.message : '교과서 목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setTextbooksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }

  useEffect(() => {
    if (!school) return;
    return loadTextbooks(school, year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [school, year]);

  function handlePick(nextSchool: string, nextYear: number) {
    setSchool(nextSchool);
    setYear(nextYear);
    setEditId(null);
    setForm(emptyForm());
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

  async function handleSave() {
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

    setSaving(true);
    try {
      if (editingTextbook) {
        await updateTextbook(editingTextbook.id, {
          textbookName: form.textbookName,
          publisher: form.publisher,
          note: form.note,
        });
        setMessage('수정했습니다.');
        setEditId(null);
        setForm(emptyForm());
      } else {
        await Promise.all(
          form.grades.map((g) =>
            insertTextbook({
              school,
              grade: g,
              year,
              textbookName: form.textbookName,
              publisher: form.publisher,
              note: form.note,
            }),
          ),
        );
        setMessage(`${form.grades.length}개 학년에 교과서를 등록했습니다.`);
        setForm(emptyForm());
      }
      loadTextbooks(school, year);
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteTextbook(id);
      setScopedTextbooks((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setTextbooksError(err instanceof Error ? err.message : '삭제 중 오류가 발생했습니다.');
    } finally {
      setDeletingId(null);
    }
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
              <button type="button" className={styles.saveButton} onClick={handleSave} disabled={saving}>
                {saving ? '저장 중...' : editingTextbook ? '수정 저장' : '저장'}
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
            {textbooksLoading && <p className={styles.inlineNotice}>교과서 목록을 불러오는 중입니다...</p>}
            {textbooksError && !textbooksLoading && (
              <p className={styles.inlineNotice}>교과서 목록을 불러오지 못했습니다: {textbooksError}</p>
            )}
            {!textbooksLoading && !textbooksError && scopedTextbooks.length === 0 ? (
              <p className={styles.emptyText}>등록된 교과서가 없습니다. 위에서 추가해 주세요.</p>
            ) : (
              !textbooksLoading &&
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
                          <button
                            type="button"
                            className={styles.smallDeleteButton}
                            onClick={() => handleDelete(row.id)}
                            disabled={deletingId === row.id}
                          >
                            {deletingId === row.id ? '삭제 중...' : '삭제'}
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
