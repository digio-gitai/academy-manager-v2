import { useEffect, useMemo, useState } from 'react';
import type { ClassInfo } from '../../types/classManagement';
import type { AttendanceRecord, AttendanceStatus } from '../../types/attendance';
import { fetchAttendanceForSession, saveAttendanceSession } from '../../lib/attendance';
import {
  fetchTodayHomeworkSummary,
  fetchHomeworkPerformanceForSession,
  saveHomeworkPerformanceForSession,
  type HomeworkPerformanceLevel,
  type TodayHomeworkSummary,
} from '../../lib/homework';
import styles from './AttendanceCheckPanel.module.css';

const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

// [2026-09-05] 버그 수정: sessionDate 초기값이 '2026-08-20'으로 고정돼 있어서
// 화면을 열 때마다 오늘이 아니라 과거 날짜가 떠 있었고, 그 상태로 출석을
// 저장해서 실제로 잘못된 날짜에 저장되는 사고가 있었음. 브라우저의 로컬
// 날짜(YYYY-MM-DD)를 항상 기본값으로 쓰도록 수정 — toISOString()은 UTC
// 기준이라 자정 근처(한국시간 00~09시)에 하루가 밀리는 문제가 있어서 쓰지
// 않고, getFullYear/getMonth/getDate로 직접 조합함(lib/homework.ts의
// nowStr()과 같은 방식).
function getLocalTodayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: '출석',
  late: '지각',
  absent: '결석',
  cancelled: '휴강',
};

// 학생별 라디오 버튼에는 '휴강'을 넣지 않는다 — 휴강은 "날짜선택 후 전체휴강"
// 버튼으로만 반 전체에 한 번에 매기는 상태라서(2026-09-22 사용자 요청).
const CHECK_STATUS_OPTIONS: AttendanceStatus[] = ['present', 'late', 'absent'];

interface AttendanceCheckPanelProps {
  classes: ClassInfo[];
}

/**
 * 스트림릿 page_attendance()의 "출석 체크" 탭과 동일한 기능.
 * 하단의 "오늘 과제"는 원래 여기서 직접 입력했지만(homework.py), 2026-08-22
 * 사용자 결정에 따라 이제부터 모든 과제는 '과제 인증' 메뉴에서만 등록하고
 * 여기서는 참고용으로 읽기 전용 표시만 함.
 *
 * 2026-08-24부터: 출석 조회/저장 전부 실제 dev DB(Supabase) 연동.
 * 2026-08-26부터: "오늘 과제(참고)" 카드도 과제 인증(hw_ 테이블) 실제 연동 —
 * homework.py get_hw_assignment_summary()와 동일하게, 이 반+날짜에 과제
 * 인증에서 등록한 공통 항목이 있으면 제목과 항목 요약을 그대로 보여줌(수정은
 * 여전히 '과제 인증' 메뉴에서만).
 * 2026-09-14부터: 카드 이름을 "직전 수업 과제"로 바꾸고, 오늘 날짜가 아니라
 * 이 반에 가장 최근(오늘 이전 포함)에 등록된 과제를 보여주도록 수정 — 과제는
 * 보통 수업 중에 다음 시간까지로 내주기 때문에 assigned_date가 오늘이 아니라
 * 직전 수업일로 저장되어 있어서, 기존 로직(assigned_date==오늘)으로는 거의
 * 항상 빈 카드만 보였음.
 */
