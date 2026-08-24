import { useEffect, useMemo, useState } from 'react';
import { fetchStudents } from '../lib/students';
import { fetchConsultationLogs, addConsultationLog, deleteConsultationLog } from '../lib/consultation';
import { CATEGORY_LABELS, CATEGORY_OPTIONS, type ConsultationCategory, type ConsultationLogEntry } from '../types/consultation';
import type { StudentProfile } from '../types/student';
import styles from './ConsultationLog.module.css';

/**
 * 스트림릿 page_consultation() 재현: 학생 선택 → (좌) 새 상담 메모 작성
 * (분류/작성자/메모) → (우) 그 학생의 상담 이력(최신순), 항목별 삭제(확인 후).
 *
 * 2026-08-24부터: 학생 목록과 상담 이력 모두 실제 dev Supabase(kpimhidgkrqtegcumrul)
 * 조회/저장/삭제로 연동됨 (consultation_logs 테이블).
 */
export function ConsultationLog() {
  const [allStudents, setAllStudents] = useState<StudentProfile[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentsError, setStudentsError] = useState('');

  const [studentId, setStudentId] = useState('');
  const [logs, setLogs] = useState<ConsultationLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState('');

  const [category, setCategory] = useState<ConsultationCategory>('general');
  const [author, setAuthor] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStudentsLoading(true);
    setStudentsError('');
    fetchStudents()
      .then((data) => {
        if (cancelled) return;
        setAllStudents(data);
        setStudentId((prev) => prev || data[0]?.id || '');
      })
      .catch((err) => {
        if (cancelled) return;
        setStudentsError(err instanceof Error ? err.message : 'DB에서 학생 목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setStudentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function loadLogs(sid: string) {
    if (!sid) return;
    let cancelled = false;
    setLogsLoading(true);
    setLogsError('');
    fetchConsultationLogs(sid)
      .then((data) => {
        if (cancelled) return;
        setLogs(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setLogsError(err instanceof Error ? err.message : '상담 이력을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLogsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }

  useEffect(() => {
    if (!studentId) return;
    const cleanup = loadLogs(studentId);
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  const selectedStudent = allStudents.find((s) => s.id === studentId);

  const studentLogs = useMemo(
    () => logs.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [logs],
  );

  function handleStudentChange(id: string) {
    setStudentId(id);
    setFormError('');
    setConfirmDeleteId(null);
  }

  async function handleSubmit() {
    if (!note.trim()) {
      setFormError('메모 내용을 입력해 주세요.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await addConsultationLog({ studentId, category, note, author });
      setCategory('general');
      setAuthor('');
      setNote('');
      loadLogs(studentId);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteConsultationLog(id);
      setLogs((prev) => prev.filter((l) => l.id !== id));
      setConfirmDeleteId(null);
    } catch (err) {
      setLogsError(err instanceof Error ? err.message : '삭제 중 오류가 발생했습니다.');
    } finally {
      setDeletingId(null);
    }
  }

  if (studentsLoading) {
    return <p className={styles.inlineNotice}>DB에서 학생 목록을 불러오는 중입니다...</p>;
  }

  if (studentsError) {
    return (
      <p className={styles.inlineNotice}>
        학생 목록을 불러오지 못했습니다: {studentsError} (dev DB 접속 설정을 확인해 주세요)
      </p>
    );
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

          <button type="button" className={styles.saveButton} onClick={handleSubmit} disabled={saving}>
            {saving ? '저장 중...' : '메모 저장'}
          </button>
        </div>

        <div className={styles.card}>
          <h3 className={styles.cardTitle}>{selectedStudent.name} 학생 상담 이력</h3>
          {logsLoading && <p className={styles.inlineNotice}>상담 이력을 불러오는 중입니다...</p>}
          {logsError && !logsLoading && (
            <p className={styles.inlineNotice}>이력을 불러오지 못했습니다: {logsError}</p>
          )}
          {!logsLoading && !logsError && studentLogs.length === 0 ? (
            <p className={styles.emptyText}>저장된 상담 메모가 없습니다. 왼쪽에서 첫 번째 메모를 작성해 보세요.</p>
          ) : (
            <>
              {!logsLoading && studentLogs.length > 0 && (
                <p className={styles.countCaption}>총 {studentLogs.length}건 — 최신순</p>
              )}
              {studentLogs.map((log) => (
                <div key={log.id} className={styles.logItem}>
                  <div className={styles.logHeader}>
                    <span className={styles.logMeta}>
                      <strong>{CATEGORY_LABELS[log.category]}</strong> · {log.createdAt} · {log.author || '—'}
                    </span>
                    {confirmDeleteId === log.id ? (
                      <span className={styles.confirmGroup}>
                        <span className={styles.confirmText}>삭제할까요?</span>
                        <button
                          type="button"
                          className={styles.confirmYes}
                          onClick={() => handleDelete(log.id)}
                          disabled={deletingId === log.id}
                        >
                          {deletingId === log.id ? '삭제 중...' : '예, 삭제합니다'}
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
