import { useEffect, useState } from 'react';
import { SchoolYearPicker } from './SchoolYearPicker';
import { fetchCalendarEvents, insertCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '../../lib/schoolInfo';
import { EVENT_TYPE_OPTIONS, GRADE_OPTIONS, type CalendarEvent, type EventType } from '../../types/schoolInfo';
import styles from './CalendarTab.module.css';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

interface FormState {
  grades: string[];
  eventType: EventType;
  eventName: string;
  startDate: string;
  hasRange: boolean;
  endDate: string;
  note: string;
}

function emptyForm(): FormState {
  return {
    grades: [],
    eventType: EVENT_TYPE_OPTIONS[0],
    eventName: '',
    startDate: todayStr(),
    hasRange: false,
    endDate: todayStr(),
    note: '',
  };
}

/**
 * 스트림릿 _render_calendar_tab() 재현: 학교+연도 선택 → 학년(복수 선택)별
 * 중간고사/기말고사/방학/기타 일정 등록 → 학년별로 묶어서 목록 표시, 항목별
 * 수정/삭제.
 *
 * 2026-08-24부터: 실제 dev DB(school_calendar_events)와 조회/저장/수정/삭제
 * 전부 연동됨.
 */
export function CalendarTab() {
  const [school, setSchool] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [scopedEvents, setScopedEvents] = useState<CalendarEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const editingEvent = editId ? scopedEvents.find((e) => e.id === editId) : undefined;

  function loadEvents(sch: string, yr: number) {
    if (!sch) return;
    let cancelled = false;
    setEventsLoading(true);
    setEventsError('');
    fetchCalendarEvents(sch, yr)
      .then((data) => {
        if (cancelled) return;
        setScopedEvents(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setEventsError(err instanceof Error ? err.message : '학사일정을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setEventsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }

  useEffect(() => {
    if (!school) return;
    return loadEvents(school, year);
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

  function startEdit(ev: CalendarEvent) {
    setEditId(ev.id);
    setForm({
      grades: [ev.grade],
      eventType: ev.eventType,
      eventName: ev.eventName,
      startDate: ev.startDate,
      hasRange: Boolean(ev.endDate),
      endDate: ev.endDate || ev.startDate,
      note: ev.note,
    });
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
    if (form.eventType === '기타' && !form.eventName.trim()) {
      setError('기타 일정은 이름을 입력해 주세요. (예: 수련회)');
      return;
    }
    if (!editingEvent && form.grades.length === 0) {
      setError('학년을 1개 이상 선택해 주세요.');
      return;
    }
    const endStr = form.hasRange ? form.endDate : '';

    setSaving(true);
    try {
      if (editingEvent) {
        await updateCalendarEvent(editingEvent.id, {
          eventType: form.eventType,
          eventName: form.eventName,
          startDate: form.startDate,
          endDate: endStr,
          note: form.note,
        });
        setMessage('수정했습니다.');
        setEditId(null);
        setForm(emptyForm());
      } else {
        await Promise.all(
          form.grades.map((g) =>
            insertCalendarEvent({
              school,
              grade: g,
              year,
              eventType: form.eventType,
              eventName: form.eventName,
              startDate: form.startDate,
              endDate: endStr,
              note: form.note,
            }),
          ),
        );
        setMessage(`${form.grades.length}개 학년에 일정을 등록했습니다.`);
        setForm(emptyForm());
      }
      loadEvents(school, year);
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteCalendarEvent(id);
      setScopedEvents((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      setEventsError(err instanceof Error ? err.message : '삭제 중 오류가 발생했습니다.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <p className={styles.caption}>
        학교 · 학년 · 연도별로 중간고사 / 기말고사 / 여름방학 / 겨울방학 / 기타 일정을 등록합니다. 학년마다 시험 일정이
        다르므로 학년을 꼭 선택해 주세요.
      </p>

      <div className={styles.card}>
        <SchoolYearPicker onChange={handlePick} />
      </div>

      {!school ? (
        <p className={styles.emptyText}>학교명을 선택하거나 입력해 주세요.</p>
      ) : (
        <>
          <div className={styles.card}>
            <h4 className={styles.formTitle}>{editingEvent ? '✏️ 일정 수정' : '➕ 새 일정 추가'}</h4>

            <div className={styles.field}>
              <label className={styles.label}>학년 (여러 학년에 같은 일정을 한 번에 등록할 수 있어요)</label>
              <div className={styles.chipRow}>
                {GRADE_OPTIONS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={styles.gradeChip}
                    data-active={form.grades.includes(g)}
                    disabled={Boolean(editingEvent)}
                    onClick={() => toggleGrade(g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
              {editingEvent && (
                <p className={styles.hintText}>수정 중인 항목은 학년을 바꿀 수 없습니다 (학년: {editingEvent.grade}).</p>
              )}
            </div>

            <div className={styles.field}>
              <label className={styles.label}>유형</label>
              <div className={styles.radioGroup}>
                {EVENT_TYPE_OPTIONS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={styles.radioBtn}
                    data-active={form.eventType === t}
                    onClick={() => setForm((prev) => ({ ...prev, eventType: t }))}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {form.eventType === '기타' && (
              <div className={styles.field}>
                <label className={styles.label}>일정 이름 (예: 수련회, 체육대회)</label>
                <input
                  type="text"
                  className={styles.textInput}
                  value={form.eventName}
                  onChange={(e) => setForm((prev) => ({ ...prev, eventName: e.target.value }))}
                />
              </div>
            )}

            <div className={styles.dateRow}>
              <div className={styles.field} style={{ marginBottom: 0 }}>
                <label className={styles.label}>시작일</label>
                <input
                  type="date"
                  className={styles.dateInput}
                  value={form.startDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))}
                />
              </div>
              <div className={styles.field} style={{ marginBottom: 0 }}>
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={form.hasRange}
                    onChange={(e) => setForm((prev) => ({ ...prev, hasRange: e.target.checked }))}
                  />
                  기간이 있는 일정 (종료일 지정)
                </label>
                <input
                  type="date"
                  className={styles.dateInput}
                  disabled={!form.hasRange}
                  value={form.endDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))}
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
                {saving ? '저장 중...' : editingEvent ? '수정 저장' : '저장'}
              </button>
              {editingEvent && (
                <button type="button" className={styles.cancelButton} onClick={cancelEdit}>
                  취소
                </button>
              )}
            </div>

            {message && <p className={styles.successText}>{message}</p>}
          </div>

          <div className={styles.card}>
            <h4 className={styles.formTitle}>
              📅 {school} · {year}년 학사일정
            </h4>
            {eventsLoading && <p className={styles.inlineNotice}>학사일정을 불러오는 중입니다...</p>}
            {eventsError && !eventsLoading && (
              <p className={styles.inlineNotice}>학사일정을 불러오지 못했습니다: {eventsError}</p>
            )}
            {!eventsLoading && !eventsError && scopedEvents.length === 0 ? (
              <p className={styles.emptyText}>등록된 학사일정이 없습니다. 위에서 추가해 주세요.</p>
            ) : (
              !eventsLoading &&
              GRADE_OPTIONS.map((grade) => {
                const rows = scopedEvents.filter((e) => e.grade === grade);
                if (rows.length === 0) return null;
                return (
                  <div key={grade} className={styles.gradeGroup}>
                    <h5 className={styles.gradeGroupTitle}>
                      {grade} ({rows.length}건)
                    </h5>
                    {rows.map((row) => {
                      const label = row.eventType === '기타' && row.eventName ? row.eventName : row.eventType;
                      const dateRange = row.endDate ? `${row.startDate} ~ ${row.endDate}` : row.startDate;
                      return (
                        <div key={row.id} className={styles.eventRow}>
                          <div className={styles.eventInfo}>
                            <strong>{label}</strong> · {dateRange}
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
                      );
                    })}
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
