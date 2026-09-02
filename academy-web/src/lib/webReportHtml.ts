import type { CategoryStat, IntegratedReportData, PerTestSummary } from './integratedReport';

const ACADEMY_NAME = 'J MATH';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function accuracyClass(pct: number): string {
  if (pct >= 80) return 'green';
  if (pct <= 40) return 'red';
  if (pct <= 60) return 'orange';
  return 'blue';
}

function fmt1(n: number): string {
  return n.toFixed(1);
}

function categoryTableRows(rows: CategoryStat[]): string {
  return rows
    .map(
      (r) =>
        `<tr><td class="left">${esc(r.label)}</td><td>${r.total}</td>` +
        `<td class="blue">${r.correct}</td><td class="orange">${r.wrong}</td>` +
        `<td class="${accuracyClass(r.accuracy)}">${fmt1(r.accuracy)}</td></tr>`,
    )
    .join('');
}

function pageHeader(opts: {
  studentName: string;
  grade: string;
  className: string;
  examTitle: string;
}): string {
  const tag = [opts.grade, opts.className].filter(Boolean).join(' · ') || ACADEMY_NAME;
  return `<div class="page-header">
    <div>
      <div class="h-student-tag">${esc(tag)}</div>
      <div class="h-student-name">${esc(opts.studentName)}</div>
    </div>
    <div class="h-center">
      <div class="h-report-type">통합 TEST &amp; ANALYSIS REPORT</div>
      <div class="h-exam-title">${esc(opts.examTitle)}</div>
    </div>
    <div class="h-logo"><span>${ACADEMY_NAME}</span></div>
  </div>`;
}

function pageFooter(page: number, total: number): string {
  return `<div class="page-footer"><span>${ACADEMY_NAME}</span><span>${page} / ${total}</span></div>`;
}

function barChartScript(canvasId: string, labels: string[], values: number[], colors: string[]): string {
  return `if (document.getElementById('${canvasId}') && ${JSON.stringify(labels)}.length) {
  new Chart(document.getElementById('${canvasId}'), {
    type: 'bar',
    data: {
      labels: ${JSON.stringify(labels)},
      datasets: [{ label: '정답률', data: ${JSON.stringify(values)}, backgroundColor: ${JSON.stringify(colors)}, borderRadius: 4 }]
    },
    options: {
      indexAxis: ${JSON.stringify(labels.some((l) => l.length > 6) ? 'y' : 'x')},
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { min: ${labels.some((l) => l.length > 6) ? 0 : undefined}, max: ${labels.some((l) => l.length > 6) ? 100 : undefined}, grid: { display: false } },
        y: { min: ${labels.some((l) => l.length > 6) ? undefined : 0}, max: ${labels.some((l) => l.length > 6) ? undefined : 100}, grid: { color: GRID } }
      }
    }
  });
}`;
}

/**
 * "4단계: React용 A4 HTML 리포트 생성기" — 스트림릿 web_report_generator.py의
 * generate_html_report()를 참고해 같은 A4 인쇄용 레이아웃(Chart.js, 네이비/오렌지
 * 배색)을 그대로 가져오되, 여러 단원테스트를 하나로 합친 데이터에 맞게 재구성함.
 *
 * 원본과 다른 점(2026-08-29, 사용자와 상의):
 *  - "전국 추정" 비교(national_pct)는 원본도 실제로는 같은 반 동급생 데이터를
 *    추정치로 쓰는 것이었는데, 여러 시험을 섞어 비교하면 통계적으로 의미가
 *    약해져서 이번 통합보고서에서는 빼고 "본인 정답률"만 보여줌 — 대신 시험별
 *    백분위·석차(같은 반 기준, 시험 단위로는 여전히 정확함)는 마지막 페이지에
 *    표로 정확하게 보여줌.
 *  - 인지영역 페이지는 실제 데이터(cognitive_domain)가 하나도 없으면(과거에
 *    저장된 시험만 골랐을 때) 빈 레이더 차트 대신 "데이터 준비 중" 안내문을 보여줌
 *    — 가짜 숫자를 채우지 않기로 한 방침(2026-08-29) 그대로 반영.
 *  - 유형별 분석은 정답률이 낮은 순으로 정렬해서 취약한 유형이 먼저 보이게 함.
 */