export function AttendanceCheckPanel({ classes }: AttendanceCheckPanelProps) {
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [sessionDate, setSessionDate] = useState(getLocalTodayStr());
  const [savedRecords, setSavedRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [records, setRecords] = useState<Record<string, { status: AttendanceStatus; note: string }>>({});
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  const [homework, setHomework] = useState<TodayHomeworkSummary | null>(null);
  const [homeworkLoading, setHomeworkLoading] = useState(true);
  const [homeworkError, setHomeworkError] = useState('');

  // 2026-09-05 추가: 과제 수행도(상/중/하) 체크 — 출석과 별개로 저장/불러오기.
  const [perfSaved, setPerfSaved] = useState<Record<string, HomeworkPerformanceLevel>>({});
  const [perfEdits, setPerfEdits] = useState<Record<string, HomeworkPerformanceLevel>>({});
  const [perfLoading, setPerfLoading] = useState(true);
  const [perfError, setPerfError] = useState('');
  const [perfSaving, setPerfSaving] = useState(false);
  const [perfMessage, setPerfMessage] = useState('');

  const selectedClass = classes.find((c) => c.id === classId);
  const alreadySaved = savedRecords.length > 0;
  // 2026-09-22 추가: 이 날짜에 '전체휴강' 처리된 세션인지 — 반 전체 학생이
  // 전부 'cancelled' 상태로 저장돼 있으면 휴강 세션으로 간주한다.
  const isCancelledSession = alreadySaved && savedRecords.every((r) => r.status === 'cancelled');

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

  useEffect(() => {
    if (!classId || !sessionDate) return;
    let cancelled = false;
    setHomeworkLoading(true);
    setHomeworkError('');
    fetchTodayHomeworkSummary(classId, sessionDate)
      .then((data) => {
        if (cancelled) return;
        setHomework(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setHomeworkError(err instanceof Error ? err.message : '과제 정보를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setHomeworkLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [classId, sessionDate]);

  useEffect(() => {
    if (!classId || !sessionDate) return;
    let cancelled = false;
    setPerfLoading(true);
    setPerfError('');
    setPerfEdits({});
    setPerfMessage('');
    fetchHomeworkPerformanceForSession(classId, sessionDate)
      .then((data) => {
        if (cancelled) return;
        setPerfSaved(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setPerfError(err instanceof Error ? err.message : '과제 수행도를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setPerfLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [classId, sessionDate]);

  const weekdayLabel = useMemo(() => {
    const d = new Date(`${sessionDate}T00:00:00`);
    return Number.isNaN(d.getTime()) ? '' : WEEKDAYS_KO[d.getDay()];
  }, [sessionDate]);
  const isTodaySelected = sessionDate === getLocalTodayStr();

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

  function getPerf(studentId: string): HomeworkPerformanceLevel {
    return perfEdits[studentId] ?? perfSaved[studentId] ?? '중';
  }

  function updatePerf(studentId: string, level: HomeworkPerformanceLevel) {
    setPerfEdits((prev) => ({ ...prev, [studentId]: level }));
  }

  async function handleSavePerf() {
    if (!selectedClass) return;
    // 2026-09-05: 결석 처리된 학생은 애초에 그날 수업이 없었으므로 과제
    // 수행도 저장 대상에서 제외한다(출결이 저장되어 있어야 걸러짐).
    // 2026-09-22: 휴강 처리된 날도 수업 자체가 없었던 거라 같은 이유로 제외.
    const recs = selectedClass.students
      .filter((s) => getStatus(s.id) !== 'absent' && getStatus(s.id) !== 'cancelled')
      .map((s) => ({ studentId: s.id, level: getPerf(s.id) }));
    setPerfSaving(true);
    setPerfMessage('');
    try {
      await saveHomeworkPerformanceForSession(classId, sessionDate, recs);
      setPerfSaved((prev) => {
        const next = { ...prev };
        for (const r of recs) next[r.studentId] = r.level;
        return next;
      });
      setPerfEdits({});
      setPerfMessage('과제 수행도가 저장되었습니다.');
    } catch (err) {
      setPerfMessage(err instanceof Error ? `저장 실패: ${err.message}` : '과제 수행도 저장에 실패했습니다.');
    } finally {
      setPerfSaving(false);
    }
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

  /**
   * 전체 휴강 처리 — 연휴·개인 사정 등으로 그날 수업 자체가 없었을 때, 학생
   * 개개인이 아니라 반 전체를 한 번에 '휴강'으로 표시한다(2026-09-22 사용자
   * 요청, 출석 관리 화면 옆 버튼). 결석과 달리 출석 통계에서 제외된다
   * (lib/attendance.ts fetchAttendanceHistory). 나중에 수업을 하게 되면 학생별로
   * 출석/지각/결석을 체크하고 '출석 저장'을 누르면 같은 (student_id, session_date)
   * 행이 upsert로 덮어써져서 자동으로 정상 출결로 바뀐다 — 별도의 '휴강 취소'
   * 버튼이 필요 없음.
   */
  async function handleCancelClass() {
    if (!selectedClass || selectedClass.students.length === 0) return;
    const ok = window.confirm(
      `${selectedClass.name} 수업 ${sessionDate}(${weekdayLabel})을 전체 휴강 처리하시겠습니까?\n` +
        `결석으로 기록되지 않고 출석 통계에서 제외됩니다.\n` +
        `나중에 수업을 하게 되면 학생별로 출석 체크 후 다시 저장하면 자동으로 정상 출결로 바뀝니다.`,
    );
    if (!ok) return;
    const recs: AttendanceRecord[] = selectedClass.students.map((s) => ({
      studentId: s.id,
      status: 'cancelled',
      note: '휴강',
    }));
    setSaving(true);
    setSaveMessage('');
    try {
      await saveAttendanceSession(classId, sessionDate, recs);
      setSavedRecords(recs);
      setRecords({});
      setSaveMessage(`${selectedClass.name} 수업 ${sessionDate}을(를) 휴강 처리했습니다.`);
    } catch (err) {
      setSaveMessage(err instanceof Error ? `저장 실패: ${err.message}` : '휴강 처리에 실패했습니다.');
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
            <div className={styles.dateRow}>
              <input
                type="date"
                className={styles.dateInput}
                value={sessionDate}
                onChange={(e) => setSessionDate(e.target.value)}
              />
              <button
                type="button"
                className={styles.todayButton}
                onClick={() => setSessionDate(getLocalTodayStr())}
                disabled={isTodaySelected}
              >
                오늘로
              </button>
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>&nbsp;</label>
            <button
              type="button"
              className={styles.cancelClassButton}
              onClick={handleCancelClass}
              disabled={saving || loading || !selectedClass || selectedClass.students.length === 0}
            >
              전체 휴강 처리
            </button>
          </div>
          <div className={isTodaySelected ? styles.weekdayCaption : styles.weekdayCaptionWarn}>
            선택 날짜: {sessionDate} ({weekdayLabel})
            {!isTodaySelected && ' — 오늘이 아닙니다, 확인해주세요'}
          </div>
        </div>

        {loading && <p className={styles.emptyText}>출석 기록을 불러오는 중입니다...</p>}
        {loadError && !loading && <p className={styles.emptyText}>불러오지 못했습니다: {loadError}</p>}

        {!loading && isCancelledSession && (
          <div className={styles.cancelBanner}>
            이 날짜({sessionDate})는 "{selectedClass?.name}" 수업 전체가 휴강 처리되어 있습니다. 수업을 하게
            되면 아래에서 학생별로 출석을 체크하고 저장하면 자동으로 정상 출결로 바뀝니다.
          </div>
        )}
        {!loading && alreadySaved && !isCancelledSession && (
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
                      {CHECK_STATUS_OPTIONS.map((opt) => (
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
        <h3 className={styles.cardTitle}>직전 수업 과제 (참고)</h3>
        {homeworkLoading ? (
          <p className={styles.emptyText}>과제 정보를 불러오는 중입니다...</p>
        ) : homeworkError ? (
          <p className={styles.emptyText}>불러오지 못했습니다: {homeworkError}</p>
        ) : homework ? (
          <>
            <div className={styles.refBox}>
              <strong>
                {homework.title} ({homework.assignedDate} 부여)
              </strong>
              <div>{homework.summary || '등록된 공통 항목이 없습니다.'}</div>
            </div>
            {homework.individual.length > 0 && (
              <div className={styles.refBox}>
                <strong>개별 과제</strong>
                {homework.individual.map((row) => (
                  <div key={row.studentName}>
                    {row.studentName}: {row.summary}
                  </div>
                ))}
              </div>
            )}
            <p className={styles.refCaption}>'과제 인증' 메뉴에서 등록·수정할 수 있습니다.</p>
          </>
        ) : (
          <p className={styles.emptyText}>
            등록된 과제가 없습니다. '과제 인증' 메뉴에서 등록해주세요.
          </p>
        )}
      </div>

      {/* 2026-09-05 추가: 과제 수행도(상/중/하) 체크 — 직전 수업 과제를 오늘
          얼마나 해왔는지 눈대중으로 체크하는 구 기능. 과제 "등록"(위 카드,
          과제 인증 메뉴 전용)과는 별개라서 리액트 전환 때도 그대로 남아있었어야
          했는데 빠져 있던 것을 복원함 — 학생 명부의 "과제 수행 이력"과 나중에
          월간 보고서에도 이 기록이 쓰인다. */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>과제 수행도 체크 (직전 과제 기준, 상/중/하)</h3>
        <p className={styles.emptyText}>결석 처리된 학생은 체크할 수 없습니다 — 출석 체크를 먼저 저장해주세요.</p>
        {perfLoading && <p className={styles.emptyText}>불러오는 중입니다...</p>}
        {perfError && !perfLoading && <p className={styles.emptyText}>불러오지 못했습니다: {perfError}</p>}
        {!perfLoading && (!selectedClass || selectedClass.students.length === 0) ? (
          <p className={styles.emptyText}>{selectedClass?.name ?? '선택한'} 수업에 배정된 학생이 없습니다.</p>
        ) : (
          !perfLoading &&
          selectedClass && (
            <>
              {selectedClass.students.map((s) => {
                const level = getPerf(s.id);
                // 2026-09-05: 오늘 결석 처리된 학생은 체크 자체를 막는다 —
                // 출석체크를 먼저 저장해야 반영됨(안 저장했으면 전원 활성 상태).
                // 2026-09-22: 휴강 처리된 날도 수업 자체가 없었던 거라 같은 이유로 막는다.
                const status = getStatus(s.id);
                const isAbsent = status === 'absent';
                const isCancelled = status === 'cancelled';
                return (
                  <div key={s.id} className={styles.studentRow}>
                    <span className={styles.studentName}>
                      {s.name}
                      {isAbsent && ' (결석)'}
                      {isCancelled && ' (휴강)'}
                    </span>
                    <div className={styles.radioGroup}>
                      {(['상', '중', '하'] as HomeworkPerformanceLevel[]).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          className={styles.radioBtn}
                          data-status={opt}
                          data-active={level === opt}
                          disabled={perfSaving || isAbsent || isCancelled}
                          onClick={() => updatePerf(s.id, opt)}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              <button type="button" className={styles.saveButton} onClick={handleSavePerf} disabled={perfSaving}>
                {perfSaving ? '저장 중...' : '과제 수행도 저장'}
              </button>
              {perfMessage && <p className={styles.successText}>{perfMessage}</p>}
            </>
          )
        )}
      </div>
    </>
  );
}
