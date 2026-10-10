import type { BundleStudentRow, BundleTestStat, RetestAttempt } from './bundleAnalysis';

// 묶음 분석 보고서 — 단독 HTML 문자열(외부 파일/스크립트 없음).
//   mode 'group' = 집단 비교(내신기출): 회차별 점수 vs 응시자 평균, 상위 비율
//   mode 'trend' = 개인 추이(단원평가): 본인 점수 흐름 + 재시험 현황, 집단 통계 없음
// 그래프는 정적 SVG라서 report_links.html_content로 저장해 학부모 페이지에서도 그대로 열린다.
// 디자인은 reports/시안_내신대비_분석보고서.html 시안과 동일.
// (2026-10-10: 기존 통합보고서 A4 템플릿으로 바꿔 봤으나 이쪽이 낫다고 해서 되돌림 — 디자인은 나중에 다시 손볼 예정)

const ACADEMY_NAME = '사과나무 학원';
const TEACHER_NAME = '정재훈';
const FEW_TAKEN_THRESHOLD = 3; // 이 횟수 미만이면 "응시 횟수 적음" 안내문 표시

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(n: number | null, digits = 1): string {
  return n === null ? '–' : n.toFixed(digits);
}

function axisLines(W: number, L: number, T: number, ph: number): string[] {
  const parts: string[] = [];
  for (let v = 0; v <= 100; v += 20) {
    const y = T + ph * (1 - v / 100);
    parts.push(`<line x1="${L}" x2="${W - 10}" y1="${y}" y2="${y}" stroke="#e5e7eb"/>`);
    parts.push(`<text x="${L - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="#64748b">${v}</text>`);
  }
  return parts;
}

