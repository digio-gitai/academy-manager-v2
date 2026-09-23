import logoDataUrl from '../assets/logo_jmath.png?inline';
import type { AttendanceStatus } from '../types/attendance';

/**
 * 학부모에게 링크로 보내는 "학생 1명 · 한 달" 출석 내역 페이지(A4). 학원시험
 * 보고서(academyTestReportHtml.ts)와 같은 블루 테마·로고를 써서 학부모가 받는
 * 문서들의 모양을 맞춤. report_links에 저장돼 /parent-report?token= 으로 열람.
 */

const BRAND_BLUE = '#4A7CFF';
const ACADEMY_NAME = 'J MATH';
const TEACHER_NAME = '정재훈';

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: '출석',
  late: '지각',
  absent: '결석',
  cancelled: '휴강',
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export interface AttendanceReportInput {
  studentName: string;
  className: string;
  year: number;
  month: number;
  present: number;
  late: number;
  absent: number;
  /** 휴강 제외 출석률(출석+지각)/전체. 기록이 없으면 null. */
  rate: number | null;
  /** 날짜(일) → 그날 상태. */
  dayStatus: Record<number, AttendanceStatus>;
  /** 지각·결석·휴강·비고가 있는 기록(날짜순). */
  notes: { date: string; weekday: string; status: AttendanceStatus; note: string }[];
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

function buildCalendar(year: number, month: number, dayStatus: Record<number, AttendanceStatus>): string {
  const daysInMonth = new Date(year, month, 0).getDate();
  const startWeekday = new Date(year, month - 1, 1).getDay();
  const cells: string[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push('<div class="cal-cell cal-empty"></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const st = dayStatus[d];
    const weekday = (startWeekday + d - 1) % 7;
    const dayCls = weekday === 0 ? ' sun' : weekday === 6 ? ' sat' : '';
    cells.push(
      `<div class="cal-cell${st ? ` has-${st}` : ''}">` +
        `<span class="cal-day${dayCls}">${d}</span>` +
        (st ? `<span class="cal-chip chip-${st}">${STATUS_LABEL[st]}</span>` : '') +
        `</div>`,
    );
  }
  while (cells.length % 7 !== 0) cells.push('<div class="cal-cell cal-empty"></div>');
  const head = WEEKDAYS.map(
    (w, i) => `<div class="cal-head${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}">${w}</div>`,
  ).join('');
  return `<div class="cal-grid">${head}${cells.join('')}</div>`;
}

export function buildAttendanceReportHtml(p: AttendanceReportInput): string {
  const name = esc(p.studentName);
  const monthLabel = `${p.year}년 ${p.month}월`;
  const now = new Date();
  const generatedAt = `${now.getFullYear()}.${pad2(now.getMonth() + 1)}.${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const total = p.present + p.late + p.absent;

  const kpi = (label: string, value: string, unit: string, cls = '') => `
      <div class="kpi-card ${cls}">
        <div class="kpi-label">${label}</div>
        <div class="kpi-value">${value}<span class="kpi-unit">${unit}</span></div>
      </div>`;

  const notesHtml =
    p.notes.length === 0
      ? '<div class="all-good">이번 달은 모두 정상 출석했습니다. 👏</div>'
      : `<table class="note-table">
      <thead><tr><th>날짜</th><th>상태</th><th>비고</th></tr></thead>
      <tbody>${p.notes
        .map(
          (r) =>
            `<tr><td>${esc(r.date.slice(5).replace('-', '/'))} (${esc(r.weekday)})</td>` +
            `<td><span class="cal-chip chip-${r.status}">${STATUS_LABEL[r.status]}</span></td>` +
            `<td>${r.note ? esc(r.note) : '—'}</td></tr>`,
        )
        .join('')}</tbody>
    </table>`;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=834">
<title>${name} ${monthLabel} 출석 내역</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif;
    background: #EFF2F8;
    color: #1F2A44;
  }
  .page {
    width: 794px;
    margin: 0 auto;
    background: #FFFFFF;
    padding: 26px 30px 36px;
    box-shadow: 0 4px 30px rgba(31,42,68,0.10);
  }
  .hero {
    background: ${BRAND_BLUE};
    border-radius: 22px;
    padding: 24px 28px;
    display: flex;
    align-items: center;
    gap: 22px;
  }
  .hero-logo {
    width: 92px; height: 92px;
    background: #FFFFFF;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
    flex-shrink: 0;
  }
  .hero-logo img { width: 84%; height: 84%; object-fit: contain; }
  .hero-text { flex: 1; text-align: center; padding-right: 40px; }
  .hero-text h1 { color: #FFFFFF; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 6px; }
  .hero-sub { color: rgba(255,255,255,0.85); font-size: 13px; }
  .greeting { font-size: 13px; color: #5B6B8C; line-height: 1.7; margin: 16px 4px 26px; }
  .section { margin-bottom: 30px; }
  .sec-title {
    display: flex; align-items: center; gap: 8px;
    font-size: 16px; font-weight: 800; color: #1F2A44;
    margin: 0 0 14px 2px;
  }
  .sec-title::before {
    content: ''; width: 9px; height: 9px; border-radius: 50%;
    background: ${BRAND_BLUE}; flex-shrink: 0;
  }
  .sec-title small { font-size: 12px; font-weight: 600; color: ${BRAND_BLUE}; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
  .kpi-card {
    border: 1.5px solid #BFD3FF;
    border-radius: 16px;
    padding: 18px 10px 16px;
    text-align: center;
    box-shadow: 0 6px 14px rgba(74,124,255,0.10);
  }
  .kpi-card.main { background: #F3F7FF; }
  .kpi-label { font-size: 13px; font-weight: 700; margin-bottom: 8px; }
  .kpi-value { font-size: 34px; font-weight: 800; color: ${BRAND_BLUE}; letter-spacing: -1px; line-height: 1; }
  .kpi-unit { font-size: 15px; font-weight: 700; margin-left: 1px; }
  .kpi-card.late .kpi-value { color: #D98E04; }
  .kpi-card.absent .kpi-value { color: #E14D67; }
  .cal-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    border: 1.5px solid #E3E8F2;
    border-radius: 16px;
    overflow: hidden;
  }
  .cal-head {
    background: #F3F6FB;
    text-align: center;
    font-size: 12px; font-weight: 700; color: #5B6B8C;
    padding: 8px 0;
  }
  .cal-cell {
    min-height: 64px;
    border-top: 1px solid #EEF1F6;
    border-left: 1px solid #EEF1F6;
    padding: 6px 7px;
    display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
  }
  .cal-cell:nth-child(7n + 1) { border-left: none; }
  .cal-empty { background: #FAFBFD; }
  .cal-day { font-size: 12px; font-weight: 700; color: #3A4763; }
  .cal-day.sun, .cal-head.sun { color: #E14D67; }
  .cal-day.sat, .cal-head.sat { color: ${BRAND_BLUE}; }
  .has-present { background: #F3F7FF; }
  .has-late { background: #FFF8E8; }
  .has-absent { background: #FDF0F3; }
  .cal-chip {
    display: inline-block;
    font-size: 11px; font-weight: 700;
    padding: 2px 9px;
    border-radius: 10px;
    white-space: nowrap;
  }
  .chip-present { background: ${BRAND_BLUE}; color: #FFFFFF; }
  .chip-late { background: #F8B62D; color: #FFFFFF; }
  .chip-absent { background: #FFFFFF; color: #E14D67; border: 1.5px solid #E14D67; }
  .chip-cancelled { background: #E8EBF1; color: #8A93A6; }
  .legend { display: flex; gap: 12px; justify-content: flex-end; margin-top: 8px; font-size: 11px; color: #8A93A6; }
  .legend span { display: inline-flex; align-items: center; gap: 4px; }
  .note-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .note-table th {
    text-align: left; font-size: 12px; color: #5B6B8C; font-weight: 700;
    padding: 8px 10px; background: #F3F6FB;
  }
  .note-table td { padding: 9px 10px; border-bottom: 1px solid #EEF1F6; }
  .all-good {
    background: #E8F8EF; border: 1.5px solid #86EFAC; color: #16A34A;
    font-size: 13px; font-weight: 700; padding: 12px 16px; border-radius: 12px;
  }
  .footer {
    text-align: center; padding-top: 22px; margin-top: 6px;
    color: #8A93A6; font-size: 11px; border-top: 1px solid #E3E8F2;
  }
  .footer strong { color: #1F2A44; }
  @page { size: A4; margin: 8mm; }
  @media print {
    body { background: #FFFFFF; }
    .page { width: auto; box-shadow: none; padding: 0; transform: none !important; }
    .section, .kpi-card, .cal-grid { break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="page">
  <div class="hero">
    <div class="hero-logo"><img src="${logoDataUrl}" alt="학원 로고"></div>
    <div class="hero-text">
      <h1>${name} 학생 출석 내역</h1>
      <div class="hero-sub">${esc(p.className)} &nbsp;·&nbsp; ${monthLabel}</div>
    </div>
  </div>

  <div class="greeting">
    안녕하세요, ${ACADEMY_NAME} ${TEACHER_NAME} 강사입니다.<br>${name} 학생의 ${monthLabel} 출석 내역을 보내드립니다.
  </div>

  <div class="section">
    <div class="sec-title">이번 달 출석 요약 <small>수업 ${total}회 기준 (휴강 제외)</small></div>
    <div class="kpi-grid">
      ${kpi('출석률', p.rate != null ? String(Math.round(p.rate)) : '—', p.rate != null ? '%' : '', 'main')}
      ${kpi('출석', String(p.present), '회')}
      ${kpi('지각', String(p.late), '회', 'late')}
      ${kpi('결석', String(p.absent), '회', 'absent')}
    </div>
  </div>

  <div class="section">
    <div class="sec-title">출석 달력 <small>${monthLabel}</small></div>
    ${buildCalendar(p.year, p.month, p.dayStatus)}
    <div class="legend">
      <span><span class="cal-chip chip-present">출석</span></span>
      <span><span class="cal-chip chip-late">지각</span></span>
      <span><span class="cal-chip chip-absent">결석</span></span>
      <span><span class="cal-chip chip-cancelled">휴강</span></span>
    </div>
  </div>

  <div class="section">
    <div class="sec-title">확인이 필요한 기록 <small>지각 · 결석 · 휴강 · 비고</small></div>
    ${notesHtml}
  </div>

  <div class="footer">
    <strong>${ACADEMY_NAME}</strong> &nbsp;·&nbsp; 문의 사항은 학원으로 연락 주세요.<br>
    생성일시: ${generatedAt}
  </div>
</div>
<script>
(function() {
  function fitPage() {
    var page = document.querySelector('.page');
    if (!page) return;
    var w = window.innerWidth;
    if (w < 810) {
      var s = w / 794;
      page.style.transform = 'scale(' + s + ')';
      page.style.transformOrigin = 'top left';
      document.body.style.overflowX = 'hidden';
      document.body.style.height = (page.offsetHeight * s) + 'px';
    } else {
      page.style.transform = '';
      document.body.style.height = '';
      document.body.style.overflowX = '';
    }
  }
  window.addEventListener('resize', fitPage);
  window.addEventListener('load', fitPage);
  fitPage();
})();
</script>
</body>
</html>`;
}
