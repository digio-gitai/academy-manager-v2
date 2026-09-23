import { useEffect, useMemo, useState } from 'react';
import type { ClassInfo } from '../../types/classManagement';
import type { AttendanceLogRow, AttendanceStatus } from '../../types/attendance';
import { fetchAttendanceHistory } from '../../lib/attendance';
import { fetchMakeupSessions, type MakeupSession } from '../../lib/makeup';
import {
  buildAttendanceReportDocument,
  collectStudentAttendance,
  type StudentAttendanceData,
  type AttendanceNoteKind,
} from '../../lib/attendanceReportHtml';
import { createReportLink, markReportSent, buildParentReportLinkText } from '../../lib/reportLinks';
import { sendBulkSms } from '../../lib/smsSend';
import { badgePalette } from '../dashboard/badgePalette';
import styles from './AttendanceHistoryPanel.module.css';

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: '출석',
  late: '지각',
  absent: '결석',
  cancelled: '휴강',
};

function toneForStatus(status: AttendanceStatus) {
  if (status === 'present') return badgePalette.green;
  if (status === 'late') return badgePalette.gold;
  return badgePalette.gray;
}

const KIND_TONE: Record<AttendanceNoteKind, { bg: string; color: string }> = {
  보강: { bg: '#2F7D5B', color: '#FFFFFF' },
  휴강: { bg: 'rgba(31,61,43,0.1)', color: '#1F3D2B' },
  지각: { bg: '#FBE9D7', color: '#9A5A1C' },
  결석: { bg: '#F6DEDA', color: '#C94B3C' },
  비고: { bg: '#F0E6D2', color: '#1F3D2B' },
};

const CLASS_FILTER_ALL = '전체 수업';
const STUDENT_FILTER_ALL = '';

interface AttendanceHistoryPanelProps {
  classes: ClassInfo[];
  monthLabel: string;
  fromDate: string;
  toDate: string;
}

interface CandidateStudent {
  id: string;
  name: string;
  className: string;
  parentPhone: string;
}

const WEEKDAY_KO_FULL = ['일', '월', '화', '수', '목', '금', '토'];

function parseYearMonth(fromDate: string): { year: number; month: number } {
  const [y, m] = fromDate.split('-').map(Number);
  return { year: y, month: m };
}