export function buildWebReportHtml(data: IntegratedReportData, parentComment: string): string {
  const dates = data.tests.map((t) => t.date).filter(Boolean).sort();
  const dateRange =
    dates.length === 0 ? '' : dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} ~ ${dates[dates.length - 1]}`;
  const examTitle = `통합보고서 (${data.tests.length}개 시험${dateRange ? ' · ' + dateRange : ''})`;
  const headerOpts = { studentName: data.studentName, grade: data.grade, className: data.className, examTitle };

  const cognitiveOrder = ['계산', '이해', '추론', '해결'];
  const cogRows = cognitiveOrder
    .map((label) => data.cognitiveAnalysis.find((c) => c.label === label))
    .filter((c): c is CategoryStat => Boolean(c));
  const unclassifiedCog = data.cognitiveAnalysis.find((c) => c.label === '미분류');

  const testRows = data.tests
    .map(
      (t: PerTestSummary) =>
        `<tr><td class="left">${esc(t.testName)}</td><td>${esc(t.date)}</td><td>${fmt1(t.score)}</td>` +
        `<td>${fmt1(t.irt.percentile)}%</td><td>${t.irt.rank}/${t.irt.peerCount}</td><td class="blue">${t.irt.grade}등급</td></tr>`,
    )
    .join('');

  const weakList = data.weakTopics
    .map((t) => `<li>${esc(t.label)} — 정답률 ${fmt1(t.accuracy)}% (${t.correct}/${t.total})</li>`)
    .join('');
  const strongList = data.strongTopics
    .map((t) => `<li>${esc(t.label)} — 정답률 ${fmt1(t.accuracy)}% (${t.correct}/${t.total})</li>`)
    .join('');

  const commentSection = parentComment.trim()
    ? `<div class="comment-section">
    <div class="comment-title">학부모님께 전하는 글</div>
    <div class="comment-body">${esc(parentComment.trim()).replace(/\n/g, '<br>')}</div>
  </div>`
    : '';

  // ── page 1 본문: 헤더 + 코멘트 + KPI + 문제 타입 분석 ──
  const body1 = `${pageHeader(headerOpts)}
  ${commentSection}
  <div class="summary-row">
    <div class="s-card"><div class="lbl">평균 점수</div><div class="val">${fmt1(data.averageScore)}</div></div>
    <div class="s-card"><div class="lbl">통합 정답률</div><div class="val orange">${fmt1(data.combinedAccuracy)}%</div></div>
    <div class="s-card"><div class="lbl">선택 시험 수</div><div class="val">${data.tests.length}개</div></div>
    <div class="s-card"><div class="lbl">전체 문항 수</div><div class="val">${data.combinedTotalQuestions}문항</div></div>
  </div>
  <div class="sec-title">문제 타입 분석</div>
  <div class="type-grid">
    <div>
      <table style="margin-bottom:10px">
        <thead><tr><th>타입</th><th>문항</th><th>정답</th><th>오답</th><th>정답률</th></tr></thead>
        <tbody>${categoryTableRows(data.formatAnalysis)}</tbody>
      </table>
      <div class="chart-wrap" style="height:130px"><canvas id="formatChart"></canvas></div>
    </div>
    <div class="pie-side">
      <canvas id="pieChart" width="130" height="130"></canvas>
      <div>${data.formatAnalysis
        .map(
          (f, i) =>
            `<div class="legend-item"><div class="legend-sq" style="background:${['#5574d6', '#9b5de5'][i % 2]}"></div> ${esc(f.label)}</div>`,
        )
        .join('')}</div>
    </div>
  </div>`;

  // ── page 2 본문: 난이도별 분석 (인지영역 데이터가 없으면 이 페이지에 안내문까지 같이 넣어서
  //    거의 빈 페이지를 따로 만들지 않음 — "보고서가 빈약하다"는 실사용 피드백 반영, 2026-08-29) ──
  const cogNotice = `<div style="padding:16px;background:var(--c-bg);border-radius:8px;font-size:11px;color:var(--c-muted);line-height:1.8">
    선택한 시험들에는 아직 인지영역(계산·이해·추론·해결) 데이터가 없습니다.<br>
    2026-08-29부터 새로 저장하는 시험부터 인지영역이 자동으로 분류되니, 이후 시험이 쌓이면 별도 페이지로 분석이 표시됩니다.
  </div>`;
  const body2 = `${pageHeader(headerOpts)}
  <div class="sec-title">난이도별 분석 <span class="sec-sub">본인 정답률</span></div>
  <div class="chart-wrap" style="height:180px;margin-bottom:14px"><canvas id="diffChart"></canvas></div>
  <table${data.hasCognitiveData ? '' : ' style="margin-bottom:20px"'}>
    <thead><tr><th>난이도</th><th>문항</th><th>정답</th><th>오답</th><th>정답률</th></tr></thead>
    <tbody>${categoryTableRows(data.difficultyAnalysis)}</tbody>
  </table>
  ${data.hasCognitiveData ? '' : `<hr><div class="sec-title">인지영역 분석</div>${cogNotice}`}`;

  // ── page 3 본문: 인지영역 분석 (실제 데이터가 있을 때만 별도 페이지로 생성) ──
  const cogBody = `<div class="radar-grid">
    <canvas id="radarChart" width="170" height="170"></canvas>
    <div>
      <div class="cog-list">${cogRows
        .map(
          (c) =>
            `<div class="cog-item"><div class="cog-row"><span>${esc(c.label)}</span>` +
            `<span class="${accuracyClass(c.accuracy)}">${fmt1(c.accuracy)}%</span></div>` +
            `<div class="cog-track"><div class="cog-fill" style="width:${fmt1(c.accuracy)}%;background:var(--c-main)"></div></div>` +
            `<div class="cog-note">${c.total}문항 · 정답 ${c.correct} · 오답 ${c.wrong}</div></div>`,
        )
        .join('')}</div>
      <table style="margin-top:12px;font-size:10px">
        <thead><tr><th>영역</th><th>문항</th><th>정답</th><th>오답</th><th>정답률</th></tr></thead>
        <tbody>${categoryTableRows(cogRows)}</tbody>
      </table>
      ${
        unclassifiedCog
          ? `<p style="margin-top:8px;font-size:10px;color:var(--c-muted)">※ 인지영역 미분류 ${unclassifiedCog.total}문항(옛 시험 데이터)은 위 집계에서 제외했습니다.</p>`
          : ''
      }
    </div>
  </div>`;
  const body3 = data.hasCognitiveData
    ? `${pageHeader(headerOpts)}
  <div class="sec-title">인지영역 분석 <span class="sec-sub">계산 · 이해 · 추론 · 해결 영역별 성취도</span></div>
  ${cogBody}`
    : null;

  // ── page 4 본문: 단원별 분석 ──
  const body4 = `${pageHeader(headerOpts)}
  <div class="sec-title">단원별 분석 <span class="sec-sub">선택한 시험 전체를 합친 단원별 정답률</span></div>
  <div class="chart-wrap" style="height:200px;margin-bottom:16px"><canvas id="unitChart"></canvas></div>
  <table>
    <thead><tr><th>단원</th><th>문항</th><th>정답</th><th>오답</th><th>정답률</th></tr></thead>
    <tbody>${categoryTableRows(data.unitAnalysis)}</tbody>
  </table>`;

  // ── page 5 본문: 유형별 분석(정답률 낮은 순) + 취약/강점 ──
  const typeSorted = [...data.typeAnalysis].sort((a, b) => a.accuracy - b.accuracy);
  const body5 = `${pageHeader(headerOpts)}
  <div class="sec-title">유형별 분석 <span class="sec-sub">풀이유형별 정답률 — 취약한 유형이 위로 오도록 정렬</span></div>
  <div class="chart-wrap" style="height:200px;margin-bottom:16px"><canvas id="typeDetailChart"></canvas></div>
  <table style="font-size:10.5px;margin-bottom:18px">
    <thead><tr><th>유형</th><th>문항</th><th>정답</th><th>오답</th><th>정답률</th></tr></thead>
    <tbody>${categoryTableRows(typeSorted.slice(0, 16))}</tbody>
  </table>
  <div class="weak-strong-grid">
    <div>
      <div class="sec-title" style="font-size:11px">취약 단원 Top3</div>
      ${weakList ? `<ul class="wk-list">${weakList}</ul>` : '<p class="wk-empty">계산할 데이터가 부족합니다.</p>'}
    </div>
    <div>
      <div class="sec-title" style="font-size:11px">강점 단원 Top3</div>
      ${strongList ? `<ul class="wk-list">${strongList}</ul>` : '<p class="wk-empty">계산할 데이터가 부족합니다.</p>'}
    </div>
  </div>`;

  // ── page 6 본문: 시험별 종합 ──
  const body6 = `${pageHeader(headerOpts)}
  <div class="sec-title">시험별 종합 <span class="sec-sub">같은 반 학생 기준 백분위 · 석차 · 등급</span></div>
  <table style="margin-bottom:18px">
    <thead><tr><th>시험명</th><th>날짜</th><th>점수</th><th>백분위</th><th>석차</th><th>등급</th></tr></thead>
    <tbody>${testRows}</tbody>
  </table>
  <div class="chart-wrap" style="height:180px;margin-bottom:16px"><canvas id="testChart"></canvas></div>
  <div style="margin-top:10px;padding:12px;background:var(--c-bg);border-radius:8px;font-size:10px;color:var(--c-muted);line-height:1.8">
    <strong style="color:var(--c-text)">등급 안내</strong><br>
    같은 반 학생들의 점수 분포를 기준으로 백분위 90% 이상은 1등급, 70~90%는 2등급, 50~70%는 3등급,
    30~50%는 4등급, 30% 미만은 5등급으로 표시합니다.
  </div>`;

  // 인지영역 실데이터가 없으면 그 페이지를 통째로 생략(난이도별 페이지 하단에 안내문만 넣음) —
  // 있는 데이터만으로 페이지를 구성해서 "거의 빈 페이지"가 생기지 않도록 함.
  const bodies = [body1, body2, body3, body4, body5, body6].filter((b): b is string => b !== null);
  const totalPages = bodies.length;
  const pagesHtml = bodies
    .map((body, i) => `<div class="page">\n  ${body}\n  ${pageFooter(i + 1, totalPages)}\n</div>`)
    .join('\n');

  const diffColors = data.difficultyAnalysis.map((d) => (d.accuracy >= 70 ? '#1a5fd4' : d.accuracy < 50 ? '#cc2e2e' : '#e85d26'));
  const unitColors = data.unitAnalysis.map((u) => (u.accuracy >= 70 ? '#1a5fd4' : u.accuracy < 55 ? '#cc2e2e' : '#1a9e75'));
  const typeColors = typeSorted
    .slice(0, 16)
    .map((t) => (t.accuracy >= 70 ? '#1a5fd4' : t.accuracy < 55 ? '#cc2e2e' : '#e85d26'));
  const formatColors = data.formatAnalysis.map((f) => (f.accuracy >= 70 ? '#1a7a4a' : '#e85d26'));
  const testChartLabels = data.tests.map((t) => (t.testName.length > 14 ? t.testName.slice(0, 13) + '…' : t.testName));
  const testChartValues = data.tests.map((t) => t.irt.percentile);
  const testChartColors = testChartValues.map((v) => (v >= 70 ? '#1a5fd4' : v < 50 ? '#cc2e2e' : '#e85d26'));

  const chartScript = `<script>
