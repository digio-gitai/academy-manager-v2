import { useEffect, useMemo, useState } from 'react';
import type { ClassInfo } from '../../types/classManagement';
import type { AttendanceStatsRow, AttendanceLogRow, AttendanceStatus } from '../../types/attendance';
import { fetchAttendanceHistory } from '../../lib/attendance';
import { buildAttendanceReportHtml } from '../../lib/attendanceReportHtml';
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

const CLASS_FILTER_ALL = '전체 수업';
const STUDENT_FILTER_ALL = '';

interface RosterStudent {
  id: string;
  name: string;
  className: string;
  parentPhone: string;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return String(err);
}

interface AttendanceHistoryPanelProps {
  classes: ClassInfo[];
  monthLabel: string;
  fromDate: string;
  toDate: string;
}

const WEEKDAY_KO_FULL = ['일', '월', '화', '수', '목', '금', '토'];

/** "YYYY-MM-01" 형태인 fromDate에서 연/월 숫자를 뽑아낸다. */
function parseYearMonth(fromDate: string): { year: number; month: number } {
  const [y, m] = fromDate.split('-').map(Number);
  return { year: y, month: m };
}

/** 달력 그리드용 주 단위 배열(일요일 시작). 그 달에 속하지 않는 칸은 null. */
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

/**
 * 스트림릿 page_attendance()의 "출석 이력 및 통계" 탭과 동일한 기능:
 * 학생별 출석 통계 + 학생별 출석 캘린더 + 확인이 필요한 기록(지각·결석·비고)
 * + 세션별 출석 로그 + 출석 내역 인쇄(PDF).
 *
 * 2026-09-23: 반 단위 "출석부 인쇄"를 "출석 내역 인쇄"로 바꾸고 학생 선택 필터 추가.
 * 학생별 출석 내역을 학부모용 페이지(attendanceReportHtml.ts)로 만들어 성적 보고서와
 * 같은 방식(report_links 저장 → /parent-report 링크 문자)으로 보낼 수 있게 함.
 *
 * 2026-08-24부터: 통계/로그 전부 실제 dev DB(Supabase) 연동
 * (lib/attendance.ts의 fetchAttendanceHistory가 원본 스트림릿의
 * get_attendance_summary()/get_attendance_history()를 화면단 계산으로 재현).
 *
 * 2026-09-11: 원본 스트림릿의 fpdf2 PDF(generate_attendance_pdf_bytes, ①학생별
 * 통계 ②학생별 출석 캘린더 ③확인이 필요한 기록 3단 구성)가 React 쪽엔 아예
 * 없고 "출석부 인쇄 (PDF)" 버튼도 데모 문구만 띄우는 가짜였음(사용자가 실사용
 * 중 발견). 서버 쪽 PDF 생성기(fpdf2+한글폰트)를 그대로 옮기는 대신, 이
 * 프로젝트에서 이미 쓰고 있는 방식(AttendanceSheetPanel의 window.print(),
 * 성적 리포트의 인쇄용 HTML)과 동일하게 브라우저 인쇄 → "PDF로 저장"으로
 * 대체함. [data-print-root] 인쇄 격리는 index.css의 전역 규칙 참고.
 */