function buildMonthWeeks(year: number, month: number): (number | null)[][] {
  const daysInMonth = new Date(year, month, 0).getDate();
  const startWeekday = new Date(year, month - 1, 1).getDay();
  const weeks: (number | null)[][] = [];
  let week: (number | null)[] = new Array(startWeekday).fill(null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return String(err);
}

/**
 * 스트림릿 page_attendance()의 "출석 이력 및 통계" 탭을 이식한 화면.
 *
 * 2026-09-23: 반 단위 "출석부 인쇄"를 학생 단위 "출석 내역"으로 전환.
 *  - 학생 선택 필터(전체 학생이면 학생마다 한 장씩, A4 1페이지 기준으로 인쇄)
 *  - 휴강(사유 포함)·보강(보강 관리 탭 기록)을 통계와 캘린더에 반영하고,
 *    "확인이 필요한 기록"을 "보강 진행 및 기타"로 바꿔 보강 내용·휴강 사유·
 *    지각·결석·비고를 함께 보여줌
 *  - 같은 문서(attendanceReportHtml.ts)를 학부모에게 링크 문자로 발송
 * 인쇄는 화면 전체를 찍던 window.print() 대신 인쇄 전용 문서를 새 창에 열어서
 * 찍는다 — 앱 레이아웃 높이 때문에 빈 두 번째 페이지가 붙던 문제도 같이 해결.
 */
export function AttendanceHistoryPanel({ classes, monthLabel, fromDate, toDate }: AttendanceHistoryPanelProps) {
  const [classFilter, setClassFilter] = useState(CLASS_FILTER_ALL);
  const [studentFilter, setStudentFilter] = useState(STUDENT_FILTER_ALL);
  const [log, setLog] = useState<AttendanceLogRow[]>([]);
  const [makeups, setMakeups] = useState<MakeupSession[]>([]);
  const [makeupError, setMakeupError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState('');
  const [sendResult, setSendResult] = useState<{ ok: string[]; fails: string[] } | null>(null);
  // 학생별 확인 후 발송: 미리보기를 연 학생만 체크할 수 있고, 체크한 학생만 발송.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [sendIds, setSendIds] = useState<Set<string>>(new Set());

  function resetSendState() {
    setSendResult(null);
    setPreviewId(null);
    setReviewedIds(new Set());
    setSendIds(new Set());
  }

  const selectedClassId = classFilter === CLASS_FILTER_ALL ? null : classFilter;
  const classLabel =
    classFilter === CLASS_FILTER_ALL ? CLASS_FILTER_ALL : classes.find((c) => c.id === classFilter)?.name ?? classFilter;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setMakeupError('');
    Promise.all([
      fetchAttendanceHistory(fromDate, toDate, selectedClassId),
      fetchMakeupSessions(fromDate, toDate).catch((err) => {
        // 보강 테이블이 아직 없어도(SQL 미실행) 출석 내역은 그대로 보이게.
        if (!cancelled) setMakeupError(describeError(err));
        return [] as MakeupSession[];
      }),
    ])
      .then(([{ log: logData }, makeupData]) => {
        if (cancelled) return;
        setLog(logData);
        setMakeups(makeupData);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(describeError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fromDate, toDate, selectedClassId]);

  const { year, month } = useMemo(() => parseYearMonth(fromDate), [fromDate]);
  const monthWeeks = useMemo(() => buildMonthWeeks(year, month), [year, month]);

  /** 선택 가능한 학생 — 수업 필터에 맞는 반 명부 + 명부에 없지만 이번 달 출결 기록이 있는 학생. */
  const candidates = useMemo(() => {
    const map = new Map<string, CandidateStudent>();
    for (const c of classes) {
      if (selectedClassId && c.id !== selectedClassId) continue;
      for (const st of c.students) {
        if (!map.has(st.id)) map.set(st.id, { id: st.id, name: st.name, className: c.name, parentPhone: st.parentPhone });
      }
    }
    for (const r of log) {
      if (!map.has(r.studentId)) map.set(r.studentId, { id: r.studentId, name: r.studentName, className: r.className, parentPhone: '' });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [classes, selectedClassId, log]);

  const selectedStudent = candidates.find((st) => st.id === studentFilter) ?? null;

  /** 화면·인쇄·발송에 공통으로 쓰는 학생별 한 달 데이터(기록 없는 학생은 제외). */
  const studentData = useMemo(() => {
    const targets = selectedStudent ? [selectedStudent] : candidates;
    const out: { student: CandidateStudent; data: StudentAttendanceData }[] = [];
    for (const st of targets) {
      const data = collectStudentAttendance(st, log, makeups, year, month);
      if (data) out.push({ student: st, data });
    }
    return out;
  }, [selectedStudent, candidates, log, makeups, year, month]);

  const viewLog = useMemo(
    () => (studentFilter ? log.filter((r) => r.studentId === studentFilter) : log),
    [log, studentFilter],
  );

  /** "보강 진행 및 기타" 화면 목록 — 같은 날·같은 내용(반 전체 휴강, 여러 명 보강)은 한 줄로 묶음. */
  const noteRows = useMemo(() => {
    const map = new Map<string, { date: string; weekday: string; kind: AttendanceNoteKind; text: string; names: string[] }>();
    for (const { student, data } of studentData) {
      for (const n of data.notes) {
        const key = `${n.date}|${n.kind}|${n.text}`;
        const row = map.get(key) ?? { ...n, names: [] };
        row.names.push(student.name);
        map.set(key, row);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [studentData]);

  function openDocument(html: string) {
    const w = window.open('', '_blank');
    if (!w) {
      window.alert('팝업이 차단되었습니다. 브라우저 주소창 오른쪽의 팝업 차단 아이콘에서 허용해 주세요.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function handlePrint() {
    if (studentData.length === 0) return;
    openDocument(buildAttendanceReportDocument(studentData.map((s) => s.data), { autoPrint: true }));
  }

  function togglePreview(id: string) {
    setPreviewId((cur) => (cur === id ? null : id));
    setReviewedIds((prev) => new Set(prev).add(id));
  }

  function toggleSend(id: string) {
    setSendIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function sendToParent(st: CandidateStudent, data: StudentAttendanceData): Promise<void> {
    const phone = st.parentPhone.trim();
    if (!phone) throw new Error('보호자 연락처 없음');
    const token = await createReportLink({
      html: buildAttendanceReportDocument([data]),
      studentName: st.name,
      studentId: st.id,
      testType: '출석내역',
      testDate: todayStr(),
      testName: `${monthLabel} 출석 내역`,
    });
    const text = buildParentReportLinkText({ studentName: st.name, token, reportType: `${month}월 출석 내역` });
    const result = await sendBulkSms([{ name: st.name, phone, studentId: st.id }], text, 'report');
    if (result.succeeded < 1) throw new Error(result.skipped[0]?.reason ?? '발송 실패');
    await markReportSent(token).catch(() => {});
  }

  const sendTargets = studentData.filter(({ student }) => sendIds.has(student.id));

  async function handleSend() {
    if (sendTargets.length === 0) return;
    const names = sendTargets.map(({ student }) => student.name).join(', ');
    if (!window.confirm(`${monthLabel} 출석 내역을 ${sendTargets.length}명(${names}) 학부모님께 문자로 보냅니다. 계속할까요?`)) return;

    setSending(true);
    setSendResult(null);
    const ok: string[] = [];
    const fails: string[] = [];
    for (let i = 0; i < sendTargets.length; i++) {
      const { student, data } = sendTargets[i];
      setSendProgress(`문자 발송 중... (${i + 1}/${sendTargets.length}명)`);
      try {
        await sendToParent(student, data);
        ok.push(student.name);
      } catch (err) {
        fails.push(`${student.name}: ${describeError(err)}`);
      }
    }
    setSendProgress('');
    setSending(false);
    setSendResult({ ok, fails });
    setSendIds((prev) => {
      const next = new Set(prev);
      for (const { student } of sendTargets) if (ok.includes(student.name)) next.delete(student.id);
      return next;
    });
  }

  const previewData = studentData.find(({ student }) => student.id === previewId)?.data ?? null;
  const previewHtml = useMemo(() => (previewData ? buildAttendanceReportDocument([previewData]) : ''), [previewData]);

  const targetLabel = selectedStudent ? `${selectedStudent.name} 학생` : `${classLabel} 학생 ${studentData.length}명`;

  return (
    <>
      <div className={styles.card}>
        <div className={styles.controlRow}>
          <div className={styles.field}>
            <label className={styles.label}>수업 필터</label>
            <select
              className={styles.selectInput}
              value={classFilter}
              onChange={(e) => {
                setClassFilter(e.target.value);
                setStudentFilter(STUDENT_FILTER_ALL);
                resetSendState();
              }}
            >
              <option value={CLASS_FILTER_ALL}>{CLASS_FILTER_ALL}</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>학생 선택</label>
            <select
              className={styles.selectInput}
              value={studentFilter}
              onChange={(e) => {
                setStudentFilter(e.target.value);
                resetSendState();
              }}
            >
              <option value={STUDENT_FILTER_ALL}>전체 학생</option>
              {candidates.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name} · {st.className}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.rangeCaption}>조회 기간: {monthLabel}</div>
        </div>
      </div>

      {loading && <p className={styles.emptyText}>출석 이력을 불러오는 중입니다...</p>}
      {loadError && !loading && <p className={styles.emptyText}>불러오지 못했습니다: {loadError}</p>}

      {!loading && !loadError && (
        <>
          <div className={styles.card}>
            <h3 className={styles.cardTitle}>출석 내역 내보내기</h3>
            <p className={styles.emptyText}>
              {targetLabel}의 {monthLabel} 출석 내역을 학생마다 A4 한 장으로 인쇄합니다. 인쇄창에서 "PDF로 저장"을
              고르면 PDF 파일로 받을 수 있습니다. 학부모 문자는 아래 "학부모 문자 보내기"에서 학생별로 확인 후 보냅니다.
            </p>
            <div className={styles.exportActions}>
              <button type="button" className={styles.pdfButton} onClick={handlePrint} disabled={studentData.length === 0}>
                출석 내역 인쇄 (PDF)
              </button>
            </div>
            {studentData.length === 0 && (
              <p className={styles.emptyText} style={{ marginTop: 8 }}>
                이번 달 출결·보강 기록이 없어 내보낼 내역이 없습니다.
              </p>
            )}
            {makeupError && (
              <p className={styles.errorNotice}>
                보강 기록을 불러오지 못해 보강은 빠진 채로 표시됩니다 (보강 테이블 SQL 실행 여부 확인): {makeupError}
              </p>
            )}
          </div>

          {studentData.length > 0 && (
            <div className={styles.card}>
              <h3 className={styles.cardTitle}>📱 학부모 문자 보내기</h3>
              <p className={styles.emptyText}>
                학생마다 👁️ 미리보기로 학부모가 받을 화면을 확인한 뒤 "확인 · 발송"에 체크하세요. 체크한 학생에게만
                문자가 나갑니다.
              </p>
              <div className={styles.sendList}>
                {studentData.map(({ student, data }) => {
                  const reviewed = reviewedIds.has(student.id);
                  const hasPhone = student.parentPhone.trim() !== '';
                  return (
                    <div key={student.id} className={styles.sendRow}>
                      <span className={styles.sendName}>
                        {student.name} <span className={styles.sendMeta}>· {data.className}</span>
                      </span>
                      <span className={hasPhone ? styles.sendMeta : styles.sendWarn}>
                        {hasPhone ? student.parentPhone : '보호자 연락처 없음'}
                      </span>
                      <div className={styles.sendActions}>
                        <button type="button" className={styles.smallButton} onClick={() => togglePreview(student.id)}>
                          {previewId === student.id ? '미리보기 닫기' : '👁️ 미리보기'}
                        </button>
                        <label
                          className={styles.sendCheck}
                          title={!reviewed ? '미리보기로 먼저 확인해 주세요' : !hasPhone ? '보호자 연락처가 없습니다' : ''}
                        >
                          <input
                            type="checkbox"
                            checked={sendIds.has(student.id)}
                            disabled={!reviewed || !hasPhone || sending}
                            onChange={() => toggleSend(student.id)}
                          />
                          확인 · 발송
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>

              {previewHtml && (
                <iframe title="학부모용 출석 내역 미리보기" srcDoc={previewHtml} className={styles.previewFrame} />
              )}

              <button
                type="button"
                className={styles.pdfButton}
                style={{ marginTop: 12 }}
                onClick={handleSend}
                disabled={sending || sendTargets.length === 0}
              >
                {sending ? sendProgress : `📤 확인한 ${sendTargets.length}명 학부모에게 문자 발송`}
              </button>
              {sendResult && (
                <>
                  {sendResult.ok.length > 0 && (
                    <p className={styles.downloadNotice}>
                      ✅ {sendResult.ok.length}명 발송 완료 ({sendResult.ok.join(', ')})
                    </p>
                  )}
                  {sendResult.fails.map((m) => (
                    <p key={m} className={styles.errorNotice}>
                      {m}
                    </p>
                  ))}
                </>
              )}
            </div>
          )}

          <div className={styles.card}>
            <h3 className={styles.cardTitle}>학생별 출석 통계</h3>
            {studentData.length === 0 ? (
              <p className={styles.emptyText}>해당 기간에 출결 기록이 없습니다.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>학생</th>
                      <th>수업</th>
                      <th>출석</th>
                      <th>지각</th>
                      <th>결석</th>
                      <th>휴강</th>
                      <th>보강</th>
                      <th>출석률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentData.flatMap(({ student, data }) =>
                      data.stats.map((s) => (
                        <tr key={`${student.id}_${s.className}`}>
                          <td>{student.name}</td>
                          <td>{s.className}</td>
                          <td>{s.present}</td>
                          <td>{s.late}</td>
                          <td>{s.absent}</td>
                          <td>{s.cancelled}</td>
                          <td>{s.makeup}</td>
                          <td>{s.rate != null ? `${s.rate}%` : '—'}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className={styles.card}>
            <h3 className={styles.cardTitle}>학생별 출석 캘린더</h3>
            {studentData.length === 0 ? (
              <p className={styles.emptyText}>해당 기간에 출결 기록이 없습니다.</p>
            ) : (
              <div className={styles.calendarGrid}>
                {studentData.map(({ student, data }) => {
                  const makeupDays = new Set(data.makeupDays);
                  return (
                    <div className={styles.calendarCard} key={student.id}>
                      <div className={styles.calendarCardHeader}>
                        <strong>{student.name}</strong>
                        <span>{data.className}</span>
                      </div>
                      <table className={styles.calendarTable}>
                        <thead>
                          <tr>
                            {WEEKDAY_KO_FULL.map((w) => (
                              <th key={w}>{w}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {monthWeeks.map((week, wi) => (
                            <tr key={wi}>
                              {week.map((day, di) => {
                                if (day == null) return <td key={di} />;
                                return (
                                  <td key={di}>
                                    <span className={styles.dayCell} data-status={data.dayStatus[day] ?? 'none'}>
                                      {day}
                                    </span>
                                    {makeupDays.has(day) && <span className={styles.makeupMark}>보강</span>}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className={styles.card}>
            <h3 className={styles.cardTitle}>보강 진행 및 기타</h3>
            {noteRows.length === 0 ? (
              <p className={styles.emptyText}>해당 사항 없음 — 보강·휴강 없이 정상 수업했습니다.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>날짜</th>
                      <th>구분</th>
                      <th>학생</th>
                      <th>내용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {noteRows.map((row) => {
                      const tone = KIND_TONE[row.kind];
                      return (
                        <tr key={`${row.date}_${row.kind}_${row.text}`}>
                          <td>
                            {row.date} ({row.weekday})
                          </td>
                          <td>
                            <span className={styles.statusTag} style={{ background: tone.bg, color: tone.color }}>
                              {row.kind}
                            </span>
                          </td>
                          <td>{row.names.join(', ')}</td>
                          <td>{row.text || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className={styles.card}>
            <h3 className={styles.cardTitle}>세션별 출석 로그</h3>
            {viewLog.length === 0 ? (
              <p className={styles.emptyText}>해당 기간에 출결 기록이 없습니다.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>날짜</th>
                      <th>학생</th>
                      <th>수업</th>
                      <th>상태</th>
                      <th>비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewLog.map((row, i) => {
                      const tone = toneForStatus(row.status);
                      return (
                        <tr key={i}>
                          <td>
                            {row.date} ({row.weekday})
                          </td>
                          <td>{row.studentName}</td>
                          <td>{row.className}</td>
                          <td>
                            <span
                              className={styles.statusTag}
                              style={{ background: tone.badgeBg, color: tone.badgeColor }}
                            >
                              {STATUS_LABELS[row.status]}
                            </span>
                          </td>
                          <td>{row.note || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
