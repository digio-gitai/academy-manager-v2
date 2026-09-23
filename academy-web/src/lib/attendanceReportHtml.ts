import type { AttendanceLogRow, AttendanceStatus } from '../types/attendance';
import type { MakeupSession } from './makeup';

/**
 * 학생 1명 · 한 달 "출석 내역" 문서(A4 1장). 출석 관리 화면의 기존 출석부 인쇄
 * 디자인(녹색·골드, 통계 → 캘린더 → 기록 순)을 그대로 따르되 반 단위가 아니라
 * 학생 단위로 한 페이지씩 나오게 만든 것. 같은 HTML을 인쇄(여러 명이면 학생마다
 * 한 페이지)와 학부모 문자 링크(report_links → /parent-report) 양쪽에 쓴다.
 */

const C = {
  primary: '#1F3D2B',
  accent: '#C9A961',
  late: '#E08A3C',
  absent: '#C94B3C',
  makeup: '#2F7D5B',
  muted: 'rgba(31,61,43,0.6)',
  faint: 'rgba(31,61,43,0.45)',
  border: 'rgba(31,61,43,0.12)',
  pageBg: '#EFEAE0',
  tint: '#F0E6D2',
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export type AttendanceNoteKind = '보강' | '휴강' | '지각' | '결석' | '비고';

export interface AttendanceStatLine {
  className: string;
  present: number;
  late: number;
  absent: number;
  cancelled: number;
  makeup: number;
  rate: number | null;
}

export interface StudentAttendanceData {
  studentName: string;
  className: string;
  year: number;
  month: number;
  stats: AttendanceStatLine[];
  dayStatus: Record<number, AttendanceStatus>;
  makeupDays: number[];
  notes: { date: string; weekday: string; kind: AttendanceNoteKind; text: string }[];
}

const KIND_ORDER: AttendanceNoteKind[] = ['휴강', '보강', '결석', '지각', '비고'];

function weekdayOf(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : WEEKDAYS[d.getDay()];
}

/**
 * 한 학생의 한 달 출결 로그 + 보강 기록을 문서용 데이터로 모은다.
 * 출결도 보강도 하나도 없으면 null(보낼·인쇄할 내용이 없음).
 */
export function collectStudentAttendance(
  student: { id: string; name: string; className: string },
  log: AttendanceLogRow[],
  makeups: MakeupSession[],
  year: number,
  month: number,
): StudentAttendanceData | null {
  const rows = log.filter((r) => r.studentId === student.id);
  const myMakeups = makeups.filter((m) => m.students.some((s) => s.id === student.id));
  if (rows.length === 0 && myMakeups.length === 0) return null;

  const byClass = new Map<string, AttendanceStatLine>();
  const line = (className: string) => {
    let l = byClass.get(className);
    if (!l) {
      l = { className, present: 0, late: 0, absent: 0, cancelled: 0, makeup: 0, rate: null };
      byClass.set(className, l);
    }
    return l;
  };

  const dayStatus: Record<number, AttendanceStatus> = {};
  const notes: StudentAttendanceData['notes'] = [];
  for (const r of rows) {
    const l = line(r.className);
    if (r.status === 'present') l.present += 1;
    else if (r.status === 'late') l.late += 1;
    else if (r.status === 'absent') l.absent += 1;
    else l.cancelled += 1;
    const day = Number(r.date.slice(8, 10));
    if (!Number.isNaN(day)) dayStatus[day] = r.status;

    const note = r.note.trim();
    if (r.status === 'cancelled') notes.push({ date: r.date, weekday: r.weekday, kind: '휴강', text: note || '휴강' });
    else if (r.status === 'late') notes.push({ date: r.date, weekday: r.weekday, kind: '지각', text: note });
    else if (r.status === 'absent') notes.push({ date: r.date, weekday: r.weekday, kind: '결석', text: note });
    else if (note) notes.push({ date: r.date, weekday: r.weekday, kind: '비고', text: note });
  }

  const makeupDays: number[] = [];
  for (const m of myMakeups) {
    const target = byClass.has(m.className) ? m.className : (byClass.keys().next().value ?? student.className);
    line(target).makeup += 1;
    const day = Number(m.date.slice(8, 10));
    if (!Number.isNaN(day)) makeupDays.push(day);
    notes.push({ date: m.date, weekday: weekdayOf(m.date), kind: '보강', text: m.content || '보강 수업' });
  }

  for (const l of byClass.values()) {
    const total = l.present + l.late + l.absent;
    l.rate = total ? Math.round(((l.present + l.late) / total) * 1000) / 10 : null;
  }
  notes.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

  const stats = Array.from(byClass.values());
  return {
    studentName: student.name,
    className: stats.map((s) => s.className).join(', ') || student.className,
    year,
    month,
    stats,
    dayStatus,
    makeupDays,
    notes,
  };
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function calendarHtml(d: StudentAttendanceData): string {
  const daysInMonth = new Date(d.year, d.month, 0).getDate();
  const start = new Date(d.year, d.month - 1, 1).getDay();
  const makeup = new Set(d.makeupDays);
  const cells: string[] = [];
  for (let i = 0; i < start; i++) cells.push('<td></td>');
  for (let day = 1; day <= daysInMonth; day++) {
    const st = d.dayStatus[day];
    const mk = makeup.has(day);
    cells.push(
      `<td><span class="day" data-status="${st ?? 'none'}">${day}</span>${mk ? '<span class="mk">보강</span>' : ''}</td>`,
    );
  }
  while (cells.length % 7 !== 0) cells.push('<td></td>');
  const weeks: string[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(`<tr>${cells.slice(i, i + 7).join('')}</tr>`);
  return `<table class="cal"><thead><tr>${WEEKDAYS.map((w) => `<th>${w}</th>`).join('')}</tr></thead><tbody>${weeks.join('')}</tbody></table>`;
}

function pageHtml(d: StudentAttendanceData): string {
  const monthLabel = `${d.year}년 ${d.month}월`;
  const totals = d.stats.reduce(
    (a, s) => ({
      present: a.present + s.present,
      late: a.late + s.late,
      absent: a.absent + s.absent,
      cancelled: a.cancelled + s.cancelled,
      makeup: a.makeup + s.makeup,
    }),
    { present: 0, late: 0, absent: 0, cancelled: 0, makeup: 0 },
  );
  const attended = totals.present + totals.late + totals.absent;
  const rate = attended ? Math.round(((totals.present + totals.late) / attended) * 1000) / 10 : null;

  const statRows = d.stats
    .map(
      (s) =>
        `<tr><td>${esc(s.className)}</td><td>${s.present}</td><td>${s.late}</td><td>${s.absent}</td>` +
        `<td>${s.cancelled}</td><td>${s.makeup}</td><td>${s.rate != null ? `${s.rate}%` : '—'}</td></tr>`,
    )
    .join('');

  const notes =
    d.notes.length === 0
      ? '<p class="empty">해당 사항 없음 — 보강·휴강 없이 정상 수업했습니다.</p>'
      : `<table class="tbl"><thead><tr><th style="width:120px">날짜</th><th style="width:70px">구분</th><th>내용</th></tr></thead><tbody>${d.notes
          .map(
            (n) =>
              `<tr><td>${esc(n.date)} (${esc(n.weekday)})</td><td><span class="tag tag-${n.kind}">${n.kind}</span></td>` +
              `<td>${n.text ? esc(n.text) : '—'}</td></tr>`,
          )
          .join('')}</tbody></table>`;

  return `
<section class="sheet">
  <header class="head">
    <div class="title">${esc(d.studentName)} 출석 내역</div>
    <div class="sub">${esc(d.className)} · ${monthLabel} · 생성일 ${todayStr()}</div>
  </header>

  <div class="card">
    <h3>출석 통계</h3>
    <table class="tbl">
      <thead><tr><th>수업</th><th>출석</th><th>지각</th><th>결석</th><th>휴강</th><th>보강</th><th>출석률</th></tr></thead>
      <tbody>${statRows}</tbody>
    </table>
  </div>

  <div class="card">
    <h3>출석 캘린더 <small>${monthLabel}</small></h3>
    <div class="cal-line">출석 ${totals.present} · 지각 ${totals.late} · 결석 ${totals.absent} · 휴강 ${totals.cancelled} · 보강 ${totals.makeup}${
      rate != null ? ` · 출석률 ${rate}%` : ''
    }</div>
    ${calendarHtml(d)}
    <div class="legend">
      <span><i class="day" data-status="present">&nbsp;</i>출석</span>
      <span><i class="day" data-status="late">&nbsp;</i>지각</span>
      <span><i class="day" data-status="absent">&nbsp;</i>결석</span>
      <span><i class="day" data-status="cancelled">&nbsp;</i>휴강</span>
      <span><i class="mk">보강</i>보강</span>
    </div>
  </div>

  <div class="card">
    <h3>보강 진행 및 기타</h3>
    ${notes}
  </div>

  <footer class="foot">J MATH · 정재훈 강사</footer>
</section>`;
}

/**
 * 학생 여러 명(인쇄) 또는 1명(학부모 링크)의 출석 내역 문서.
 * autoPrint면 열리자마자 인쇄창을 띄운다.
 */
export function buildAttendanceReportDocument(pages: StudentAttendanceData[], opts: { autoPrint?: boolean } = {}): string {
  const title =
    pages.length === 1 ? `${pages[0].studentName} ${pages[0].year}년 ${pages[0].month}월 출석 내역` : '출석 내역';
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=834">
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
    background: ${C.pageBg};
    color: ${C.primary};
  }
  .sheet {
    width: 794px;
    margin: 0 auto 24px;
    padding: 28px 34px 22px;
    background: ${C.pageBg};
  }
  .head { padding-bottom: 10px; margin-bottom: 14px; border-bottom: 2px solid ${C.accent}; }
  .title { font-size: 22px; font-weight: 800; }
  .sub { font-size: 12px; color: ${C.muted}; margin-top: 3px; }
  .card {
    background: #FFFFFF;
    border: 1px solid rgba(31,61,43,0.07);
    border-radius: 14px;
    padding: 16px 20px;
    margin-bottom: 12px;
  }
  .card h3 { font-size: 15px; font-weight: 700; margin-bottom: 10px; }
  .card h3 small { font-size: 12px; color: ${C.muted}; font-weight: 600; margin-left: 4px; }
  .tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .tbl th {
    text-align: left; font-size: 11px; color: ${C.faint}; font-weight: 700;
    padding: 6px 8px; border-bottom: 1px solid ${C.border};
  }
  .tbl td { padding: 7px 8px; border-bottom: 1px solid rgba(31,61,43,0.05); }
  .cal-line { font-size: 11.5px; color: ${C.muted}; margin: -4px 0 8px; }
  .cal { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .cal th { font-size: 11px; font-weight: 700; color: ${C.faint}; padding: 3px 0; text-align: center; }
  .cal td { text-align: center; padding: 3px 0; height: 44px; vertical-align: top; }
  .day {
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border-radius: 50%;
    font-size: 12px; font-style: normal; color: ${C.faint};
  }
  .day[data-status='present'] { background: ${C.accent}; color: #FFFFFF; font-weight: 700; }
  .day[data-status='late'] { background: ${C.late}; color: #FFFFFF; font-weight: 700; }
  .day[data-status='absent'] { border: 1.5px solid ${C.absent}; color: ${C.absent}; font-weight: 700; }
  .day[data-status='cancelled'] { background: rgba(31,61,43,0.1); color: ${C.faint}; text-decoration: line-through; }
  .mk {
    display: block; width: fit-content; margin: 2px auto 0;
    font-size: 9.5px; font-weight: 700; font-style: normal; color: #FFFFFF;
    background: ${C.makeup}; border-radius: 6px; padding: 0 5px; line-height: 14px;
  }
  .legend { display: flex; gap: 14px; justify-content: flex-end; font-size: 11px; color: ${C.muted}; margin-top: 4px; }
  .legend span { display: inline-flex; align-items: center; gap: 4px; }
  .legend .day { width: 14px; height: 14px; font-size: 0; }
  .legend .mk { display: inline-block; margin: 0; }
  .tag {
    display: inline-block; font-size: 10.5px; font-weight: 700;
    padding: 2px 9px; border-radius: 100px; white-space: nowrap;
  }
  .tag-보강 { background: ${C.makeup}; color: #FFFFFF; }
  .tag-휴강 { background: rgba(31,61,43,0.1); color: ${C.primary}; }
  .tag-지각 { background: #FBE9D7; color: #9A5A1C; }
  .tag-결석 { background: #F6DEDA; color: ${C.absent}; }
  .tag-비고 { background: ${C.tint}; color: ${C.primary}; }
  .empty { font-size: 12.5px; color: ${C.muted}; }
  .foot { text-align: right; font-size: 10.5px; color: ${C.faint}; margin-top: 4px; }

  @page { size: A4; margin: 10mm; }
  @media print {
    body { background: #FFFFFF; }
    .sheet {
      width: auto; margin: 0; padding: 0; background: #FFFFFF;
      page-break-after: always; break-after: page;
      transform: none !important;
    }
    .sheet:last-child { page-break-after: auto; break-after: auto; }
    .card { border: 1px solid ${C.border}; break-inside: avoid; }
  }
</style>
</head>
<body>
${pages.map(pageHtml).join('\n')}
<script>
(function () {
  var auto = ${opts.autoPrint ? 'true' : 'false'};
  function fit() {
    var w = window.innerWidth;
    var sheets = document.querySelectorAll('.sheet');
    var s = w < 810 ? w / 794 : 1;
    sheets.forEach(function (el) {
      el.style.transform = s < 1 ? 'scale(' + s + ')' : '';
      el.style.transformOrigin = 'top left';
      el.style.marginBottom = s < 1 ? (-(1 - s) * el.offsetHeight) + 'px' : '';
    });
    document.body.style.overflowX = s < 1 ? 'hidden' : '';
  }
  window.addEventListener('resize', fit);
  window.addEventListener('load', function () {
    fit();
    if (auto) { window.focus(); window.print(); }
  });
  fit();
})();
</script>
</body>
</html>`;
}
