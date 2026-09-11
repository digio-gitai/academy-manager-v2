import { useEffect, useMemo, useState } from 'react';
import type { ClassInfo } from '../../types/classManagement';
import type { AttendanceStatsRow, AttendanceLogRow, AttendanceStatus } from '../../types/attendance';
import { fetchAttendanceHistory } from '../../lib/attendance';
import { badgePalette } from '../dashboard/badgePalette';
import styles from './AttendanceHistoryPanel.module.css';

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: '출석',
  late: '지각',
  absent: '결석',
};

function toneForStatus(status: AttendanceStatus) {
  if (status === 'present') return badgePalette.green;
  if (status === 'late') return badgePalette.gold;
  return badgePalette.gray;
}

const CLASS_FILTER_ALL = '전체 수업';

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
 * + 세션별 출석 로그 + 출석부 인쇄(PDF).
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
  const [stats, setStats] = useState<AttendanceStatsRow[]>([]);
  const [log, setLog] = useState<AttendanceLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const selectedClassId = useMemo(
    () => (classFilter === CLASS_FILTER_ALL ? null : classFilter),
    [classFilter],
  );

  const classLabel = useMemo(
    () => (classFilter === CLASS_FILTER_ALL ? CLASS_FILTER_ALL : classes.find((c) => c.id === classFilter)?.name ?? classFilter),
    [classFilter, classes],
  );

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
    for (const row of log) {
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
  }, [log]);

  /** 지각·결석·비고가 있는 기록만 모음 — 원본 스트림릿 PDF의 "확인이 필요한 기록"과 동일한 필터. */
  const exceptions = useMemo(
    () => log.filter((row) => row.status !== 'present' || row.note.trim() !== '').sort((a, b) => a.date.localeCompare(b.date)),
    [log],
  );

  function handlePrint() {
    window.print();
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
              onChange={(e) => setClassFilter(e.target.value)}
            >
              <option value={CLASS_FILTER_ALL}>{CLASS_FILTER_ALL}</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
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
            <h3 className={styles.cardTitle}>출석부 내보내기</h3>
            <p className={styles.emptyText}>
              아래 "학생별 출석 통계 · 출석 캘린더 · 확인이 필요한 기록"을 인쇄합니다. 브라우저 인쇄창에서
              "PDF로 저장"을 선택하면 PDF 파일로도 받을 수 있습니다.
            </p>
            <button type="button" className={styles.pdfButton} onClick={handlePrint}>
              출석부 인쇄 (PDF)
            </button>
          </div>

          {/* data-print-root: 인쇄 시 이 영역만 보이고 나머지(사이드바·탭·필터 등)는
              index.css 전역 규칙에 의해 자동으로 감춰진다. */}
          <div data-print-root="true">
            <div className={`${styles.printOnly} ${styles.printHeader}`}>
              <div className={styles.printTitle}>{classLabel} 출석부</div>
              <div className={styles.printSubtitle}>
                {monthLabel} · 생성일 {todayStr()}
              </div>
            </div>

            <div className={styles.card}>
              <h3 className={styles.cardTitle}>학생별 출석 통계</h3>
              {stats.length === 0 ? (
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
                      {stats.map((row, i) => (
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
                    const stat = stats.find((s) => s.studentName === g.studentName && s.className === g.className);
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
            {log.length === 0 ? (
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
                    {log.map((row, i) => {
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
