import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ClassInfo } from '../../types/classManagement';
import { createMakeupSession, deleteMakeupSession, fetchMakeupSessions, type MakeupSession } from '../../lib/makeup';
import styles from './AttendanceHistoryPanel.module.css';
import own from './MakeupPanel.module.css';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const NO_CLASS = '';

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function weekdayOf(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : WEEKDAYS[d.getDay()];
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return String(err);
}

interface MakeupPanelProps {
  classes: ClassInfo[];
  monthLabel: string;
  fromDate: string;
  toDate: string;
}

/**
 * 출석 관리 → "보강 관리" 탭. 보강을 할 때마다 날짜·학생·내용을 기록해 두면
 * "출석 이력 및 통계"의 출석 내역(통계·캘린더·보강 진행 및 기타)과 학부모
 * 문자에 자동으로 반영된다. 정규 수업 출석(attendance)과 날짜가 겹쳐도 되도록
 * 별도 테이블(makeup_sessions/makeup_attendees)에 저장.
 */
export function MakeupPanel({ classes, monthLabel, fromDate, toDate }: MakeupPanelProps) {
  const [date, setDate] = useState(todayStr());
  const [classId, setClassId] = useState(classes[0]?.id ?? NO_CLASS);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveError, setSaveError] = useState('');

  const [list, setList] = useState<MakeupSession[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');

  const loadList = useCallback(() => {
    setListLoading(true);
    setListError('');
    fetchMakeupSessions(fromDate, toDate)
      .then(setList)
      .catch((err) => setListError(describeError(err)))
      .finally(() => setListLoading(false));
  }, [fromDate, toDate]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  /** 체크 목록 — 반을 고르면 그 반 학생, "반 지정 안 함"이면 전체 학생(반 이름과 함께). */
  const studentOptions = useMemo(() => {
    const out: { id: string; name: string; className: string }[] = [];
    const seen = new Set<string>();
    for (const c of classes) {
      if (classId && c.id !== classId) continue;
      for (const st of c.students) {
        if (seen.has(st.id)) continue;
        seen.add(st.id);
        out.push({ id: st.id, name: st.name, className: c.name });
      }
    }
    return out;
  }, [classes, classId]);

  const allChecked = studentOptions.length > 0 && studentOptions.every((s) => checked.has(s.id));

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const s of studentOptions) {
        if (allChecked) next.delete(s.id);
        else next.add(s.id);
      }
      return next;
    });
  }

  async function handleSave() {
    if (checked.size === 0 || !date) return;
    setSaving(true);
    setSaveMessage('');
    setSaveError('');
    try {
      await createMakeupSession({ date, classId: classId || null, content, studentIds: Array.from(checked) });
      setSaveMessage(`${date}(${weekdayOf(date)}) 보강 ${checked.size}명 기록 완료`);
      setChecked(new Set());
      setContent('');
      loadList();
    } catch (err) {
      setSaveError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(m: MakeupSession) {
    const names = m.students.map((s) => s.name).join(', ');
    if (!window.confirm(`${m.date} 보강 기록(${names})을 삭제할까요?`)) return;
    try {
      await deleteMakeupSession(m.id);
      loadList();
    } catch (err) {
      setListError(describeError(err));
    }
  }

  return (
    <>
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>보강 기록하기</h3>
        <div className={styles.controlRow}>
          <div className={styles.field}>
            <label className={styles.label}>보강 날짜</label>
            <input type="date" className={styles.dateInput} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>수업</label>
            <select className={styles.selectInput} value={classId} onChange={(e) => setClassId(e.target.value)}>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value={NO_CLASS}>반 지정 안 함 (전체 학생에서 선택)</option>
            </select>
          </div>
          <div className={styles.rangeCaption}>
            {date && `선택 날짜: ${date} (${weekdayOf(date)})`}
          </div>
        </div>

        <div className={own.studentHeader}>
          <span className={styles.label}>보강한 학생 — {checked.size}명 선택</span>
          {studentOptions.length > 0 && (
            <button type="button" className={own.linkButton} onClick={toggleAll}>
              {allChecked ? '전체 해제' : '전체 선택'}
            </button>
          )}
        </div>
        {studentOptions.length === 0 ? (
          <p className={styles.emptyText}>이 수업에 배정된 학생이 없습니다.</p>
        ) : (
          <div className={own.chips}>
            {studentOptions.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`${own.chip} ${checked.has(s.id) ? own.chipActive : ''}`}
                onClick={() => toggle(s.id)}
              >
                {checked.has(s.id) ? '✓ ' : ''}
                {s.name}
                {!classId && <span className={own.chipMeta}> · {s.className}</span>}
              </button>
            ))}
          </div>
        )}

        <label className={styles.label} style={{ display: 'block', marginTop: 14 }}>
          보강 내용
        </label>
        <textarea
          className={own.textarea}
          rows={3}
          placeholder="예: 9/16 휴강분 보강 — 인수분해 복습 / 8/8 수업분 미리 보강"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />

        <button
          type="button"
          className={styles.pdfButton}
          onClick={handleSave}
          disabled={saving || checked.size === 0 || !date}
        >
          {saving ? '저장 중...' : '보강 기록 저장'}
        </button>
        {saveMessage && <p className={styles.downloadNotice}>✅ {saveMessage}</p>}
        {saveError && <p className={styles.errorNotice}>저장 실패: {saveError}</p>}
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>{monthLabel} 보강 내역</h3>
        <p className={styles.emptyText} style={{ marginBottom: 10 }}>
          위쪽 "조회 월"을 바꾸면 다른 달 내역을 볼 수 있습니다. 여기 기록이 출석 내역 인쇄·학부모 문자에 반영됩니다.
        </p>
        {listLoading ? (
          <p className={styles.emptyText}>불러오는 중...</p>
        ) : listError ? (
          <p className={styles.errorNotice}>
            불러오지 못했습니다: {listError}
            <br />
            (처음이라면 Supabase SQL Editor에서 보강 테이블 생성 SQL을 먼저 실행해야 합니다.)
          </p>
        ) : list.length === 0 ? (
          <p className={styles.emptyText}>이 달에 기록된 보강이 없습니다.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>수업</th>
                  <th>학생</th>
                  <th>내용</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.date} ({weekdayOf(m.date)})
                    </td>
                    <td>{m.className || '—'}</td>
                    <td>{m.students.map((s) => s.name).join(', ')}</td>
                    <td>{m.content || '—'}</td>
                    <td>
                      <button type="button" className={own.linkButton} onClick={() => handleDelete(m)}>
                        삭제
                      </button>
                    </td>
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