Chart.defaults.font.family = "'Noto Sans KR', sans-serif";
Chart.defaults.font.size = 10;
Chart.defaults.color = '#666';
const GRID = 'rgba(0,0,0,0.06)';

${barChartScript('formatChart', data.formatAnalysis.map((f) => f.label), data.formatAnalysis.map((f) => f.accuracy), formatColors)}

if (document.getElementById('pieChart')) {
  new Chart(document.getElementById('pieChart'), {
    type: 'doughnut',
    data: {
      labels: ${JSON.stringify(data.formatAnalysis.map((f) => f.label))},
      datasets: [{ data: ${JSON.stringify(data.formatAnalysis.map((f) => f.total))}, backgroundColor:['#5574d6','#9b5de5'], borderWidth:0 }]
    },
    options: { plugins:{ legend:{ display:false } }, cutout:'58%' }
  });
}

${barChartScript('diffChart', data.difficultyAnalysis.map((d) => d.label), data.difficultyAnalysis.map((d) => d.accuracy), diffColors)}

${
  data.hasCognitiveData
    ? `if (document.getElementById('radarChart')) {
  new Chart(document.getElementById('radarChart'), {
    type: 'radar',
    data: {
      labels: ${JSON.stringify(cogRows.map((c) => c.label))},
      datasets: [{ label:'본인', data: ${JSON.stringify(cogRows.map((c) => c.accuracy))}, borderColor:'#1a5fd4', backgroundColor:'rgba(26,95,212,0.15)', pointRadius:3, borderWidth:2 }]
    },
    options: {
      responsive:false,
      plugins:{ legend:{ display:false } },
      scales:{ r:{ min:0, max:100, ticks:{ display:false, stepSize:25 }, grid:{ color:GRID }, pointLabels:{ font:{ size:11 } } } }
    }
  });
}`
    : ''
}

