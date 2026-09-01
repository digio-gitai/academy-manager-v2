// 기출문제분석 화면의 HTML 보고서 빌더.
//
// 스트림릿 past_exam_analyzer.py(REPORT_CSS + _svg_donut/_svg_hbar/_svg_vbar +
// _build_page1~5 + _build_full_html)를 최대한 그대로 TypeScript로 이식함.
// GPT 분석(JSON 데이터 추출)은 Edge Function(generate-past-exam-report)이
// 담당하고, 이 파일은 그 결과 JSON을 받아서 5페이지짜리 인쇄용 HTML 문자열을
// 만드는 순수 함수들만 모아둠(원본과 동일한 역할 분담).
//
// 원본과 다른 점: "API 키 없으면 데모(장충고) 데이터로 대체" 폴백은 이식하지
// 않음 — Edge Function은 항상 실제 키로 호출되므로 불필요.

import { supabase } from './supabaseClient';

export interface PastExamBasicInfo {
  school?: string;
  exam_type?: string;
  exam_date?: string;
  total_questions?: number | string;
  obj_count?: number | string;
  sub_count?: number | string;
  scope_tags?: string[];
}

export interface PastExamTrend {
  summary?: string;
  bullets?: string[];
  difficulty_level?: string;
  killer_questions?: string;
  variable_factors?: string;
  composition_detail?: string;
  obj_rate?: number;
  sub_rate?: number;
  type_bar_note?: string;
}

export interface PastExamQuestion {
  num?: string | number;
  type?: string;
  concept?: string;
  summary?: string;
  difficulty?: string;
  correct_rate?: number | null;
}

export interface PastExamKeyQuestion {
  num?: string | number;
  emoji?: string;
  title?: string;
  tag_class?: string;
  tag_label?: string;
  point?: string;
  why_hard?: string;
  common_mistake?: string;
  concepts?: string[];
  steps?: string[];
}

export interface PastExamCharts {
  domain_labels?: string[];
  domain_rates?: number[];
  diff_low_pct?: number;
  diff_mid_pct?: number;
  diff_high_pct?: number;
  grade_dist?: number[];
}

export interface PastExamGradeCut {
  grade?: number | string;
  badge_class?: string;
  range?: string;
  cut?: string;
  desc?: string;
}

export interface PastExamStrategy {
  top?: string[];
  mid?: string[];
  low?: string[];
}

export interface PastExamWeeklyPlan {
  week?: number | string;
  goal?: string;
  content?: string;
  questions?: string;
}

export interface PastExamParentAdvice {
  title?: string;
  body?: string;
  summary?: string;
  hashtags?: string[];
}

export interface PastExamReportData {
  basic_info?: PastExamBasicInfo;
  trend?: PastExamTrend;
  questions?: PastExamQuestion[];
  key_questions?: PastExamKeyQuestion[];
  charts?: PastExamCharts;
  grade_cuts?: PastExamGradeCut[];
  strategy?: PastExamStrategy;
  weekly_plan?: PastExamWeeklyPlan[];
  parent_advice?: PastExamParentAdvice;
}

const Q_TABLE_MAX = 25;

