import { useMemo, useState } from 'react';
import { classes } from '../data/mockClasses';
import { initialConsultationLogs } from '../data/mockConsultation';
import { CATEGORY_LABELS, CATEGORY_OPTIONS, type ConsultationCategory, type ConsultationLogEntry } from '../types/consultation';
import styles from './ConsultationLog.module.css';

interface FlatStudent {
  id: string;
  name: string;
  className: string;
}

function nowStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 스트림릿 page_consultation() 재현: 학생 선택 → (좌) 새 상담 메모 작성
 * (분류/작성자/메모) → (우) 그 학생의 상담 이력(최신순), 항목별 삭제(확인 후).
 */
export function ConsultationLog() {
  const allStudents: FlatStudent[] = useMemo(
    () => classes.flatMap((c) => c.students.map((s) => ({ id: s.id, name: s.name, className: c.name }))),
    [],
  );

  const [studentId, setStudentId] = useState(allStudents[0]?.id ?? '');
  const [logs, setLogs] = useState<ConsultationLogEntry[]>(initialConsultationLogs);
  const [category, setCategory] = useState<ConsultationCategory>('general');
  const [author, setAuthor] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const selectedStudent = allStudents.find((s) => s.id === studentId);

  const studentLogs = useMemo(
    () =>
      logs
        .filter((l) => l.studentId === studentId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [logs, studentId],
  );

  function handleStudentChange(id: string) {
    setStudentId(id);
    setFormError('');
    setConfirmDeleteId(null);
  }

  function handleSubmit() {
    if (!note.trim()) {
      setFormError('메모 내용을 입력해 주세요.');
      return;
    }
    const newLog: ConsultationLogEntry = {
      id: `cl_${Date.now()}`,
      studentId,
      category,
      note: note.trim(),
      author: author.trim(),
      createdAt: nowStr(),
    };
    setLogs((prev) => [...prev, newLog]);
    setCategory('general');
    setAuthor('');
    setNote('');
    setFormError('');
  }

  function handleDelete(id: string) {
    setLogs((prev) => prev.filter((l) => l.id !== id));
    setConfirmDeleteId(null);
  }

  if (!selectedStudent) {
    return <p className={styles.emptyText}>등록된 학생이 없습니다.</p>;
  }

  return (
    <>
      <div className={styles.headerRow}>
        <h1 className={styles.pageTitle}>상담 일지</h1>
        <div className={styles.pageSub}>
          학생 진도, 학부모 상담, 행동 관찰 등의 짧은 메모를 시간 기록과 함께 보관합니다.
        </div>
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>학생 선택</h3>
        <select className={styles.selectInput} value={studentId} onChange={(e) => handleStudentChange(e.target.value)}>
          {allStudents.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} (반: {s.className}) · #{s.id}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.layout}>
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>{selectedStudent.name} 학생 새 상담 메모</h3>

          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label}>분류</label>
              <select
                className={styles.selectInput}
                value={category}
                onChange={(e) => setCategory(e.target.value as ConsultationCategory)}
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label}>작성자 (선택)</label>
              <input
                type="text"
                className={styles.textInput}
                placeholder="예: 김선생"
                maxLength={40}
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>메모 내용</label>
            <textarea
              className={styles.textarea}
              placeholder="예: 이번 주 응용문제 풀이 속도가 눈에 띄게 향상됨. 학부모께 칭찬 메시지 발송 예정."
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {formError && <p className={styles.errorText}>{formError}</p>}

          <button type="button" className={styles.saveButton} onClick={handleSubmit}>
            메모 저장
          </button>
        </div>

        <div className={styles.card}>
          <h3 className={styles.cardTitle}>{selectedStudent.name} 학생 상담 이력</h3>
          {studentLogs.length === 0 ? (
            <p className={styles.emptyText}>저장된 상담 메모가 없습니다. 왼쪽에서 첫 번째 메모를 작성해 보세요.</p>
          ) : (
            <>
              <p className={styles.countCaption}>총 {studentLogs.length}건 — 최신순</p>
              {studentLogs.map((log) => (
                <div key={log.id} className={styles.logItem}>
                  <div className={styles.logHeader}>
                    <span className={styles.logMeta}>
                      <strong>{CATEGORY_LABELS[log.category]}</strong> · {log.createdAt} · {log.author || '—'}
                    </span>
                    {confirmDeleteId === log.id ? (
                      <span className={styles.confirmGroup}>
                        <span className={styles.confirmText}>삭제할까요?</span>
                        <button type="button" className={styles.confirmYes} onClick={() => handleDelete(log.id)}>
                          예, 삭제합니다
                        </button>
                        <button type="button" className={styles.confirmNo} onClick={() => setConfirmDeleteId(null)}>
                          취소
                        </button>
                      </span>
                    ) : (
                      <button type="button" className={styles.deleteButton} onClick={() => setConfirmDeleteId(log.id)}>
                        삭제
                      </button>
                    )}
                  </div>
                  <p className={styles.logNote}>{log.note}</p>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}