${barChartScript('unitChart', data.unitAnalysis.map((u) => u.label), data.unitAnalysis.map((u) => u.accuracy), unitColors)}

${barChartScript(
  'typeDetailChart',
  typeSorted.slice(0, 16).map((t) => t.label),
  typeSorted.slice(0, 16).map((t) => t.accuracy),
  typeColors,
)}

${barChartScript('testChart', testChartLabels, testChartValues, testChartColors)}
</script>`;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(data.studentName)} 통합보고서</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap">
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --c-main:#1a5fd4; --c-accent:#e85d26; --c-positive:#1a7a4a; --c-negative:#cc2e2e;
    --c-purple:#9b5de5; --c-teal:#1a9e75; --c-text:#1a1a1a; --c-muted:#666;
    --c-border:#e2e2e2; --c-bg:#f7f8fc; --page-w:794px; --page-h:1123px; --pad:30px;
  }
  html, body { font-family:'Noto Sans KR',sans-serif; font-size:13px; color:var(--c-text); background:#e8eaef; }
  .page {
    width:var(--page-w); min-height:var(--page-h); background:#fff; margin:20px auto;
    padding:var(--pad); border:0.5px solid #ccc; position:relative; page-break-after:always;
  }
  .page-header {
    display:flex; align-items:flex-start; justify-content:space-between;
    margin-bottom:20px; padding-bottom:14px; border-bottom:2.5px solid var(--c-main);
  }
  .h-student-tag { font-size:11px; color:var(--c-muted); margin-bottom:3px; }
  .h-student-name { font-size:16px; font-weight:700; }
  .h-center { text-align:center; }
  .h-report-type { font-size:10px; font-weight:700; letter-spacing:2.5px; color:var(--c-main); margin-bottom:5px; }
  .h-exam-title { font-size:14px; font-weight:700; }
  .h-logo { width:68px; height:44px; background:var(--c-main); border-radius:8px; display:flex; align-items:center; justify-content:center; }
  .h-logo span { color:#fff; font-size:12px; font-weight:700; text-align:center; line-height:1.4; }
  .comment-section {
    margin-bottom:20px; padding:14px 16px; background:var(--c-bg);
    border:0.5px solid var(--c-border); border-left:3px solid var(--c-main); border-radius:8px;
  }
  .comment-title { font-size:12px; font-weight:700; color:var(--c-main); margin-bottom:8px; }
  .comment-body { font-size:12px; line-height:1.8; color:var(--c-text); }
  .sec-title { font-size:13px; font-weight:700; margin-bottom:10px; display:flex; align-items:center; gap:7px; }
  .sec-title::before { content:''; display:inline-block; width:3px; height:14px; background:var(--c-main); border-radius:2px; }
  .sec-sub { font-size:10px; font-weight:400; color:var(--c-muted); }
  .summary-row { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:20px; }
  .s-card { border:0.5px solid var(--c-border); border-radius:8px; padding:10px 12px; }
  .s-card .lbl { font-size:10px; color:var(--c-muted); margin-bottom:3px; }
  .s-card .val { font-size:22px; font-weight:700; color:var(--c-main); line-height:1.1; }
  .s-card .val.orange { color:var(--c-accent); }
  table { width:100%; border-collapse:collapse; font-size:11px; }
  th { background:var(--c-bg); padding:6px 8px; border:0.5px solid var(--c-border); text-align:center; font-size:10px; color:var(--c-muted); font-weight:700; }
  td { padding:7px 8px; border:0.5px solid var(--c-border); text-align:center; }
  td.left { text-align:left; }
  .blue { color:var(--c-main); font-weight:700; }
  .orange { color:var(--c-accent); font-weight:700; }
  .green { color:var(--c-positive); font-weight:700; }
  .red { color:var(--c-negative); font-weight:700; }
  .chart-wrap { position:relative; width:100%; }
  .type-grid { display:grid; grid-template-columns:1fr 190px; gap:16px; margin-bottom:20px; }
  .pie-side { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; }
  .legend-item { display:flex; align-items:center; gap:5px; font-size:10px; color:var(--c-muted); }
  .legend-sq { width:10px; height:10px; border-radius:2px; }
  .radar-grid { display:grid; grid-template-columns:170px 1fr; gap:16px; align-items:start; }
  .cog-list { display:flex; flex-direction:column; gap:10px; padding-top:4px; }
  .cog-item .cog-row { display:flex; justify-content:space-between; font-size:11px; }
  .cog-track { height:4px; background:#eee; border-radius:4px; margin:3px 0 2px; }
  .cog-fill { height:4px; border-radius:4px; }
  .cog-note { font-size:9px; color:var(--c-muted); }
  .weak-strong-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .wk-list { list-style:none; display:flex; flex-direction:column; gap:6px; font-size:11px; }
  .wk-list li { padding:8px 10px; background:var(--c-bg); border-radius:6px; }
  .wk-empty { font-size:11px; color:var(--c-muted); }
  .page-footer {
    position:absolute; bottom:18px; left:var(--pad); right:var(--pad);
    display:flex; justify-content:space-between; font-size:10px; color:#bbb;
    border-top:0.5px solid var(--c-border); padding-top:6px;
  }
  @media print {
    body { background:#fff; }
    .page { margin:0; border:none; box-shadow:none; }
  }
</style>
</head>
<body>
${pagesHtml}
${chartScript}
</body>
</html>`;
}