// ── 유틸 ──────────────────────────────────────────────────────────
function escapeHtml(text: unknown): string {
  const s = text === null || text === undefined ? '' : String(text);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clean(text: unknown): string {
  if (!text) return '';
  const s = String(text).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  return escapeHtml(s.trim());
}

function diffBadge(d: string | undefined): string {
  const map: Record<string, string> = {
    '하': 'badge-low',
    '중하': 'badge-midlow',
    '중': 'badge-mid',
    '중상': 'badge-midhigh',
    '상': 'badge-high',
    '최상': 'badge-killer',
  };
  const cls = (d && map[d]) || 'badge-mid';
  return `<span class="badge ${cls}">${escapeHtml(d ?? '')}</span>`;
}

function typeBadge(t: string): string {
  const cls = t.includes('서술') ? 'badge-sub' : 'badge-obj';
  return `<span class="badge ${cls}">${escapeHtml(t)}</span>`;
}

// ── SVG 차트 (Canvas 없이 인쇄에서도 그대로 나오도록) ────────────────
function svgDonut(low: number, mid: number, high: number): string {
  const cx = 90;
  const cy = 90;
  const ro = 78;
  const ri = 46;
  const vals = [low, mid, high];
  const colors = ['#86EFAC', '#FCD34D', '#F87171'];
  const labels = [`하 ${low}%`, `중 ${mid}%`, `상 ${high}%`];
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  let angle = -Math.PI / 2;
  const paths: string[] = [];
  vals.forEach((v, i) => {
    const sweep = (2 * Math.PI * v) / total;
    const x1 = cx + ro * Math.cos(angle);
    const y1 = cy + ro * Math.sin(angle);
    const x2 = cx + ro * Math.cos(angle + sweep);
    const y2 = cy + ro * Math.sin(angle + sweep);
    const x3 = cx + ri * Math.cos(angle + sweep);
    const y3 = cy + ri * Math.sin(angle + sweep);
    const x4 = cx + ri * Math.cos(angle);
    const y4 = cy + ri * Math.sin(angle);
    const lg = sweep > Math.PI ? 1 : 0;
    const ma = angle + sweep / 2;
    const lx = cx + ((ro + ri) / 2) * Math.cos(ma);
    const ly = cy + ((ro + ri) / 2) * Math.sin(ma);
    const d = `M${x1.toFixed(1)},${y1.toFixed(1)}A${ro},${ro},0,${lg},1,${x2.toFixed(1)},${y2.toFixed(1)}L${x3.toFixed(1)},${y3.toFixed(1)}A${ri},${ri},0,${lg},0,${x4.toFixed(1)},${y4.toFixed(1)}Z`;
    paths.push(`<path d="${d}" fill="${colors[i]}" stroke="#fff" stroke-width="2"/>`);
    if (v >= 5) {
      paths.push(
        `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="700" fill="#111">${v}%</text>`,
      );
    }
    angle += sweep;
  });
  let legend = '';
  colors.forEach((col, i) => {
    const ly2 = 200 + i * 18;
    legend += `<rect x="16" y="${ly2}" width="12" height="12" rx="2" fill="${col}"/><text x="34" y="${ly2 + 10}" font-size="11" fill="#374151">${labels[i]}</text>`;
  });
  return `<svg viewBox="0 0 180 260" width="180" height="260" xmlns="http://www.w3.org/2000/svg">${paths.join('')}${legend}</svg>`;
}

function svgHbar(labels: string[], values: number[]): string {
  const colors = ['#2563EB', '#F97316', '#16A34A', '#9333EA', '#DC2626', '#0891B2'];
  const rowH = 28;
  const totalH = labels.length * rowH + 10;
  let svg = `<svg viewBox="0 0 320 ${totalH}" width="320" height="${totalH}" xmlns="http://www.w3.org/2000/svg">`;
  labels.forEach((lb, i) => {
    const val = values[i] ?? 0;
    const y = i * rowH + 6;
    const bw = Math.max(4, Math.round(val * 1.6));
    const col = colors[i % colors.length];
    svg += `<text x="0" y="${y + 11}" font-size="11" fill="#374151">${escapeHtml(lb)}</text><rect x="90" y="${y}" width="${bw}" height="18" rx="3" fill="${col}"/><text x="${90 + bw + 5}" y="${y + 13}" font-size="11" fill="#374151">${val}%</text>`;
  });
  return `${svg}</svg>`;
}

function svgVbar(labels: string[], values: number[], colors: string[]): string {
  const mxv = values.length ? Math.max(...values) : 1;
  const bw = 28;
  const gap = 8;
  const by = 110;
  const tw = labels.length * (bw + gap) + 20;
  let svg = `<svg viewBox="0 0 ${tw} 130" width="${tw}" height="130" xmlns="http://www.w3.org/2000/svg">`;
  labels.forEach((lb, i) => {
    const val = values[i] ?? 0;
    const col = colors[i % colors.length];
    const x = 10 + i * (bw + gap);
    const bh = mxv ? Math.round((val / mxv) * 80) : 4;
    const barY = by - bh;
    svg += `<rect x="${x}" y="${barY}" width="${bw}" height="${bh}" rx="3" fill="${col}"/><text x="${x + bw / 2}" y="${barY - 3}" text-anchor="middle" font-size="9" fill="#374151">${val}%</text><text x="${x + bw / 2}" y="${by + 14}" text-anchor="middle" font-size="9" fill="#374151">${escapeHtml(lb)}</text>`;
  });
  return `${svg}</svg>`;
}

function brandHtml(academyName: string, logoUri: string): string {
  const logo = logoUri
    ? `<img class="academy-brand-logo" src="${logoUri}" alt="로고">`
    : '<div class="academy-brand-placeholder">Σ</div>';
  return `<div class="academy-brand">${logo}<span class="academy-brand-name">${escapeHtml(academyName)}</span></div>`;
}

// ── 페이지 1: 기본 정보 + 출제 경향 요약 ─────────────────────────────
function buildPage1(data: PastExamReportData, school: string, academy: string, title: string, logoUri: string): string {
  const bi = data.basic_info || {};
  const tr = data.trend || {};
  const schoolV = clean(bi.school || school || '○○학교');
  const examType = clean(bi.exam_type || '기출문제');
  const examDate = clean(bi.exam_date || new Date().toISOString().slice(0, 10));
  const totalQ = bi.total_questions ?? '?';
  const objC = bi.obj_count;
  const subC = bi.sub_count;
  const compStr = objC && subC ? `총 ${totalQ}문항 (선택형 ${objC}문항, 서술형 ${subC}문항)` : `총 ${totalQ}문항`;
  const tags = (bi.scope_tags || []).map((t) => `<span class="tag">${clean(t)}</span>`).join('');
  const summary = clean(tr.summary || '');
  const bullets = (tr.bullets || []).map((b) => `<li>${clean(b)}</li>`).join('');
  const diff = clean(tr.difficulty_level || '중');
  const killer = clean(tr.killer_questions || '');
  const variable = clean(tr.variable_factors || '');
  const compDetail = clean(tr.composition_detail || '');
  const brand = brandHtml(academy, logoUri);

  return `<div class="page">
  <div class="page-badge">1</div>
  ${brand}
  <div class="report-title">${escapeHtml(title)}</div>
  <div class="report-sub">${schoolV} ${examType} 심층 분석</div>

  <div class="section-title">1. 기본 정보</div>
  <div class="info-grid">
    <div class="info-cell"><div class="info-label">학교 및 학년</div><div class="info-value">${schoolV}</div></div>
    <div class="info-cell"><div class="info-label">시험 종류</div><div class="info-value">${examType}</div></div>
    <div class="info-cell no-border-b"><div class="info-label">시험 일자</div><div class="info-value">${examDate}</div></div>
    <div class="info-cell no-border-b"><div class="info-label">문항 구성</div><div class="info-value">${clean(compStr)}</div></div>
    <div class="tag-row"><span class="tag-label">시험 범위</span>${tags}</div>
  </div>

  <div class="section-title">2. 전체 구성 및 출제 경향</div>
  <div class="trend-box">
    <div class="trend-title">📊 출제 경향 요약</div>
    <p style="margin-bottom:10px;">${summary}</p>
    <ul class="bullet-list">${bullets}</ul>
  </div>
  <table class="diff-table">
    <tr><td>⚖ 전체 난이도</td><td><span class="diff-level">${diff}</span></td></tr>
    <tr><td>킬러 문항</td><td>${killer}</td></tr>
    <tr><td>변별력 요소</td><td>${variable}</td></tr>
  </table>
  <div class="trend-box">
    <div class="trend-title">📌 문항 구성 비율</div>
    <p style="font-size:12px;">${compDetail}</p>
  </div>
</div>`;
}

// ── 페이지 2: 문항별 상세 분석 표 ────────────────────────────────────
function buildPage2(data: PastExamReportData): string {
  const qs = data.questions || [];
  const total = qs.length;
  const disp = qs.slice(0, Q_TABLE_MAX);
  const omit = total - disp.length;
  const rows = disp
    .map((q) => {
      const num = q.num ?? '?';
      const qt = q.type || '객관';
      const concept = clean(q.concept || '');
      const summary = clean(q.summary || '');
      const diff = q.difficulty || '중';
      const rate = q.correct_rate;
      const rateS = rate !== null && rate !== undefined ? `${rate}%` : '-';
      return `    <tr>
      <td class="tc">${num}</td>
      <td class="tc">${typeBadge(qt)}</td>
      <td class="tl">${concept}</td>
      <td class="tl">${summary}</td>
      <td class="tc">${diffBadge(diff)}</td>
      <td class="tc">${rateS}</td>
    </tr>\n`;
    })
    .join('');
  const omitNote = omit > 0 ? `<p class="q-omit">※ 전체 ${total}문항 중 ${omit}문항 생략</p>` : '';
  return `<div class="page">
  <div class="page-badge">2</div>
  <div class="section-title">3. 문항별 상세 분석</div>
  <table class="q-table">
    <colgroup>
      <col style="width:40px"><col style="width:46px"><col style="width:110px">
      <col><col style="width:52px"><col style="width:54px">
    </colgroup>
    <thead>
      <tr>
        <th class="tc">번호</th><th class="tc">유형</th><th class="tc">핵심 개념</th>
        <th class="tc">문항 내용 요약</th><th class="tc">난이도</th>
        <th class="tc">예상<br>정답률</th>
      </tr>
    </thead>
    <tbody>
${rows}    </tbody>
  </table>
  ${omitNote}
</div>`;
}

// ── 페이지 3: 핵심 문항 심층 분석 (정확히 3문항) ─────────────────────
function buildPage3(data: PastExamReportData): string {
  const kqs = data.key_questions || [];
  const blocks = kqs
    .slice(0, 3)
    .map((kq) => {
      const num = kq.num ?? '?';
      const emoji = kq.emoji || '🔢';
      const title = clean(kq.title || '');
      const tc = kq.tag_class || 'tag-high';
      const tl = clean(kq.tag_label || '상');
      const point = clean(kq.point || '');
      const why = clean(kq.why_hard || '');
      const mistake = clean(kq.common_mistake || '');
      const concepts = (kq.concepts || []).map((c) => `<li>${clean(c)}</li>`).join('');
      const steps = (kq.steps || []).map((s) => `<li>${clean(s)}</li>`).join('');
      const mistakeBlock = mistake
        ? `<div class="kq-subtitle" style="color:var(--red);margin-top:8px;">⚠️ 자주 하는 실수</div><p class="kq-text">${mistake}</p>`
        : '';
      return `  <div class="key-q">
    <div class="key-q-header">
      <span class="key-q-title">${emoji} ${num}번 &nbsp; ${title}</span>
      <span class="key-q-tag ${tc}">${tl}</span>
    </div>
    <div class="key-q-body">
      <div class="key-q-left">
        <div class="kq-subtitle">💡 핵심 포인트</div>
        <p class="kq-text">${point}</p>
        <div class="kq-subtitle">🔎 왜 어려웠을까?</div>
        <p class="kq-text">${why}</p>
        <div class="kq-subtitle">📚 필요 개념</div>
        <ul class="bullet-list">${concepts}</ul>
        ${mistakeBlock}
      </div>
      <div class="key-q-right">
        <div class="kq-subtitle">🚀 단계별 공략 솔루션</div>
        <ol class="step-list">${steps}</ol>
      </div>
    </div>
  </div>\n`;
    })
    .join('');
  return `<div class="page">
  <div class="page-badge">3</div>
  <div class="section-title">4. 핵심 문항 심층 분석</div>
  <p style="font-size:12px;color:var(--gray);margin-bottom:14px;">이번 시험에서 오답률이 가장 높고 등급을 가르는 결정적인 역할을 한 핵심 문항을 선정하여 상세히 분석합니다.</p>
${blocks}</div>`;
}

// ── 페이지 4: 차트(영역별 정답률/난이도 도넛/등급 분포) + 등급컷 ──────
function buildPage4(data: PastExamReportData): string {
  const ch = data.charts || {};
  const tr = data.trend || {};
  const gcList = data.grade_cuts || [];

  const dl = ch.domain_labels && ch.domain_labels.length ? ch.domain_labels : ['영역1', '영역2', '영역3', '영역4'];
  const dr = ch.domain_rates && ch.domain_rates.length ? ch.domain_rates : [70, 60, 55, 45];
  const dlow = ch.diff_low_pct ?? 25;
  const dmid = ch.diff_mid_pct ?? 45;
  const dhigh = ch.diff_high_pct ?? 30;
  const gdist = ch.grade_dist && ch.grade_dist.length ? ch.grade_dist : [10, 24, 32, 24, 10];
  const objR = tr.obj_rate ?? 65;
  const subR = tr.sub_rate ?? 42;
  const barNote = clean(tr.type_bar_note || '');

  const donut = svgDonut(dlow, dmid, dhigh);
  const hbar = svgHbar(dl, dr);
  const gcols = ['#1E3A8A', '#2563EB', '#60A5FA', '#93C5FD', '#BFDBFE'];
  const vbar = svgVbar(['1등급', '2등급', '3등급', '4등급', '5등급'], gdist, gcols);

  const gradeRows = gcList
    .map((gc) => {
      const g = gc.grade ?? '?';
      const bc = gc.badge_class || `g${g}`;
      const rng = clean(gc.range || '');
      const cut = clean(gc.cut || '');
      const desc = clean(gc.desc || '');
      return `      <tr>
        <td><span class="grade-badge ${bc}">${g}등급</span></td>
        <td>${rng}</td><td><span class="cut">${cut}</span></td>
        <td>${desc}</td>
      </tr>\n`;
    })
    .join('');

  return `<div class="page">
  <div class="page-badge">5</div>
  <div class="section-title">5. 시험 분석 그래프</div>
  <div class="p4-charts">
    <div class="chart-card">
      <div class="chart-title">핵심 영역별 예상 정답률</div>
      ${hbar}
    </div>
    <div class="chart-card">
      <div class="chart-title">난이도별 문항 분포</div>
      <div style="display:flex;justify-content:center;">${donut}</div>
    </div>
  </div>
  <div class="p4-bottom">
    <div>
      <div class="p4-section-label">유형별 예상 정답률</div>
      <div class="bar-row">
        <div class="bar-label">선택형</div>
        <div class="bar-track"><div class="bar-fill" style="width:${objR}%;background:var(--blue);"><span class="bar-pct">${objR}%</span></div></div>
      </div>
      <div class="bar-row">
        <div class="bar-label">서술형</div>
        <div class="bar-track"><div class="bar-fill" style="width:${subR}%;background:var(--orange);"><span class="bar-pct">${subR}%</span></div></div>
      </div>
      <p class="bar-note">${barNote}</p>
    </div>
    <div>
      <div class="p4-section-label">등급별 예상 분포</div>
      ${vbar}
    </div>
  </div>
  <div class="section-title">6. 예상 등급 분포 (5등급제 기준)</div>
  <p style="font-size:11.5px;color:var(--gray);margin-bottom:10px;">※ 예상 등급컷은 시험 난이도 분석 기반 추정치입니다.</p>
  <table class="grade-table">
    <colgroup>
      <col style="width:66px"><col style="width:74px">
      <col style="width:94px"><col>
    </colgroup>
    <thead>
      <tr><th>등급</th><th>누적 비율</th><th>예상 원점수 컷</th><th>해당 등급 특징 분석</th></tr>
    </thead>
    <tbody>
${gradeRows}    </tbody>
  </table>
</div>`;
}

// ── 페이지 5: 등급별 전략 + 6주 플랜 + 학부모 조언 ───────────────────
function buildPage5(data: PastExamReportData): string {
  const stData = data.strategy || {};
  const weekly = data.weekly_plan || [];
  const pa = data.parent_advice || {};

  const items = (lst: string[] | undefined, limit = 3) => (lst || []).slice(0, limit).map((i) => `<li>${clean(i)}</li>`).join('');

  const top = `<ul class="bullet-list">${items(stData.top)}</ul>`;
  const mid = `<ul class="bullet-list">${items(stData.mid)}</ul>`;
  const low = `<ul class="bullet-list">${items(stData.low)}</ul>`;

  const weekRows = weekly
    .slice(0, 6)
    .map((wp) => {
      const wk = wp.week ?? '?';
      const goal = clean(wp.goal || '');
      const content = (wp.content || '').replace(/\n/g, '<br>');
      const qs = clean(wp.questions || '');
      return `      <tr>
        <td style="text-align:center;"><span class="week-badge">${wk}주차</span></td>
        <td><div class="week-goal">${goal}</div></td>
        <td class="week-items">${content}</td>
        <td style="font-size:11px;color:var(--blue-dark);font-weight:600;">${qs}</td>
      </tr>\n`;
    })
    .join('');

  const advTitle = clean(pa.title || '과정을 함께 점검해 주세요');
  const advBody = clean(pa.body || '');
  const summary = clean(pa.summary || '');
  const tags = (pa.hashtags || []).map((h) => `<span class="hash-tag">${clean(h)}</span>`).join('');

  return `<div class="page">
  <div class="page-badge">6</div>
  <div class="section-title">7. 등급별 맞춤 전략</div>
  <div class="strat-grid">
    <div class="strat-header">1~2등급 [최상위·상위권]</div>
    <div class="strat-header">3~4등급 [중위권]</div>
    <div class="strat-header">5등급 [기초·하위권]</div>
    <div class="strat-body">${top}</div>
    <div class="strat-body">${mid}</div>
    <div class="strat-body">${low}</div>
  </div>

  <div class="section-title">8. 단기 6주 집중 학습 플랜</div>
  <table class="plan-table">
    <colgroup>
      <col style="width:90px"><col style="width:130px"><col><col style="width:160px">
    </colgroup>
    <thead>
      <tr>
        <th style="background:var(--blue);color:#fff;text-align:center;">주차</th>
        <th style="background:var(--blue);color:#fff;">학습 목표</th>
        <th style="background:var(--blue);color:#fff;">핵심 학습 내용</th>
        <th style="background:var(--blue);color:#fff;">이번 시험 연결 문항</th>
      </tr>
    </thead>
    <tbody>
${weekRows}    </tbody>
  </table>

  <div class="section-title">9. 학부모님께 드리는 제언</div>
  <div class="advice-box">
    <div class="advice-title">💡 ${advTitle}</div>
    <p>${advBody}</p>
  </div>
  <div class="summary-box">
    <div class="summary-title">📋 종합 총평</div>
    <p>${summary}</p>
    <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;">${tags}</div>
  </div>
</div>`;
}

// ── CSS (스트림릿 REPORT_CSS 그대로 이식, 장충고 블루/오렌지 톤) ──────
const REPORT_CSS = `
  :root{
    --blue:#2563EB;--blue-dark:#1E40AF;--blue-light:#DBEAFE;
    --orange:#F97316;--red:#DC2626;--purple:#7C3AED;
    --gray:#6B7280;--gray-light:#F3F4F6;--gray-bg:#F9FAFB;
    --black:#111827;--border:#E5E7EB;
  }
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Noto Sans KR',sans-serif;background:#EFF3FB;
       color:var(--black);font-size:13px;line-height:1.6;}
  .page-wrap{max-width:860px;margin:32px auto;display:flex;flex-direction:column;}

  .page{background:#fff;padding:36px 40px;margin-bottom:16px;border-radius:8px;
        box-shadow:0 2px 12px rgba(0,0,0,.07);position:relative;overflow:hidden;}
  .page-badge{position:absolute;top:20px;right:20px;background:var(--blue);
    color:#fff;font-weight:700;font-size:13px;width:44px;height:44px;
    border-radius:50%;display:flex;align-items:center;justify-content:center;}

  .academy-brand{display:flex;align-items:center;gap:14px;margin-bottom:16px;
    padding-bottom:14px;border-bottom:1px solid var(--border);}
  .academy-brand-logo{width:64px;height:64px;object-fit:contain;border-radius:8px;
    border:1px solid var(--border);flex-shrink:0;}
  .academy-brand-placeholder{width:64px;height:64px;border-radius:8px;flex-shrink:0;
    background:var(--blue-light);display:flex;align-items:center;justify-content:center;
    font-size:22px;font-weight:900;color:var(--blue-dark);}
  .academy-brand-name{font-size:15px;font-weight:800;color:var(--blue-dark);}
  .report-title{font-size:22px;font-weight:900;margin-bottom:4px;}
  .report-sub{font-size:12px;color:var(--gray);padding-bottom:14px;
    border-bottom:2px solid var(--blue);margin-bottom:4px;}

  .section-title{font-size:15px;font-weight:700;color:var(--blue-dark);
    margin:20px 0 10px;padding-left:10px;border-left:4px solid var(--blue);}

  .info-grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--border);
    border-radius:6px;overflow:hidden;margin-bottom:10px;}
  .info-cell{padding:10px 14px;border-bottom:1px solid var(--border);}
  .info-cell:nth-child(odd){border-right:1px solid var(--border);}
  .info-cell.no-border-b{border-bottom:none;}
  .info-label{font-size:11px;color:var(--gray);margin-bottom:3px;}
  .info-value{font-weight:700;font-size:13px;}
  .tag-row{display:flex;gap:8px;flex-wrap:wrap;padding:9px 14px;
    background:var(--gray-bg);border-top:1px solid var(--border);
    grid-column:span 2;align-items:center;}
  .tag-label{font-size:11px;color:var(--gray);margin-right:4px;}
  .tag{background:var(--blue-light);color:var(--blue-dark);font-size:11px;
    font-weight:700;padding:3px 10px;border-radius:12px;}

  .trend-box{background:var(--gray-bg);border:1px solid var(--border);
    border-radius:6px;padding:14px 16px;margin-bottom:10px;
    font-size:12.5px;line-height:1.7;}
  .trend-title{font-weight:700;font-size:13px;margin-bottom:8px;}
  .bullet-list{list-style:none;padding:0;}
  .bullet-list li{padding:3px 0 3px 16px;position:relative;
    font-size:12px;color:#374151;}
  .bullet-list li::before{content:'•';position:absolute;left:0;
    color:var(--blue);font-weight:700;}

  .diff-table{width:100%;border-collapse:collapse;margin-bottom:10px;}
  .diff-table td{padding:8px 12px;border:1px solid var(--border);
    vertical-align:top;font-size:12px;}
  .diff-table td:first-child{background:var(--gray-bg);font-weight:700;
    width:110px;white-space:nowrap;}
  .diff-level{font-size:15px;font-weight:900;color:var(--orange);}

  .q-table{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed;}
  .q-table th{background:var(--blue);color:#fff;padding:7px 6px;
    text-align:center;font-weight:700;border:1px solid var(--blue-dark);line-height:1.3;}
  .q-table td{padding:6px;border:1px solid var(--border);
    vertical-align:middle;line-height:1.4;word-break:keep-all;overflow-wrap:break-word;}
  .q-table tr:nth-child(even) td{background:var(--gray-bg);}
  .q-table .tc{text-align:center;} .q-table .tl{text-align:left;}
  .q-omit{font-size:11px;color:var(--gray);text-align:right;
    margin-top:5px;font-style:italic;}

  .badge{display:inline-block;padding:2px 7px;border-radius:10px;
    font-size:10px;font-weight:700;white-space:nowrap;}
  .badge-low    {background:#D1FAE5;color:#065F46;}
  .badge-midlow {background:#FEF3C7;color:#92400E;}
  .badge-mid    {background:#FEF3C7;color:#92400E;}
  .badge-midhigh{background:#FFEDD5;color:#9A3412;}
  .badge-high   {background:#FEE2E2;color:#991B1B;}
  .badge-killer {background:#DC2626;color:#fff;}
  .badge-obj    {background:#EFF6FF;color:var(--blue-dark);}
  .badge-sub    {background:#F5F3FF;color:var(--purple);}

  .key-q{border:1px solid var(--border);border-radius:8px;
    overflow:hidden;margin-bottom:18px;}
  .key-q-header{display:flex;justify-content:space-between;align-items:center;
    padding:10px 16px;background:var(--blue-light);}
  .key-q-title{font-weight:700;font-size:14px;color:var(--blue-dark);}
  .key-q-tag{padding:3px 12px;border-radius:12px;font-size:11px;
    font-weight:700;color:#fff;white-space:nowrap;}
  .tag-high{background:var(--red);}
  .tag-killer{background:var(--purple);}
  .tag-midhigh{background:var(--orange);}
  .tag-mid{background:#60A5FA;}
  .key-q-body{display:grid;grid-template-columns:1fr 1fr;}
  .key-q-left,.key-q-right{padding:14px 16px;}
  .key-q-left{border-right:1px solid var(--border);}
  .kq-subtitle{font-weight:700;font-size:12px;margin-bottom:6px;}
  .kq-text{font-size:12px;line-height:1.65;color:#374151;margin-bottom:10px;}
  .step-list{list-style:none;padding:0;counter-reset:step;}
  .step-list li{counter-increment:step;padding:5px 0 5px 28px;
    position:relative;font-size:12px;color:#374151;
    border-bottom:1px dashed var(--border);}
  .step-list li:last-child{border-bottom:none;}
  .step-list li::before{content:counter(step);position:absolute;left:0;
    background:var(--blue);color:#fff;width:18px;height:18px;
    border-radius:50%;display:flex;align-items:center;justify-content:center;
    font-size:10px;font-weight:700;top:6px;}

  .p4-charts{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;}
  .chart-card{border:1px solid var(--border);border-radius:8px;padding:14px 16px;}
  .chart-title{font-weight:700;font-size:12px;color:var(--gray);
    margin-bottom:10px;text-align:center;}
  .p4-bottom{display:grid;grid-template-columns:1fr 1fr;gap:16px;
    margin-bottom:20px;align-items:start;}
  .p4-section-label{font-weight:700;font-size:13px;margin-bottom:10px;}
  .bar-row{display:flex;align-items:center;gap:10px;margin-bottom:8px;}
  .bar-label{width:56px;font-size:12px;font-weight:600;
    text-align:right;flex-shrink:0;}
  .bar-track{flex:1;background:var(--gray-light);border-radius:4px;
    height:22px;overflow:hidden;}
  .bar-fill{height:100%;border-radius:4px;display:flex;
    align-items:center;justify-content:flex-end;padding-right:8px;}
  .bar-pct{font-size:11px;font-weight:700;color:#fff;}
  .bar-note{font-size:11px;color:var(--gray);line-height:1.5;margin-top:6px;}

  .grade-table{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed;}
  .grade-table th{background:var(--blue);color:#fff;padding:7px 8px;
    text-align:center;border:1px solid var(--blue-dark);}
  .grade-table td{padding:7px 8px;border:1px solid var(--border);
    text-align:center;vertical-align:middle;word-break:keep-all;}
  .grade-table td:last-child{text-align:left;font-size:11px;}
  .grade-table tr:nth-child(even) td{background:var(--gray-bg);}
  .grade-badge{display:inline-block;width:52px;padding:3px 0;
    border-radius:12px;font-weight:700;font-size:10.5px;
    color:#fff;text-align:center;}
  .g1{background:#1E3A8A;}.g2{background:#2563EB;}.g3{background:#60A5FA;}
  .g4{background:#93C5FD;color:#1E3A8A!important;}
  .g5{background:#BFDBFE;color:#1E3A8A!important;}
  .cut{font-weight:700;color:var(--blue-dark);white-space:nowrap;}

  .strat-grid{display:grid;grid-template-columns:1fr 1fr 1fr;
    border:1px solid var(--border);border-radius:8px;
    overflow:hidden;margin-bottom:20px;}
  .strat-header{background:var(--blue-light);font-weight:700;font-size:12px;
    color:var(--blue-dark);padding:10px 12px;
    border-bottom:1px solid var(--border);}
  .strat-header:not(:last-child){border-right:1px solid var(--border);}
  .strat-body{padding:12px;font-size:11.5px;line-height:1.6;color:#374151;}
  .strat-body:not(:last-child){border-right:1px solid var(--border);}

  .plan-table{width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:20px;}
  .plan-table th{padding:9px 12px;text-align:left;font-weight:700;
    font-size:12px;border:1px solid var(--border);}
  .plan-table td{padding:9px 12px;border:1px solid var(--border);
    vertical-align:top;line-height:1.55;}
  .plan-table tr:nth-child(even) td,
  .plan-table tr:nth-child(even) th{background:var(--gray-bg);}
  .week-badge{display:inline-block;background:var(--blue);color:#fff;
    font-weight:700;font-size:11px;padding:2px 10px;border-radius:12px;
    margin-right:6px;white-space:nowrap;}
  .week-goal{font-weight:700;color:var(--blue-dark);font-size:11.5px;margin-bottom:4px;}
  .week-items{font-size:11px;color:#374151;}

  .advice-box{background:var(--blue-light);border:1px solid var(--blue);
    border-radius:8px;padding:16px 20px;margin-bottom:14px;
    font-size:12.5px;line-height:1.7;}
  .advice-title{font-weight:700;font-size:14px;margin-bottom:8px;color:var(--blue-dark);}
  .summary-box{background:#1E293B;color:#fff;border-radius:8px;
    padding:16px 20px;font-size:12.5px;line-height:1.7;}
  .summary-title{font-weight:700;font-size:14px;margin-bottom:8px;color:#93C5FD;}
  .hash-tag{background:rgba(96,165,250,.2);color:#93C5FD;padding:3px 10px;
    border-radius:12px;font-size:11px;font-weight:700;
    display:inline-block;margin:3px 2px;}

  svg text{font-family:'Noto Sans KR',sans-serif;}

  @page{size:A4 portrait;margin:0;}
  @media print{
    html,body{background:#fff!important;
      -webkit-print-color-adjust:exact!important;
      print-color-adjust:exact!important;}
    .page-wrap{margin:0!important;max-width:210mm!important;width:210mm!important;}
    .page{width:210mm!important;padding:14mm 16mm!important;
      margin:0!important;border-radius:0!important;box-shadow:none!important;
      page-break-after:always!important;break-after:page!important;
      box-sizing:border-box!important;overflow:hidden!important;}
    .key-q{page-break-inside:avoid;break-inside:avoid;}
    .strat-grid{page-break-inside:avoid;break-inside:avoid;}
    .grade-table{page-break-inside:avoid;break-inside:avoid;}
    .advice-box,.summary-box{page-break-inside:avoid;break-inside:avoid;}
  }
`;

function buildFullHtml(
  data: PastExamReportData,
  opts: { schoolName: string; academyName: string; reportTitle: string; logoUri: string },
): string {
  const title = opts.reportTitle.trim() || `${opts.schoolName} 기출문제 분석 보고서`;
  const p1 = buildPage1(data, opts.schoolName, opts.academyName, title, opts.logoUri);
  const p2 = buildPage2(data);
  const p3 = buildPage3(data);
  const p4 = buildPage4(data);
  const p5 = buildPage5(data);
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap" rel="stylesheet">
<style>
${REPORT_CSS}
</style>
</head>
<body>
<div class="page-wrap">
${p1}
${p2}
${p3}
${p4}
${p5}
</div>
</body>
</html>`;
}

// ── Edge Function 호출 + 전체 보고서 생성 ────────────────────────────
export async function analyzePastExam(schoolName: string, examText: string): Promise<PastExamReportData> {
  const { data, error } = await supabase.functions.invoke<{ data?: PastExamReportData; error?: string }>(
    'generate-past-exam-report',
    { body: { schoolName, examText } },
  );
  if (error) {
    throw error;
  }
  if (!data || data.error || !data.data) {
    throw new Error(data?.error || 'GPT 분석에 실패했습니다.');
  }
  return data.data;
}

export function generatePastExamReportHtml(
  data: PastExamReportData,
  opts: { schoolName: string; academyName: string; reportTitle: string; logoUri: string },
): string {
  return buildFullHtml(data, opts);
}
