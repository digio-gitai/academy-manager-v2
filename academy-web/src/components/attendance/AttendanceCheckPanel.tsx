import { useEffect, useMemo, useState } from 'react';
import type { ClassInfo } from '../../types/classManagement';
import type { AttendanceRecord, AttendanceStatus } from '../../types/attendance';
import { fetchAttendanceForSession, saveAttendanceSession } from '../../lib/attendance';
import styles from './AttendanceCheckPanel.module.css';

const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: '출석',
  late: '지각',
  absent: '결석',
};

interface AttendanceCheckPanelProps {
  classes: ClassInfo[];
}

/**
 * 스트림릿 page_attendance()의 "출석 체크" 탭과 동일한 기능.
 * 하단의 "오늘 과제"는 원래 여기서 직접 입력했지만(homework.py), 2026-08-22
 * 사용자 결정에 따라 이제부터 모든 과제는 '과제 인증' 메뉴에서만 등록하고
 * 여기서는 참고용으로 읽기 전용 표시만 함. '과제 인증' 화면 자체가 아직 실제
 * DB 연동 전(mock) 단계라서, 그 화면이 연동될 때까지는 항상 "등록된 과제
 * 없음"으로만 표시됨(2026-08-24) — 거짓 데이터를 보여주는 것보다 안전한 선택.
 *
 * 2026-08-24부터: 출석 조회/저장 전부 실제 dev DB(Supabase) 연동.
 */
export function AttendanceCheckPanel({ classes }: AttendanceCheckPanelProps) {
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [sessionDate, setSessionDate] = useState('2026-08-20');
  const [savedRecords, setSavedRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [records, setRecords] = useState<Record<string, { status: AttendanceStatus; note: string }>>({});
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  const selectedClass = classes.find((c) => c.id === classId);
  const alreadySaved = savedRecords.length > 0;

  useEffect(() => {
    if (!classId || !sessionDate) return;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setRecords({});
    setSaveMessage('');
    fetchAttendanceForSession(classId, sessionDate)
      .then((data) => {
        if (cancelled) return;
        setSavedRecords(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : '출석 기록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [classId, sessionDate]);

  const weekdayLabel = useMemo(() => {
    const d = new Date(`${sessionDate}T00:00:00`);
    return Number.isNaN(d.getTime()) ? '' : WEEKDAYS_KO[d.getDay()];
  }, [sessionDate]);

  function getStatus(studentId: string): AttendanceStatus {
    if (records[studentId]) return records[studentId].status;
    const saved = savedRecords.find((r) => r.studentId === studentId);
    return saved?.status ?? 'present';
  }

  function getNote(studentId: string): string {
    if (records[studentId]) return records[studentId].note;
    const saved = savedRecords.find((r) => r.studentId === studentId);
    return saved?.note ?? '';
  }

  function updateStatus(studentId: string, status: AttendanceStatus) {
    setRecords((prev) => ({ ...prev, [studentId]: { status, note: getNote(studentId) } }));
  }

  function updateNote(studentId: string, note: string) {
    setRecords((prev) => ({ ...prev, [studentId]: { status: getStatus(studentId), note } }));
  }

  async function handleSave() {
    if (!selectedClass) return;
    const recs: AttendanceRecord[] = selectedClass.students.map((s) => ({
      studentId: s.id,
      status: getStatus(s.id),
      note: getNote(s.id),
    }));
    setSaving(true);
    setSaveMessage('');
    try {
      await saveAttendanceSession(classId, sessionDate, recs);
      setSavedRecords(recs);
      setRecords({});
      const present = recs.filter((r) => r.status === 'present').length;
      const late = recs.filter((r) => r.status === 'late').length;
      const absent = recs.filter((r) => r.status === 'absent').length;
      setSaveMessage(`저장 완료 — 출석 ${present} · 지각 ${late} · 결석 ${absent}`);
    } catch (err) {
      setSaveMessage(err instanceof Error ? `저장 실패: ${err.message}` : '출석 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className={styles.card}>
        <div className={styles.controlRow}>
          <div className={styles.field}>
            <label className={styles.label}>수업</label>
            <select
              className={styles.selectInput}
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>수업 날짜</label>
            <input
              type="date"
              className={styles.dateInput}
              value={sessionDate}
              onChange={(e) => setSessionDate(e.target.value)}
            />
          </div>
          <div className={styles.weekdayCaption}>
            선택 날짜: {sessionDate} ({weekdayLabel})
          </div>
        </div>

        {loading && <p className={styles.emptyText}>출석 기록을 불러오는 중입니다...</p>}
        {loadError && !loading && <p className={styles.emptyText}>불러오지 못했습니다: {loadError}</p>}

        {!loading && alreadySaved && (
          <div className={styles.infoBanner}>
            이 날짜의 출결 기록이 이미 저장되어 있습니다. 수정 후 다시 저장할 수 있습니다.
          </div>
        )}

        {!loading && (!selectedClass || selectedClass.students.length === 0) ? (
          <p className={styles.emptyText}>{selectedClass?.name ?? '선택한'} 수업에 배정된 학생이 없습니다.</p>
        ) : (
          !loading &&
          selectedClass && (
            <>
              {selectedClass.students.map((s) => {
                const status = getStatus(s.id);
                return (
                  <div key={s.id} className={styles.studentRow}>
                    <span className={styles.studentName}>{s.name}</span>
                    <div className={styles.radioGroup}>
                      {(Object.keys(STATUS_LABELS) as AttendanceStatus[]).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          className={styles.radioBtn}
                          data-status={opt}
                          data-active={status === opt}
                          disabled={saving}
                          onClick={() => updateStatus(s.id, opt)}
                        >
                          {STATUS_LABELS[opt]}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      className={styles.noteInput}
                      placeholder="비고 (예: 7/22 보강, 조퇴 등)"
                      value={getNote(s.id)}
                      disabled={saving}
                      onChange={(e) => updateNote(s.id, e.target.value)}
                    />
                  </div>
                );
              })}
              <button type="button" className={styles.saveButton} onClick={handleSave} disabled={saving}>
                {saving ? '저장 중...' : alreadySaved ? '출석 수정' : '출석 저장'}
              </button>
              {saveMessage && <p className={styles.successText}>{saveMessage}</p>}
            </>
          )
        )}
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>오늘 과제 (참고)</h3>
        <p className={styles.emptyText}>
          이 날짜에 등록된 과제가 없습니다. '과제 인증' 메뉴에서 등록해주세요.
        </p>
      </div>
    </>
  );
}