function chartSvg(student: BundleStudentRow, tests: BundleTestStat[]): string {
  const W = 760;
  const H = 330;
  const L = 34;
  const T = 14;
  const B = 78;
  const ph = H - T - B;
  const base = H - B;
  const gw = (W - L - 10) / Math.max(tests.length, 1);
  const bw = gw * 0.32;
  const parts = axisLines(W, L, T, ph);
  tests.forEach((t, i) => {
    const cell = student.cells[i];
    const cx = L + gw * i + gw / 2;
    const hA = (ph * t.avg) / 100;
    parts.push(`<rect x="${cx - bw - 1}" y="${base - hA}" width="${bw}" height="${hA}" fill="#cbd5e1" rx="2"/>`);
    parts.push(
      `<text x="${cx - bw / 2 - 1}" y="${base - hA - 4}" text-anchor="middle" font-size="10" fill="#64748b">${Math.round(t.avg)}</text>`,
    );
    if (cell.score === null) {
      parts.push(
        `<rect x="${cx + 1}" y="${T + ph * 0.35}" width="${bw}" height="${ph * 0.65}" fill="#f1f5f9" stroke="#94a3b8" stroke-dasharray="3 3" rx="2"/>`,
      );
      parts.push(
        `<text x="${cx + 1 + bw / 2}" y="${T + ph * 0.35 - 5}" text-anchor="middle" font-size="10" fill="#64748b">결석</text>`,
      );
    } else {
      const h = (ph * cell.score) / 100;
      parts.push(`<rect x="${cx + 1}" y="${base - h}" width="${bw}" height="${h}" fill="#2563eb" rx="2"/>`);
      parts.push(
        `<text x="${cx + 1 + bw / 2}" y="${base - h - 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#2563eb">${Math.round(cell.score)}</text>`,
      );
    }
    // X축 라벨: 첫 단어(굵게) + 나머지를 9자 단위로 줄바꿈
    const words = t.name.split(/\s+/).filter(Boolean);
    const first = words.shift() ?? '';
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      if ((cur + w).length > 9 && cur) {
        lines.push(cur.trim());
        cur = '';
      }
      cur += `${w} `;
    }
    if (cur.trim()) lines.push(cur.trim());
    const tspans = [`<tspan x="${cx}" dy="0" font-weight="700">${esc(first)}</tspan>`]
      .concat(lines.slice(0, 3).map((ln, k) => `<tspan x="${cx}" dy="${k === 0 ? 13 : 12}">${esc(ln)}</tspan>`))
      .join('');
    parts.push(`<text x="${cx}" y="${base + 16}" text-anchor="middle" font-size="10.5" fill="#334155">${tspans}</text>`);
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">${parts.join('')}</svg>`;
}

function trendChartSvg(student: BundleStudentRow, tests: BundleTestStat[], threshold: number, showAvg: boolean): string {
  const W = 760;
  const H = 300;
  const L = 34;
  const T = 14;
  const B = 62;
  const ph = H - T - B;
  const base = H - B;
  const gw = (W - L - 10) / Math.max(tests.length, 1);
  const bw = Math.min(gw * 0.42, 70);
  const parts = axisLines(W, L, T, ph);
  const yTh = T + ph * (1 - threshold / 100);
  parts.push(`<line x1="${L}" x2="${W - 10}" y1="${yTh}" y2="${yTh}" stroke="#dc2626" stroke-dasharray="4 4" opacity=".5"/>`);
  parts.push(`<text x="${W - 12}" y="${yTh - 4}" text-anchor="end" font-size="10" fill="#dc2626">${threshold}점</text>`);
  const pts: string[] = [];
  tests.forEach((t, i) => {
    const c = student.cells[i];
    const cx = L + gw * i + gw / 2;
    if (c.score !== null) {
      const h = (ph * c.score) / 100;
      const color = c.score < threshold ? '#dc2626' : '#2563eb';
      parts.push(`<rect x="${cx - bw / 2}" y="${base - h}" width="${bw}" height="${h}" fill="${color}" rx="3"/>`);
      parts.push(
        `<text x="${cx}" y="${base - h - 5}" text-anchor="middle" font-size="12" font-weight="700" fill="${color}">${Math.round(c.score)}</text>`,
      );
      pts.push(`${cx},${base - h}`);
    } else {
      parts.push(
        `<rect x="${cx - bw / 2}" y="${T + ph * 0.35}" width="${bw}" height="${ph * 0.65}" fill="#f1f5f9" stroke="#94a3b8" stroke-dasharray="3 3" rx="3"/>`,
      );
      parts.push(`<text x="${cx}" y="${T + ph * 0.35 - 5}" text-anchor="middle" font-size="10" fill="#64748b">미응시</text>`);
    }
    // 참고선: 그 시험을 본 학생들의 평균 위치 (옵션 — 단원마다 난이도가 달라 순위 비교용이 아니라 참고용)
    if (showAvg && t.n > 0) {
      const yAvg = base - (ph * t.avg) / 100;
      parts.push(
        `<line x1="${cx - bw / 2 - 6}" x2="${cx + bw / 2 + 6}" y1="${yAvg}" y2="${yAvg}" stroke="#475569" stroke-width="2" stroke-dasharray="5 3"/>`,
      );
      parts.push(
        `<text x="${cx + bw / 2 + 8}" y="${yAvg + 3}" font-size="9.5" fill="#475569">${Math.round(t.avg)}</text>`,
      );
    }
    parts.push(`<text x="${cx}" y="${base + 16}" text-anchor="middle" font-size="10.5" fill="#334155">${esc(t.name.slice(0, 22))}</text>`);
  });
  if (pts.length > 1) {
    parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="#1F3D2B" stroke-width="1.5" opacity=".5"/>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">${parts.join('')}</svg>`;
}

export interface BundleReportInput {
  student: BundleStudentRow;
  tests: BundleTestStat[];
  title: string; // 예: "2학기 중3 내신대비 기출 분석"
  createdAt: string; // YYYY-MM-DD
  mode?: 'group' | 'trend';
  aiComment?: string; // 없으면 AI 종합분석 칸을 만들지 않음
  retests?: RetestAttempt[]; // 개인 추이에서만 사용
  threshold?: number; // 개인 추이: 이 점수 미만이면 빨간색 + 보강 필요
  showAvg?: boolean; // 개인 추이: 그 시험 응시자 평균을 점선 참고선으로 함께 표시
}

function groupSection(student: BundleStudentRow, tests: BundleTestStat[]): string {
  const rows = tests
    .map((t, i) => {
      const c = student.cells[i];
      if (c.score === null) {
        return `<tr class="abs"><td class="l">${esc(t.name)}</td><td colspan="4">미응시 (집계 제외)</td></tr>`;
      }
      const diff = c.score - c.avg;
      return (
        `<tr><td class="l">${esc(t.name)}</td><td><b>${Math.round(c.score)}</b></td><td>${Math.round(c.avg)}</td>` +
        `<td style="color:${diff >= 0 ? '#16a34a' : '#dc2626'}">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}</td>` +
        `<td><b>상위 ${c.topPct}%</b> <small style="color:#94a3b8">(${c.n}명 중)</small></td></tr>`
      );
    })
    .join('');
  const dev = student.avgDev === null ? '–' : `${student.avgDev >= 0 ? '+' : ''}${student.avgDev.toFixed(1)}`;
  const top = student.avgTopPct === null ? '–' : `상위 ${student.avgTopPct.toFixed(0)}`;
  return `<div class="kpis">
  <div class="kpi"><span>응시 횟수</span><b>${student.taken}</b> <em>/ ${student.total}회</em></div>
  <div class="kpi"><span>내 평균 점수</span><b>${fmt(student.avgScore)}</b> <em>점</em></div>
  <div class="kpi"><span>평균 편차 <small>(내 점수 − 회차 평균)</small></span><b>${dev}</b> <em>점</em></div>
  <div class="kpi"><span>평균 상위 비율</span><b>${top}</b> <em>% (응시자 기준)</em></div>
</div>
<h2>회차별 점수 vs 응시자 평균</h2>
<div class="legend"><i style="background:#2563eb"></i>${esc(student.name)}<i style="background:#cbd5e1"></i>그 회차 응시자 평균<i style="background:#f1f5f9;border:1px dashed #94a3b8"></i>미응시(결석)</div>
${chartSvg(student, tests)}
<h2>회차별 상세</h2>
<table><tr><th>회차 / 시험지</th><th>내 점수</th><th>응시자 평균</th><th>차이</th><th>상위 비율</th></tr>${rows}</table>`;
}

function trendSection(
  student: BundleStudentRow,
  tests: BundleTestStat[],
  retests: RetestAttempt[],
  threshold: number,
  showAvg: boolean,
): string {
  const mine = retests.filter((r) => r.studentId === student.studentId);
  const rows = tests
    .map((t, i) => {
      const c = student.cells[i];
      const list = mine.filter((r) => r.testId === t.testId).sort((a, b) => a.attemptNo - b.attemptNo);
      const passedAt = list.find((r) => r.passed);
      const retestCell =
        list.length === 0
          ? '<span style="color:#64748b">—</span>'
          : passedAt
            ? `<b style="color:#16a34a">✔ 통과 (${passedAt.attemptNo}회차)</b> <small style="color:#94a3b8">총 ${list.length}회 실시</small>`
            : `<b style="color:#dc2626">✘ 아직 미통과</b> <small style="color:#94a3b8">${list.length}회 실시</small>`;
      if (c.score === null) {
        return `<tr class="abs"><td class="l">${esc(t.name)}</td><td colspan="2">미응시</td><td>${retestCell}</td></tr>`;
      }
      const low = c.score < threshold;
      return (
        `<tr><td class="l">${esc(t.name)}</td><td><b style="color:${low ? '#dc2626' : '#1e293b'}">${Math.round(c.score)}</b></td>` +
        `<td>${low ? '<span style="color:#dc2626">기준 미달</span>' : '<span style="color:#16a34a">충분</span>'}</td><td>${retestCell}</td></tr>`
      );
    })
    .join('');

  let bestIdx = -1;
  let worstIdx = -1;
  student.cells.forEach((c, i) => {
    if (c.score === null) return;
    if (bestIdx < 0 || c.score > (student.cells[bestIdx].score as number)) bestIdx = i;
    if (worstIdx < 0 || c.score < (student.cells[worstIdx].score as number)) worstIdx = i;
  });
  const label = (i: number) =>
    i < 0 ? '–' : `${esc(tests[i].name.split(/\s+/)[0] || tests[i].name)} ${Math.round(student.cells[i].score as number)}점`;

  return `<div class="kpis">
  <div class="kpi"><span>응시 횟수</span><b>${student.taken}</b> <em>/ ${student.total}회</em></div>
  <div class="kpi"><span>내 평균 점수</span><b>${fmt(student.avgScore)}</b> <em>점</em></div>
  <div class="kpi"><span>가장 높은 시험</span><b style="font-size:16px">${label(bestIdx)}</b></div>
  <div class="kpi"><span>보강 확인 시험</span><b style="font-size:16px;color:#dc2626">${label(worstIdx)}</b></div>
</div>
<h2>회차별 점수 추이</h2>
<div class="legend"><i style="background:#2563eb"></i>${esc(student.name)}<i style="background:#dc2626"></i>${threshold}점 미만(보강 필요)${showAvg ? '<i style="background:#475569;height:2px;vertical-align:middle"></i>응시자 평균(참고)' : ''}</div>
${trendChartSvg(student, tests, threshold, showAvg)}
<h2>회차별 상세 · 재시험 현황</h2>
<table><tr><th>시험</th><th>점수</th><th>기준(${threshold}점)</th><th>재시험</th></tr>${rows}</table>`;
}

export function buildBundleReportHtml(input: BundleReportInput): string {
  const { student, tests, title, createdAt, aiComment, mode = 'group', retests = [], threshold = 70, showAvg = false } = input;
  const trend = mode === 'trend';
  const few = student.taken < FEW_TAKEN_THRESHOLD;

  const aiHtml = aiComment ? `<h2>AI 종합 분석</h2><div class="ai">${esc(aiComment).replace(/\n/g, '<br>')}</div>` : '';
  const foot = trend
    ? `· 단원마다 범위와 난이도가 달라 ${showAvg ? '점선은 그 시험을 본 학생들의 평균(참고용)이며 석차 비교는 하지 않습니다.' : '다른 학생과의 평균·석차 비교는 하지 않습니다.'} · 재시험은 본시험 점수와 별도로 기록되며 점수에 반영되지 않습니다.`
    : '· 평균·상위 비율은 해당 회차를 실제로 응시한 학생끼리만 계산합니다. · 재시험·중복 응시는 반영하지 않고 최초 응시 점수만 사용합니다. · 결석 회차는 0점이 아니라 집계에서 제외됩니다.';

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(student.name)} ${esc(title)}</title>
<style>
:root{--g:#1F3D2B;--gold:#C9A961;--bg:#f6f4ee;--ink:#1e293b;--mute:#64748b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:'Malgun Gothic','NanumGothic',sans-serif;line-height:1.55}
.page{max-width:820px;margin:0 auto;background:#fff;padding:30px 34px}
header{border-bottom:3px solid var(--g);padding-bottom:12px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap}
header h1{margin:0;font-size:21px;color:var(--g)} header small{color:var(--mute)}
h2{font-size:15px;color:var(--g);border-left:4px solid var(--gold);padding-left:8px;margin:26px 0 10px}
.notice{background:#fff7e0;border:1px solid #f1d98a;color:#7a5b00;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:14px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.kpi{background:var(--bg);border-radius:8px;padding:10px 12px}
.kpi span{display:block;font-size:12px;color:var(--mute)} .kpi b{font-size:21px;color:var(--g)} .kpi em{font-style:normal;font-size:12px;color:var(--mute)}
.legend{font-size:12px;color:var(--mute);margin:4px 0}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 10px;vertical-align:middle}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center} th{background:var(--bg);color:var(--g)}
td.l{text-align:left} .abs{color:var(--mute);background:#fafafa}
.ai{background:var(--bg);border-radius:8px;padding:14px 16px;font-size:14px}
.foot{margin-top:24px;font-size:11px;color:var(--mute);border-top:1px solid #e5e7eb;padding-top:8px}
@media(max-width:560px){.page{padding:20px 16px}.kpis{grid-template-columns:repeat(2,1fr)}}
</style></head><body><div class="page">
<header>
  <div><h1>${esc(title)}</h1><small>${ACADEMY_NAME} · ${TEACHER_NAME} &nbsp;|&nbsp; ${esc(student.name)}${student.grade ? ` (${esc(student.grade)})` : ''} &nbsp;|&nbsp; 작성일 ${esc(createdAt)}</small></div>
  <small>${trend ? '개인 추이' : '집단 비교'} · 100점 환산</small>
</header>
${few ? `<div class="notice">※ 테스트 응시 횟수가 적습니다. (응시 ${student.taken}회 / 전체 ${student.total}회)</div>` : ''}
${trend ? trendSection(student, tests, retests, threshold, showAvg) : groupSection(student, tests)}
${aiHtml}
<div class="foot">${foot}</div>
</div></body></html>`;
}