export function AttendanceHistoryPanel({ classes, monthLabel, fromDate, toDate }: AttendanceHistoryPanelProps) {
  const [classFilter, setClassFilter] = useState(CLASS_FILTER_ALL);
  const [studentFilter, setStudentFilter] = useState(STUDENT_FILTER_ALL);
  const [stats, setStats] = useState<AttendanceStatsRow[]>([]);
  const [log, setLog] = useState<AttendanceLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState('');
  const [sendResult, setSendResult] = useState<{ ok: string[]; fails: string[] } | null>(null);

  const selectedClassId = useMemo(
    () => (classFilter === CLASS_FILTER_ALL ? null : classFilter),
    [classFilter],
  );

  const classLabel = useMemo(
    () => (classFilter === CLASS_FILTER_ALL ? CLASS_FILTER_ALL : classes.find((c) => c.id === classFilter)?.name ?? classFilter),
    [classFilter, classes],
  );

  /** 학생 선택 목록 — 수업 필터에 맞는 반 명부(같은 학생이 여러 반이면 한 번만). */
  const rosterStudents = useMemo(() => {
    const seen = new Map<string, RosterStudent>();
    for (const c of classes) {
      if (selectedClassId && c.id !== selectedClassId) continue;
      for (const st of c.students) {
        if (!seen.has(st.id)) seen.set(st.id, { id: st.id, name: st.name, className: c.name, parentPhone: st.parentPhone });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [classes, selectedClassId]);

  const selectedStudent = rosterStudents.find((st) => st.id === studentFilter) ?? null;
  const viewStats = useMemo(
    () => (studentFilter ? stats.filter((r) => r.studentId === studentFilter) : stats),
    [stats, studentFilter],
  );
  const viewLog = useMemo(
    () => (studentFilter ? log.filter((r) => r.studentId === studentFilter) : log),
    [log, studentFilter],
  );
  const printLabel = selectedStudent ? `${selectedStudent.name} 학생` : classLabel;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    fetchAttendanceHistory(fromDate, toDate, selectedClassId)
      .then(({ stats: statsData, log: logData }) => {
        if (cancelled) return;
        setStats(statsData);
        setLog(logData);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : '출석 이력을 불러오지 못했습니다.');
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

  /** 학생(+반)별로 그 달 날짜별 출석 상태를 모은다 — 통계 표와 같은 키(이름_반)로 묶음. */
  const calendarGroups = useMemo(() => {
    const map = new Map<string, { studentName: string; className: string; dayStatus: Map<number, AttendanceStatus> }>();
    for (const row of viewLog) {
      const key = `${row.studentName}_${row.className}`;
      let group = map.get(key);
      if (!group) {
        group = { studentName: row.studentName, className: row.className, dayStatus: new Map() };
        map.set(key, group);
      }
      const day = Number(row.date.slice(8, 10));
      if (!Number.isNaN(day)) group.dayStatus.set(day, row.status);
    }
    return Array.from(map.values()).sort((a, b) => a.studentName.localeCompare(b.studentName, 'ko'));
  }, [viewLog]);

  /** 지각·결석·비고가 있는 기록만 모음 — 원본 스트림릿 PDF의 "확인이 필요한 기록"과 동일한 필터. */
  const exceptions = useMemo(
    () => viewLog.filter((row) => row.status !== 'present' || row.note.trim() !== '').sort((a, b) => a.date.localeCompare(b.date)),
    [viewLog],
  );

  function handlePrint() {
    window.print();
  }

  /** 학생 1명의 이번 달 출석 내역 학부모용 HTML — 기록이 하나도 없으면 null. */
  function buildStudentReport(st: RosterStudent): string | null {
    const rows = log.filter((r) => r.studentId === st.id);
    if (rows.length === 0) return null;
    const dayStatus: Record<number, AttendanceStatus> = {};
    let present = 0;
    let late = 0;
    let absent = 0;
    for (const r of rows) {
      const day = Number(r.date.slice(8, 10));
      if (!Number.isNaN(day)) dayStatus[day] = r.status;
      if (r.status === 'present') present += 1;
      else if (r.status === 'late') late += 1;
      else if (r.status === 'absent') absent += 1;
    }
    const total = present + late + absent;
    return buildAttendanceReportHtml({
      studentName: st.name,
      className: st.className,
      year,
      month,
      present,
      late,
      absent,
      rate: total ? ((present + late) / total) * 100 : null,
      dayStatus,
      notes: rows
        .filter((r) => r.status !== 'present' || r.note.trim() !== '')
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => ({ date: r.date, weekday: r.weekday, status: r.status, note: r.note.trim() })),
    });
  }

  function handlePreview() {
    if (!selectedStudent) return;
    const html = buildStudentReport(selectedStudent);
    if (!html) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  async function sendToParent(st: RosterStudent): Promise<void> {
    const phone = st.parentPhone.trim();
    if (!phone) throw new Error('보호자 연락처 없음');
    const html = buildStudentReport(st);
    if (!html) throw new Error('이번 달 출결 기록 없음');
    const token = await createReportLink({
      html,
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

  const sendTargets = selectedStudent
    ? [selectedStudent]
    : rosterStudents.filter((st) => log.some((r) => r.studentId === st.id));

  async function handleSend() {
    if (sendTargets.length === 0) return;
    const who = selectedStudent ? `${selectedStudent.name} 학생` : `${classLabel} 학생 ${sendTargets.length}명`;
    if (!window.confirm(`${who}의 ${monthLabel} 출석 내역을 학부모님께 문자로 보냅니다. 계속할까요?`)) return;

    setSending(true);
    setSendResult(null);
    const ok: string[] = [];
    const fails: string[] = [];
    for (let i = 0; i < sendTargets.length; i++) {
      const st = sendTargets[i];
      setSendProgress(`문자 발송 중... (${i + 1}/${sendTargets.length}명)`);
      try {
        await sendToParent(st);
        ok.push(st.name);
      } catch (err) {
        fails.push(`${st.name}: ${describeError(err)}`);
      }
    }
    setSendProgress('');
    setSending(false);
    setSendResult({ ok, fails });
  }

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
                setSendResult(null);
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
                setSendResult(null);
              }}
            >
              <option value={STUDENT_FILTER_ALL}>전체 학생</option>
              {rosterStudents.map((st) => (
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
              {selectedStudent ? `${selectedStudent.name} 학생` : `${classLabel} 전체 학생`}의 {monthLabel} 출석 통계 · 출석
              캘린더 · 확인이 필요한 기록을 인쇄하거나, 학부모님께 문자(열람 링크)로 보냅니다. 인쇄창에서 "PDF로
              저장"을 선택하면 PDF 파일로도 받을 수 있습니다.
            </p>
            <div className={styles.exportActions}>
              <button type="button" className={styles.pdfButton} onClick={handlePrint}>
                출석 내역 인쇄 (PDF)
              </button>
              {selectedStudent && (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={handlePreview}
                  disabled={viewLog.length === 0}
                >
                  👁️ 학부모용 화면 미리보기
                </button>
              )}
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={handleSend}
                disabled={sending || sendTargets.length === 0}
              >
                {sending
                  ? sendProgress
                  : selectedStudent
                  ? '📱 학부모에게 문자로 보내기'
                  : `📱 학부모 전원에게 문자로 보내기 (${sendTargets.length}명)`}
              </button>
            </div>
            {sendTargets.length === 0 && (
              <p className={styles.emptyText} style={{ marginTop: 8 }}>
                이번 달 출결 기록이 없어 보낼 내역이 없습니다.
              </p>
            )}
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

          {/* data-print-root: 인쇄 시 이 영역만 보이고 나머지(사이드바·탭·필터 등)는
              index.css 전역 규칙에 의해 자동으로 감춰진다. */}
          <div data-print-root="true">
            <div className={`${styles.printOnly} ${styles.printHeader}`}>
              <div className={styles.printTitle}>{printLabel} 출석 내역</div>
              <div className={styles.printSubtitle}>
                {monthLabel} · 생성일 {todayStr()}
              </div>
            </div>

            <div className={styles.card}>
              <h3 className={styles.cardTitle}>학생별 출석 통계</h3>
              {viewStats.length === 0 ? (
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
                        <th>출석률</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewStats.map((row, i) => (
                        <tr key={i}>
                          <td>{row.studentName}</td>
                          <td>{row.className}</td>
                          <td>{row.present}</td>
                          <td>{row.late}</td>
                          <td>{row.absent}</td>
                          <td>{row.attendanceRate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className={styles.card}>
              <h3 className={styles.cardTitle}>학생별 출석 캘린더</h3>
              {calendarGroups.length === 0 ? (
                <p className={styles.emptyText}>해당 기간에 출결 기록이 없습니다.</p>
              ) : (
                <div className={styles.calendarGrid}>
                  {calendarGroups.map((g) => {
                    const stat = viewStats.find((s) => s.studentName === g.studentName && s.className === g.className);
                    return (
                      <div className={styles.calendarCard} key={`${g.studentName}_${g.className}`}>
                        <div className={styles.calendarCardHeader}>
                          <strong>{g.studentName}</strong>
                          <span>{g.className}</span>
                        </div>
                        {stat && (
                          <div className={styles.calendarStatLine}>
                            출석 {stat.present} · 지각 {stat.late} · 결석 {stat.absent} · 출석률 {stat.attendanceRate}%
                          </div>
                        )}
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
                                  const status = g.dayStatus.get(day);
                                  return (
                                    <td key={di}>
                                      <span className={styles.dayCell} data-status={status ?? 'none'}>
                                        {day}
                                      </span>
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
              <h3 className={styles.cardTitle}>확인이 필요한 기록 (지각·결석·비고)</h3>
              {exceptions.length === 0 ? (
                <p className={styles.emptyText}>해당 사항 없음 — 전원 정상 출석했습니다.</p>
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
                      {exceptions.map((row, i) => {
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
