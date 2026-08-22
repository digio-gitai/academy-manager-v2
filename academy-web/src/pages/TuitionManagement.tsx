import { useMemo, useState } from 'react';
import { classes } from '../data/mockClasses';
import { initialTuitionRecords } from '../data/mockTuition';
import {
  TUITION_STATUS_LABELS,
  TUITION_STATUS_OPTIONS,
  tuitionKey,
  type TuitionRecord,
  type TuitionStatus,
} from '../types/tuition';
import styles from './TuitionManagement.module.css';

const CLASS_FILTER_ALL = '__all__';

function todayMonth() {
  return new Date().toISOString().slice(0, 7);
}

function isValidMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

interface FlatStudent {
  id: string;
  name: string;
  classId: string;
  className: string;
}

/**
 * 스트림릿 page_tuition() 재현: 반/월 조회 조건 → 납부/미납/연체 요약 카드 →
 * 학생별 상태(납부/미납/연체) · 금액 입력 후 저장(같은 학생+월 조합은 덮어쓰기).
 * 상태를 '납부'로 바꿔 저장하면 저장일이 오늘 날짜로 자동 기록됨(원본과 동일).
 */
export function TuitionManagement() {
  const [classFilter, setClassFilter] = useState(CLASS_FILTER_ALL);
  const [month, setMonth] = useState(todayMonth());
  const [records, setRecords] = useState<TuitionRecord[]>(initialTuitionRecords);
  const [draftEdits, setDraftEdits] = useState<Record<string, { status: TuitionStatus; amount: string }>>({});
  const [savedMessage, setSavedMessage] = useState<Record<string, string>>({});

  const allStudents: FlatStudent[] = useMemo(
    () => classes.flatMap((c) => c.students.map((s) => ({ id: s.id, name: s.name, classId: c.id, className: c.name }))),
    [],
  );

  const monthValid = isValidMonth(month);

  const filteredStudents = useMemo(
    () => (classFilter === CLASS_FILTER_ALL ? allStudents : allStudents.filter((s) => s.classId === classFilter)),
    [allStudents, classFilter],
  );

  function recordFor(studentId: string): TuitionRecord | undefined {
    return records.find((r) => r.studentId === studentId && r.month === month);
  }

  function draftFor(studentId: string): { status: TuitionStatus; amount: string } {
    const key = tuitionKey(studentId, month);
    if (draftEdits[key]) return draftEdits[key];
    const existing = recordFor(studentId);
    return { status: existing?.status ?? 'pending', amount: String(existing?.amount ?? 0) };
  }

  function updateDraft(studentId: string, patch: Partial<{ status: TuitionStatus; amount: string }>) {
    const key = tuitionKey(studentId, month);
    setDraftEdits((prev) => ({ ...prev, [key]: { ...draftFor(studentId), ...patch } }));
  }

  function handleSave(studentId: string, studentName: string) {
    const draft = draftFor(studentId);
    const amount = Number(draft.amount) || 0;
    const paidDate = draft.status === 'paid' ? new Date().toISOString().slice(0, 10) : undefined;

    setRecords((prev) => {
      const exists = prev.some((r) => r.studentId === studentId && r.month === month);
      const newRecord: TuitionRecord = { studentId, month, status: draft.status, amount, paidDate };
      if (exists) {
        return prev.map((r) => (r.studentId === studentId && r.month === month ? newRecord : r));
      }
      return [...prev, newRecord];
    });
    setSavedMessage((prev) => ({ ...prev, [studentId]: `${studentName} 수강료 상태가 저장되었습니다.` }));
  }

  const summary = useMemo(() => {
    let paid = 0;
    let pending = 0;
    let overdue = 0;
    let totalAmount = 0;
    filteredStudents.forEach((s) => {
      const rec = recordFor(s.id);
      const status = rec?.status ?? 'pending';
      if (status === 'paid') {
        paid += 1;
        totalAmount += rec?.amount ?? 0;
      } else if (status === 'overdue') overdue += 1;
      else pending += 1;
    });
    return { paid, pending, overdue, totalAmount };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredStudents, records, month]);

  return (
    <>
      <div className={styles.headerRow}>
        <h1 className={styles.pageTitle}>수강료 관리</h1>
        <div className={styles.pageSub}>월별 수강료 납부 상태와 금액을 학생별로 기록합니다.</div>
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>조회 조건</h3>
        <div className={styles.conditionRow}>
          <div className={styles.field}>
            <label className={styles.label}>반 선택</label>
            <select className={styles.selectInput} value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
              <option value={CLASS_FILTER_ALL}>전체 수업</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>월 (YYYY-MM)</label>
            <input
              type="text"
              className={styles.textInput}
              placeholder="예: 2026-08"
              value={month}
              onChange={(e) => setMonth(e.target.value.trim())}
            />
          </div>
        </div>
        {!monthValid && <p className={styles.errorText}>월 형식이 올바르지 않습니다. YYYY-MM 형식으로 입력하세요.</p>}
      </div>

      {monthValid && (
        <>
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>{month} 요약</h3>
            <div className={styles.summaryGrid}>
              <div className={styles.summaryTile}>
                <div className={styles.summaryLabel}>납부</div>
                <div className={styles.summaryValue}>{summary.paid}</div>
              </div>
              <div className={styles.summaryTile}>
                <div className={styles.summaryLabel}>미납</div>
                <div className={styles.summaryValue}>{summary.pending}</div>
              </div>
              <div className={styles.summaryTile}>
                <div className={styles.summaryLabel}>연체</div>
                <div className={styles.summaryValue}>{summary.overdue}</div>
              </div>
              <div className={styles.summaryTile}>
                <div className={styles.summaryLabel}>납부 총액</div>
                <div className={styles.summaryValue}>{summary.totalAmount.toLocaleString()}원</div>
              </div>
            </div>
          </div>

          <div className={styles.card}>
            <h3 className={styles.cardTitle}>학생별 납부 상태</h3>
            {filteredStudents.length === 0 ? (
              <p className={styles.emptyText}>선택한 조건에 해당하는 학생이 없습니다.</p>
            ) : (
              filteredStudents.map((s) => {
                const draft = draftFor(s.id);
                return (
                  <div key={s.id} className={styles.studentRowWrap}>
                    <div className={styles.studentRow}>
                      <span className={styles.studentName}>{s.name}</span>
                      <select
                        className={styles.statusSelect}
                        value={draft.status}
                        onChange={(e) => updateDraft(s.id, { status: e.target.value as TuitionStatus })}
                      >
                        {TUITION_STATUS_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {TUITION_STATUS_LABELS[opt]}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        className={styles.amountInput}
                        min={0}
                        step={10000}
                        value={draft.amount}
                        onChange={(e) => updateDraft(s.id, { amount: e.target.value })}
                      />
                      <button type="button" className={styles.saveButton} onClick={() => handleSave(s.id, s.name)}>
                        저장
                      </button>
                    </div>
                    {savedMessage[s.id] && <p className={styles.successText}>{savedMessage[s.id]}</p>}
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
