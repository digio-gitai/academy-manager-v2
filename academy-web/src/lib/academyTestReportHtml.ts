import logoDataUrl from '../assets/logo_jmath.png?inline';
import { TEST_CATEGORIES } from './academyTestReportData';
import type { ReportMode, QuestionDetail, MonthTopicStat } from './academyTestReportData';

/**
 * 스트림릿 claude_report.py의 generate_parent_report_html()을 그대로 이식한
 * "학원시험 AI분석" 학생별 학부모 보고서(A4, 블루+핑크 테마). 통합보고서
 * (webReportHtml.ts)와는 별개 양식. AI 호출(오답 한줄평·풀이유형 묶기)은
 * 호출부에서 미리 해서 wrongComments / methodMapping으로 넘겨받음 — 이 함수는
 * 순수하게 HTML 문자열만 만든다.
 */

const BRAND_BLUE = '#4A7CFF';
const BRAND_PINK = '#F986A7';
const ACADEMY_NAME = 'J MATH';
const TEACHER_NAME = '정재훈';
const PARENT_GREETING = `안녕하세요, ${ACADEMY_NAME} ${TEACHER_NAME} 강사입니다.`;

export interface AttendanceStatsInput {
  curMonth: number;
  curRate: number | null;
  curPresent: number;
  curLate: number;
  curAbsent: number;
  prevMonth: number | null;
  prevRate: number | null;
  prevPresent: number | null;
  prevLate: number | null;
  prevAbsent: number | null;
}

export interface HomeworkPerfStatsInput {
  curMonth: number;
  curRate: number | null;
  curHigh: number;
  curMid: number;
  curLow: number;
  prevMonth: number | null;
  prevRate: number | null;
  prevHigh: number | null;
  prevMid: number | null;
  prevLow: number | null;
}

export interface AcademyTestReportInput {
  studentName: string;
  school: string;
  grade: string;
  className: string;
  testName: string;
  testDate: string;
  score: number;
  totalQuestions: number;
  wrongNumbers: number[];
  allScores: number[];
  history: { testName: string; date: string; score: number }[];
  teacherComment: string;
  showClassAvg: boolean;
  showClassRank: boolean;
  showHistoryChart: boolean;
  testCategory: string;
  reportMode: ReportMode;
  monthlyTopicStats: MonthTopicStat[] | null;
  prevMonthAvg: number | null;
  questionDetails: QuestionDetail[] | null;
  showAttendance: boolean;
  attendanceStats: AttendanceStatsInput | null;
  showHomeworkPerf: boolean;
  homeworkPerfStats: HomeworkPerfStatsInput | null;
  /** 오답 문항별 AI 한줄평 {문항번호: 한줄평} — 표준/프리미엄에서만 사용. */
  wrongComments: Record<number, string>;
  /** 단원 1개짜리 시험일 때 AI로 묶은 풀이유형 매핑. null이면 난이도 기준 폴백. */
  methodMapping: Record<string, string> | null;
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Python round()와 같은 은행가 반올림(0.5 → 짝수). */
function pyRound(x: number, nd = 0): number {
  const f = 10 ** nd;
  const v = x * f;
  const r = Math.round(v);
  const isHalf = Math.abs(v - Math.trunc(v)) === 0.5;
  const out = isHalf ? 2 * Math.round(v / 2) : r;
  return out / f;
}

function f1(x: number): string {
  return x.toFixed(1);
}

function f0(x: number): string {
  return String(pyRound(x));
}

function sampleStdev(values: number[]): number {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
}

function qnum(d: QuestionDetail): number | null {
  const n = parseInt(d.questionNumber, 10);
  return Number.isNaN(n) ? null : n;
}

function detailMap(details: QuestionDetail[] | null): Map<number, QuestionDetail> {
  const map = new Map<number, QuestionDetail>();
  for (const d of details ?? []) {
    const n = qnum(d);
    if (n != null) map.set(n, d);
  }
  return map;
}

function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c');
}

// ── KPI 카드 ──
function buildKpiCards(p: {
  score: number;
  accuracy: number;
  classAvg: number | null;
  rank: number | null;
  totalStudents: number | null;
  showClassAvg: boolean;
  showClassRank: boolean;
}): string {
  const cards: string[] = [];
  cards.push(`
    <div class="kpi-card">
      <div class="kpi-label">이번 점수</div>
      <div class="kpi-value">${f1(p.score)}<span class="kpi-unit">점</span></div>
      <div class="kpi-sub">정답률 ${f1(p.accuracy)}%</div>
    </div>`);

  if (p.showClassAvg) {
    const avgStr = p.classAvg != null ? f1(p.classAvg) : '—';
    let diffStr = '';
    if (p.classAvg != null) {
      const diff = p.score - p.classAvg;
      const sign = diff >= 0 ? '+' : '';
      diffStr = `평균 대비 ${sign}${f1(diff)}점`;
    }
    cards.push(`
    <div class="kpi-card">
      <div class="kpi-label">반 평균</div>
      <div class="kpi-value">${avgStr}<span class="kpi-unit">점</span></div>
      <div class="kpi-sub">${diffStr}</div>
    </div>`);
  }

  if (p.showClassRank) {
    const rankStr = p.rank != null ? String(p.rank) : '—';
    const totalStr = p.totalStudents ? `전체 ${p.totalStudents}명 중` : '';
    cards.push(`
    <div class="kpi-card">
      <div class="kpi-label">반 석차</div>
      <div class="kpi-value">${rankStr}<span class="kpi-unit">위</span></div>
      <div class="kpi-sub">${totalStr}</div>
    </div>`);
  }

  return cards.join('\n');
}

// ── 출석 현황 / 과제 수행도 (전월 + 이번 달 현재까지) ──
function miniCard(label: string, rate: number | null, sub: string): string {
  if (rate == null) {
    return `
    <div class="kpi-card">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">—</div>
      <div class="kpi-sub">기록 없음</div>
    </div>`;
  }
  return `
    <div class="kpi-card">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${f0(rate)}<span class="kpi-unit">%</span></div>
      <div class="kpi-sub">${sub}</div>
    </div>`;
}

function buildAttendanceSection(show: boolean, s: AttendanceStatsInput | null): string {
  if (!show || !s) return '';
  const prevCard = miniCard(
    s.prevMonth ? `${s.prevMonth}월 출석` : '지난달 출석',
    s.prevRate,
    `출석 ${s.prevPresent || 0} · 지각 ${s.prevLate || 0} · 결석 ${s.prevAbsent || 0}`,
  );
  const curCard = miniCard(
    `${s.curMonth}월 출석 (현재까지)`,
    s.curRate,
    `출석 ${s.curPresent || 0} · 지각 ${s.curLate || 0} · 결석 ${s.curAbsent || 0}`,
  );
  return `
  <div class="section">
    <div class="sec-title">출석 현황</div>
    <div class="mini-kpi-grid">
      ${prevCard}
      ${curCard}
    </div>
  </div>`;
}

function buildHomeworkPerformanceSection(show: boolean, s: HomeworkPerfStatsInput | null): string {
  if (!show || !s) return '';
  const prevCard = miniCard(
    s.prevMonth ? `${s.prevMonth}월 과제 수행률` : '지난달 과제 수행률',
    s.prevRate,
    `상 ${s.prevHigh || 0} · 중 ${s.prevMid || 0} · 하 ${s.prevLow || 0}`,
  );
  const curCard = miniCard(
    `${s.curMonth}월 과제 수행률 (현재까지)`,
    s.curRate,
    `상 ${s.curHigh || 0} · 중 ${s.curMid || 0} · 하 ${s.curLow || 0}`,
  );
  return `
  <div class="section">
    <div class="sec-title">과제 수행도</div>
    <div class="mini-kpi-grid">
      ${prevCard}
      ${curCard}
    </div>
  </div>`;
}

// ── 라이트: 오답 간단 칩 ──
function buildWrongChips(wrongNumbers: number[], details: QuestionDetail[] | null): string {
  if (wrongNumbers.length === 0) return '<span class="no-wrong">오답 없음 🎉</span>';
  const map = detailMap(details);
  const chips = wrongNumbers.map((n) => {
    const topic = (map.get(n)?.topic ?? '').trim();
    const label = topic ? `${n}번 · ${esc(topic)}` : `${n}번`;
    return `<span class="wrong-badge">${label}</span>`;
  });
  return `<div class="wrong-card-no-detail">${chips.join('')}</div>`;
}

// ── 라이트: 오늘의 한줄 요약 (AI 미사용) ──
function buildLiteSummary(p: {
  studentName: string;
  correctCount: number;
  totalQuestions: number;
  wrongNumbers: number[];
  details: QuestionDetail[] | null;
  teacherComment: string;
}): string {
  let text = (p.teacherComment || '').trim();
  if (!text || text === '선생님 코멘트를 입력해 주세요.') {
    if (p.wrongNumbers.length === 0) {
      text = `오늘 ${p.totalQuestions}문항 모두 정답입니다. ${p.studentName} 학생, 아주 잘했어요!`;
    } else {
      const map = detailMap(p.details);
      const topicCounts = new Map<string, number>();
      for (const n of p.wrongNumbers) {
        const topic = (map.get(n)?.topic ?? '').trim();
        if (topic) topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
      }
      if (topicCounts.size > 0) {
        const parts = Array.from(topicCounts.entries())
          .map(([t, c]) => `${t} ${c}문항`)
          .join(', ');
        text =
          `오늘 ${p.totalQuestions}문항 중 ${p.correctCount}문항을 맞혔습니다. ` +
          `${parts}이 아쉬웠고, 다음 수업에서 함께 복습하겠습니다.`;
      } else {
        text =
          `오늘 ${p.totalQuestions}문항 중 ${p.correctCount}문항을 맞혔습니다. ` +
          `틀린 문항은 다음 수업에서 함께 복습하겠습니다.`;
      }
    }
  }
  return `
  <div class="section">
    <div class="comment-card">
      <div class="comment-title">오늘의 한줄 요약</div>
      <div class="comment-text">${esc(text)}</div>
    </div>
  </div>`;
}

// ── 유형별 진단 ──
const DIFFICULTY_LABELS: Record<string, string> = {
  A: '최상난도(A)',
  B: '상(B)',
  C: '중(C)',
  D: '하(D)',
  E: '쉬움(E)',
};

/** 단원이 1개뿐인 시험인지 — 호출부가 AI 풀이유형 묶기를 할지 판단할 때도 사용. */
export function isSingleTopicTest(details: QuestionDetail[]): boolean {
  const topics = new Set(details.map((d) => d.topic.trim() || '미분류'));
  return topics.size <= 1;
}

export function distinctQuestionMethods(details: QuestionDetail[]): string[] {
  return Array.from(new Set(details.map((d) => d.questionMethod.trim()).filter(Boolean))).sort();
}

function buildTypeAnalysis(
  wrongNumbers: number[],
  details: QuestionDetail[] | null,
  methodMapping: Record<string, string> | null,
): string {
  if (!details || details.length === 0) return '';

  let groupingMode: 'topic' | 'ai_method' | 'difficulty' = 'topic';
  if (isSingleTopicTest(details)) {
    groupingMode = methodMapping ? 'ai_method' : 'difficulty';
  }

  const typeStats = new Map<string, { total: number; wrong: number }>();
  const wrongSet = new Set(wrongNumbers);
  for (const d of details) {
    const n = qnum(d);
    if (n == null) continue;
    let label: string;
    if (groupingMode === 'ai_method') {
      const raw = d.questionMethod.trim();
      label = methodMapping?.[raw] ?? (raw || '미분류');
    } else if (groupingMode === 'difficulty') {
      const diff = d.difficulty.trim().toUpperCase();
      label = DIFFICULTY_LABELS[diff] ?? (diff || '미분류');
    } else {
      label = d.topic.trim() || '미분류';
    }
    const s = typeStats.get(label) ?? { total: 0, wrong: 0 };
    s.total += 1;
    if (wrongSet.has(n)) s.wrong += 1;
    typeStats.set(label, s);
  }
  if (typeStats.size === 0) return '';

  const typeList = Array.from(typeStats.entries()).map(([method, s]) => {
    const correct = s.total - s.wrong;
    return { method, total: s.total, correct, pct: s.total ? pyRound((correct / s.total) * 100) : 0 };
  });
  typeList.sort((a, b) => b.pct - a.pct);

  const wrongSorted = typeList
    .filter((t) => t.total - t.correct >= 2)
    .sort((a, b) => b.total - b.correct - (a.total - a.correct));
  const bot3 = wrongSorted.slice(0, 3).map((t) => t.method);
  const remaining = typeList.filter((t) => !bot3.includes(t.method));
  const top3 = remaining
    .slice(0, 3)
    .filter((t) => t.pct >= 70)
    .map((t) => t.method);

  const repItem = (t: string) =>
    `<div class="type-rep-item">` +
    `<span class="type-rep-dot"></span>` +
    `<span class="type-rep-label">${esc(t)}</span>` +
    `</div>`;
  const topItems = top3.map(repItem).join('') || '<div class="type-rep-empty">해당 없음</div>';
  const botItems = [...bot3].reverse().map(repItem).join('') || '<div class="type-rep-empty">해당 없음</div>';

  let barRows = '';
  for (const item of typeList) {
    const { pct, method: topic, total, correct } = item;
    const isTop = top3.includes(topic);
    const isBot = bot3.includes(topic);

    if (total === 1 && correct === 0) {
      barRows += `
<div class="type-row-box">
  <div class="type-row-top">
    <span class="type-row-label">${esc(topic)}</span>
    <span class="type-badge type-badge-bad">오답 1문항</span>
  </div>
</div>`;
      continue;
    }

    let badge = '';
    let barColor = BRAND_BLUE;
    if (isTop) {
      badge = '<span class="type-badge type-badge-good">우수</span>';
      barColor = BRAND_BLUE;
    } else if (isBot) {
      badge = '<span class="type-badge type-badge-bad">취약</span>';
      barColor = BRAND_PINK;
    }

    barRows += `
<div class="type-row-box">
  <div class="type-row-top">
    <span class="type-row-label">${esc(topic)}</span>
    ${badge}
    <span class="type-row-count">${correct}/${total}문항</span>
    <span class="type-row-pct">${pct}%</span>
  </div>
  <div class="type-bar-bg">
    <div class="type-bar-fill" style="width:${pct}%;background:${barColor};"></div>
  </div>
</div>`;
  }

  return `
<div class="type-rep-grid">
  <div class="type-rep-box rep-good">
    <div class="type-rep-title">대표 우수 유형</div>
    ${topItems}
  </div>
  <div class="type-rep-box rep-bad">
    <div class="type-rep-title">대표 취약 유형</div>
    ${botItems}
  </div>
</div>
${barRows}`;
}

// ── 프리미엄: 월간 누적 분석 ──
function buildMonthlySection(
  history: { testName: string; date: string; score: number }[],
  testDate: string,
  monthlyTopicStats: MonthTopicStat[] | null,
  prevMonthAvg: number | null,
): string {
  const ym = (testDate || '').slice(0, 7);
  const monthTests = history.filter((h) => String(h.date).slice(0, 7) === ym);
  if (monthTests.length === 0 && !(monthlyTopicStats && monthlyTopicStats.length > 0)) return '';

  const y = parseInt(ym.slice(0, 4), 10);
  const m = parseInt(ym.slice(5, 7), 10);
  const monthLabel = Number.isNaN(y) || Number.isNaN(m) ? '이번 달' : `${y}년 ${m}월`;

  const rows = monthTests
    .map(
      (h) =>
        `<div class="month-row">` +
        `<span class="month-date">${esc(h.date)}</span>` +
        `<span class="month-name">${esc(h.testName)}</span>` +
        `<span class="month-score">${f0(h.score)}점</span>` +
        `</div>`,
    )
    .join('');
  const listHtml = rows ? `<div class="month-list">${rows}</div>` : '';

  let kpiHtml = '';
  if (monthTests.length > 0) {
    const thisAvg = pyRound(monthTests.reduce((s, h) => s + h.score, 0) / monthTests.length, 1);
    let prevCard: string;
    if (prevMonthAvg != null) {
      const diff = pyRound(thisAvg - prevMonthAvg, 1);
      let delta: string;
      if (diff > 0) delta = `<span class="delta-up">▲ ${diff}점 상승</span>`;
      else if (diff < 0) delta = `<span class="delta-down">▼ ${Math.abs(diff)}점 하락</span>`;
      else delta = '지난달과 동일';
      prevCard = `
    <div class="kpi-card">
      <div class="kpi-label">지난달 평균</div>
      <div class="kpi-value">${f1(prevMonthAvg)}<span class="kpi-unit">점</span></div>
      <div class="kpi-sub">${delta}</div>
    </div>`;
    } else {
      prevCard = `
    <div class="kpi-card">
      <div class="kpi-label">지난달 평균</div>
      <div class="kpi-value">—</div>
      <div class="kpi-sub">기록 없음</div>
    </div>`;
    }
    kpiHtml = `
  <div class="mini-kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">이번 달 평균 <small>(${monthTests.length}회 시험)</small></div>
      <div class="kpi-value">${f1(thisAvg)}<span class="kpi-unit">점</span></div>
      <div class="kpi-sub">${monthLabel}</div>
    </div>
    ${prevCard}
  </div>`;
  }

  let topicHtml = '';
  if (monthlyTopicStats && monthlyTopicStats.length > 0) {
    const stats = [...monthlyTopicStats].sort(
      (a, b) => (b.total ? b.correct / b.total : 0) - (a.total ? a.correct / a.total : 0),
    );
    let barRows = '';
    for (const s of stats) {
      if (!s.total) continue;
      const pct = pyRound((s.correct / s.total) * 100);
      const barColor = pct >= 70 ? BRAND_BLUE : BRAND_PINK;
      barRows += `
<div class="type-row-box">
  <div class="type-row-top">
    <span class="type-row-label">${esc(s.topic || '미분류')}</span>
    <span class="type-row-count">${s.correct}/${s.total}문항</span>
    <span class="type-row-pct">${pct}%</span>
  </div>
  <div class="type-bar-bg">
    <div class="type-bar-fill" style="width:${pct}%;background:${barColor};"></div>
  </div>
</div>`;
    }
    if (barRows) {
      topicHtml = `
  <div style="margin-top:4px;">
    <div style="font-size:13px;font-weight:700;color:#5B6B8C;margin:0 2px 10px;">단원별 누적 정답률 (이번 달 전체 시험 기준)</div>
    ${barRows}
  </div>`;
    }
  }

  return `
  <!-- 이번 달 학습 리포트 (프리미엄) -->
  <div class="section">
    <div class="sec-title">이번 달 학습 리포트 <small>${monthLabel}</small></div>
    ${kpiHtml}
    ${listHtml}
    ${topicHtml}
  </div>`;
}

// ── 오답 상세 카드 ──
const DIFF_CLASS: Record<string, string> = { A: 'diff-A', B: 'diff-B', C: 'diff-C', D: 'diff-D', E: 'diff-E' };
const DIFF_LABEL: Record<string, string> = { A: '최상', B: '상', C: '중상', D: '중', E: '하' };

/** 표준/프리미엄 보고서의 오답 카드에 AI 한줄평을 붙일 문항 목록(세부정보 있는 오답만). */
export function wrongDetailsForAi(wrongNumbers: number[], details: QuestionDetail[] | null) {
  const map = detailMap(details);
  const out: { number: number; topic: string; method: string; difficulty: string }[] = [];
  for (const n of wrongNumbers) {
    const d = map.get(n);
    if (d) out.push({ number: n, topic: d.topic || '미분류', method: d.questionMethod || '', difficulty: d.difficulty || '' });
  }
  return out;
}

function buildWrongDetailCards(
  wrongNumbers: number[],
  details: QuestionDetail[] | null,
  comments: Record<number, string>,
): string {
  if (wrongNumbers.length === 0) return '<span class="no-wrong">오답 없음 🎉</span>';
  if (!details || details.length === 0) {
    const badges = wrongNumbers.map((n) => `<span class="wrong-badge">${n}번</span>`).join('');
    return `<div class="wrong-card-no-detail">${badges}</div>`;
  }

  const map = detailMap(details);
  const cards: string[] = [];
  for (const n of wrongNumbers) {
    const d = map.get(n);
    const comment = comments[n] ?? '';
    if (!d) {
      cards.push(
        `<div class="wrong-card">` +
          `<div class="wrong-card-header">` +
          `<span class="wrong-card-num">${n}번</span>` +
          `<span class="wrong-card-topic" style="color:#8A93A6;">문항 정보 없음</span>` +
          `</div></div>`,
      );
      continue;
    }
    const topic = d.topic || '미분류';
    const method = d.questionMethod || '';
    const diff = (d.difficulty || '').toUpperCase();
    const diffCls = DIFF_CLASS[diff] ?? 'diff-default';
    const diffLbl = DIFF_LABEL[diff] ?? (d.difficulty || '—');

    const methodHtml = method
      ? `<div class="wrong-card-meta">` +
        `<span class="wrong-card-method-label">풀이유형</span>` +
        `<span class="wrong-card-method">${esc(method)}</span>` +
        `</div>`
      : '';
    const commentHtml = comment ? `<div class="wrong-card-comment">${esc(comment)}</div>` : '';

    cards.push(`
<div class="wrong-card">
  <div class="wrong-card-header">
    <span class="wrong-card-num">${n}번</span>
    <span class="wrong-card-topic">${esc(topic)}</span>
    <span class="wrong-card-diff ${diffCls}">난이도 ${esc(diffLbl)}</span>
  </div>
  ${methodHtml}
  ${commentHtml}
</div>`);
  }
  return `<div class="wrong-card-list">${cards.join('')}</div>`;
}

// ── 정규분포 곡선 SVG ──
function buildNormalDist(p: {
  allScores: number[];
  score: number;
  rank: number | null;
  totalStudents: number | null;
}): string {
  const { allScores, score, rank, totalStudents } = p;
  const meanS = pyRound(allScores.reduce((a, b) => a + b, 0) / allScores.length, 1);
  let stdS = sampleStdev(allScores);
  if (stdS < 1) stdS = 1.0;
  const percentile = pyRound((allScores.filter((s) => s < score).length / allScores.length) * 100);
  const rankStr = rank && totalStudents ? `${rank}위 / ${totalStudents}명` : '';
  const scoreInt = Math.trunc(score);
  const meanStr = f1(meanS);
  const topPct = 100 - percentile;

  const W = 500;
  const H = 140;
  const xMin = meanS - 3.5 * stdS;
  const xMax = meanS + 3.5 * stdS;
  const steps = 200;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const toX = (v: number) => r2(((v - xMin) / (xMax - xMin)) * W);
  const gauss = (v: number) => Math.exp(-0.5 * ((v - meanS) / stdS) ** 2);

  const pts: number[] = [];
  for (let i = 0; i <= steps; i++) pts.push(xMin + (i * (xMax - xMin)) / steps);
  const yPts = pts.map(gauss);
  const maxY = Math.max(...yPts);
  const toY = (v: number) => r2(H - 10 - (v / maxY) * (H - 20));
  const baseY = toY(0);

  const pathD = pts.map((x, i) => `${i === 0 ? 'M' : 'L'}${toX(x)},${toY(yPts[i])}`).join(' ');

  const fillParts = [`M${toX(pts[0])},${baseY}`];
  pts.forEach((x, i) => {
    if (x <= score) fillParts.push(`L${toX(x)},${toY(yPts[i])}`);
  });
  let fillD = '';
  if (fillParts.length > 1) {
    const lastX = toX(Math.min(score, pts[pts.length - 1]));
    fillParts.push(`L${lastX},${baseY} Z`);
    fillD = fillParts.join(' ');
  }

  const sx = toX(score);
  const syTop = toY(gauss(score));
  const labelX = sx < W * 0.7 ? sx + 8 : sx - 8;
  const labelAnchor = sx < W * 0.7 ? 'start' : 'end';
  const meanX = toX(meanS);

  const rankHtml = rankStr
    ? `<div style="text-align:center;">
      <div style="font-size:11px;color:#8A93A6;margin-bottom:2px;">석차</div>
      <div style="font-size:20px;font-weight:800;color:#1F2A44;">${rankStr}</div>
    </div>`
    : '';
  const fillPath = fillD ? `<path d="${fillD}" fill="url(#fillGrad)"/>` : '';

  return (
    '<div style="position:relative;">' +
    `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;">` +
    '<defs><linearGradient id="fillGrad" x1="0" y1="0" x2="0" y2="1">' +
    `<stop offset="0%" stop-color="${BRAND_BLUE}" stop-opacity="0.45"/>` +
    `<stop offset="100%" stop-color="${BRAND_BLUE}" stop-opacity="0.05"/>` +
    '</linearGradient></defs>' +
    fillPath +
    `<path d="${pathD}" fill="none" stroke="${BRAND_BLUE}" stroke-width="2.5"/>` +
    `<line x1="${sx}" y1="${syTop}" x2="${sx}" y2="${baseY}" stroke="${BRAND_PINK}" stroke-width="2" stroke-dasharray="4,3"/>` +
    `<circle cx="${sx}" cy="${syTop}" r="5" fill="${BRAND_PINK}" stroke="#fff" stroke-width="2"/>` +
    `<text x="${labelX}" y="${syTop - 8}" fill="#1F2A44" font-size="11" font-weight="700" text-anchor="${labelAnchor}">${scoreInt}점</text>` +
    `<text x="${meanX}" y="${H - 2}" fill="#8A93A6" font-size="10" text-anchor="middle">평균 ${meanStr}점</text>` +
    `<line x1="0" y1="${baseY}" x2="${W}" y2="${baseY}" stroke="#E3E8F2" stroke-width="1"/>` +
    '</svg>' +
    '<div style="display:flex;justify-content:center;gap:24px;margin-top:12px;flex-wrap:wrap;">' +
    `<div style="text-align:center;"><div style="font-size:11px;color:#8A93A6;margin-bottom:2px;">현재 점수</div><div style="font-size:20px;font-weight:800;color:${BRAND_BLUE};">${scoreInt}점</div></div>` +
    `<div style="text-align:center;"><div style="font-size:11px;color:#8A93A6;margin-bottom:2px;">반 평균</div><div style="font-size:20px;font-weight:800;color:#1F2A44;">${meanStr}점</div></div>` +
    `<div style="text-align:center;"><div style="font-size:11px;color:#8A93A6;margin-bottom:2px;">상위</div><div style="font-size:20px;font-weight:800;color:#1F2A44;">${topPct}%</div></div>` +
    rankHtml +
    '</div></div>'
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDateDisplay(testDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(testDate);
  if (!m) return testDate;
  return `${m[1]}년 ${m[2]}월 ${m[3]}일`;
}

function nowGeneratedAt(): string {
  const d = new Date();
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function buildAcademyTestReportHtml(p: AcademyTestReportInput): string {
  const logoInner = logoDataUrl
    ? `<img src="${logoDataUrl}" class="logo-img" alt="학원 로고">`
    : '<div class="logo-fallback">J MATH<span>+</span></div>';

  const wrongCount = p.wrongNumbers.length;
  const correctCount = p.totalQuestions - wrongCount;
  const accuracy = p.totalQuestions ? pyRound((correctCount / p.totalQuestions) * 100, 1) : 0;

  let classAvg: number | null = null;
  let rank: number | null = null;
  let totalStudents: number | null = null;
  if (p.allScores.length > 0) {
    classAvg = pyRound(p.allScores.reduce((a, b) => a + b, 0) / p.allScores.length, 1);
    rank = p.allScores.filter((s) => s > p.score).length + 1;
    totalStudents = p.allScores.length;
  }

  const recent = p.history.slice(-8);
  const historyLabels = recent.map((h) => Array.from(h.testName).slice(0, 10).join(''));
  const historyScores = recent.map((h) => h.score);

  const cat = (p.testCategory || '').trim() || '일일테스트';
  const cats = [...TEST_CATEGORIES];
  if (!cats.includes(cat)) cats.push(cat);
  const tabsStatic = cats.map((c) => `<span class="tab${c === cat ? ' active' : ''}">${esc(c)}</span>`).join('');

  const isLite = p.reportMode === 'lite';
  const isPremium = p.reportMode === 'premium';

  const kpiCards = buildKpiCards({
    score: p.score,
    accuracy,
    classAvg,
    rank,
    totalStudents,
    showClassAvg: p.showClassAvg,
    showClassRank: p.showClassRank && !isLite,
  });

  const attendanceSectionHtml = buildAttendanceSection(p.showAttendance, p.attendanceStats);
  const homeworkPerfSectionHtml = buildHomeworkPerformanceSection(p.showHomeworkPerf, p.homeworkPerfStats);

  let wrongSectionHtml: string;
  let typeAnalysisHtml: string;
  if (isLite) {
    wrongSectionHtml = buildWrongChips(p.wrongNumbers, p.questionDetails);
    typeAnalysisHtml = '';
  } else {
    wrongSectionHtml = buildWrongDetailCards(p.wrongNumbers, p.questionDetails, p.wrongComments);
    typeAnalysisHtml = buildTypeAnalysis(p.wrongNumbers, p.questionDetails, p.methodMapping);
  }

  const liteSummaryHtml = isLite
    ? buildLiteSummary({
        studentName: p.studentName,
        correctCount,
        totalQuestions: p.totalQuestions,
        wrongNumbers: p.wrongNumbers,
        details: p.questionDetails,
        teacherComment: p.teacherComment,
      })
    : '';

  const monthlySectionHtml = isPremium
    ? buildMonthlySection(p.history, p.testDate, p.monthlyTopicStats, p.prevMonthAvg)
    : '';

  let historyChartJs = '';
  let historyChartHtml = '';
  if (p.showHistoryChart && historyScores.length > 0) {
    historyChartHtml = '<div class="chart-wrap"><canvas id="historyChart"></canvas></div>';
    historyChartJs = `
        const hLabels = ${scriptJson(historyLabels)};
        const hScores = ${scriptJson(historyScores)};
        const hColors = hScores.map((v, i) => i === hScores.length - 1 ? '${BRAND_BLUE}' : '#C9CFDA');
        new Chart(document.getElementById('historyChart'), {
            type: 'bar',
            data: {
                labels: hLabels,
                datasets: [{
                    data: hScores,
                    backgroundColor: hColors,
                    borderRadius: 6,
                    maxBarThickness: 36,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: ctx => ctx.parsed.y + '점' } }
                },
                scales: {
                    y: {
                        min: 0, max: 100,
                        grid: { color: 'rgba(31,42,68,0.07)' },
                        ticks: { color: '#5B6B8C', callback: v => v + '점' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#5B6B8C', maxRotation: 30 }
                    }
                }
            }
        });
        `;
  }

  const normalDistHtml =
    p.allScores.length >= 2 && !isLite
      ? buildNormalDist({ allScores: p.allScores, score: p.score, rank, totalStudents })
      : '';

  const dateDisplay = formatDateDisplay(p.testDate);
  const generatedAt = nowGeneratedAt();
  const studentName = esc(p.studentName);
  const className = esc(p.className);

  const infoSection = isLite
    ? ''
    : `
  <!-- 시험 정보 -->
  <div class="section">
    <div class="sec-title">시험 정보 <small>${className} ${dateDisplay}</small></div>
    <div class="info-card">
      <div class="info-grid">
        <div class="info-item">
          <label>시험명</label>
          <span>${esc(p.testName)}</span>
        </div>
        <div class="info-item">
          <label>시험 유형</label>
          <span>${esc(cat)}</span>
        </div>
        <div class="info-item">
          <label>학교 · 학년</label>
          <span>${esc(p.school)} ${esc(p.grade)}</span>
        </div>
        <div class="info-item">
          <label>소속 반</label>
          <span>${className}</span>
        </div>
      </div>
    </div>
  </div>`;

  const commentSection = isLite
    ? ''
    : `
  <!-- 선생님이 전하는 말 -->
  <div class="section">
    <div class="comment-card">
      <div class="comment-title">선생님이 전하는 말</div>
      <div class="comment-text">${esc(p.teacherComment)}</div>
    </div>
  </div>`;

  const typeSection = typeAnalysisHtml
    ? `
  <div class="section">
    <div class="sec-title">유형별 진단</div>
    ${typeAnalysisHtml}
  </div>
  `
    : '';

  const historySection =
    p.showHistoryChart && historyScores.length > 0
      ? `
  <div class="section">
    <div class="sec-title">최근 점수 추이</div>
    <div class="chart-card">
      ${historyChartHtml}
    </div>
  </div>
  `
      : '';

  const distSection = normalDistHtml
    ? `
  <div class="section">
    <div class="sec-title">우리 반 점수 분포에서 내 위치</div>
    <div class="chart-card">
      <p style="font-size:12px;color:#8A93A6;margin-bottom:12px;">색칠된 영역이 ${studentName} 학생의 위치입니다.</p>
      ${normalDistHtml}
    </div>
  </div>
  `
    : '';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=834">
<title>${studentName} 학습 성취 보고서</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo',
                 'Noto Sans KR', 'Malgun Gothic', sans-serif;
    background: #EFF2F8;
    color: #1F2A44;
  }

  /* ── A4 페이지 ── */
  .page {
    width: 794px;              /* A4 폭 210mm ≈ 794px */
    margin: 0 auto;
    background: #FFFFFF;
    padding: 26px 30px 36px;
    box-shadow: 0 4px 30px rgba(31,42,68,0.10);
  }

  /* ── 헤더 밴드 (탭이 밴드 하단에 붙는 구조) ── */
  .hero {
    background: ${BRAND_BLUE};
    border-radius: 22px;
    padding: 26px 28px 0 26px;
  }
  .hero-main {
    display: flex;
    align-items: center;
    gap: 22px;
  }
  .hero-logo {
    width: 108px;
    height: 108px;
    background: #FFFFFF;
    border-radius: 50%;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .logo-img {
    width: 84%;
    height: 84%;
    object-fit: contain;
  }
  .logo-fallback {
    font-family: 'Arial Black', 'Malgun Gothic', sans-serif;
    font-size: 17px;
    font-weight: 900;
    color: #231F20;
    letter-spacing: 1px;
    position: relative;
  }
  .logo-fallback span {
    color: #F5C400;
    font-size: 14px;
    position: relative;
    top: -7px;
  }
  .hero-text {
    flex: 1;
    text-align: center;
    padding-right: 40px;
  }
  .hero-text h1 {
    color: #FFFFFF;
    font-size: 27px;
    font-weight: 800;
    letter-spacing: -0.5px;
    margin-bottom: 7px;
  }
  .hero-sub {
    color: rgba(255,255,255,0.85);
    font-size: 13px;
    letter-spacing: 0.3px;
  }

  /* ── 시험 유형 탭 (파란 밴드 안쪽 하단, 활성 탭이 흰 본문과 이어짐) ── */
  .tab-row {
    display: flex;
    justify-content: center;
    gap: 5px;
    margin-top: 20px;
    flex-wrap: wrap;
  }
  .tab {
    display: inline-block;
    padding: 10px 18px;
    border-radius: 10px 10px 0 0;
    font-size: 13px;
    font-weight: 700;
    background: transparent;
    color: #FFFFFF;
    border: 1.5px solid rgba(255,255,255,0.9);
    border-bottom: none;
    text-decoration: none;
  }
  .tab.active {
    background: #FFFFFF;
    color: ${BRAND_BLUE};
    border-color: #FFFFFF;
    font-weight: 800;
  }
  .tab.disabled {
    background: rgba(255,255,255,0.12);
    border-color: rgba(255,255,255,0.35);
    color: rgba(255,255,255,0.55);
    cursor: default;
    pointer-events: none;
  }
  .date-row {
    display: flex;
    gap: 6px;
    margin: 12px 4px 0;
    flex-wrap: wrap;
  }
  .date-chip {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 600;
    background: #EEF3FF;
    color: ${BRAND_BLUE};
    border: 1px solid #C9D9FF;
    text-decoration: none;
  }
  .date-chip.active {
    background: ${BRAND_BLUE};
    color: #FFFFFF;
    border-color: ${BRAND_BLUE};
  }

  /* ── 인사말 ── */
  .greeting {
    font-size: 13px;
    color: #5B6B8C;
    line-height: 1.7;
    margin: 14px 4px 26px;
  }

  /* ── 섹션 제목 (● 파란점 + 제목) ── */
  .sec-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
    font-weight: 800;
    color: #1F2A44;
    margin: 0 0 14px 2px;
  }
  .sec-title::before {
    content: '';
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: ${BRAND_BLUE};
    flex-shrink: 0;
  }
  .sec-title small {
    font-size: 12px;
    font-weight: 600;
    color: ${BRAND_BLUE};
    margin-left: 2px;
  }
  .section { margin-bottom: 34px; }

  /* ── 시험 정보 카드 ── */
  .info-card {
    background: #FFFFFF;
    border: 1.5px solid #BFD3FF;
    border-radius: 18px;
    padding: 24px 28px;
  }
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 22px 16px;
  }
  .info-item label {
    font-size: 12px;
    font-weight: 700;
    color: ${BRAND_BLUE};
    display: block;
    margin-bottom: 5px;
  }
  .info-item span {
    font-size: 15px;
    font-weight: 600;
    color: #1F2A44;
  }

  /* ── KPI 카드 ── */
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 16px;
  }
  .kpi-card {
    background: #FFFFFF;
    border: 1.5px solid #BFD3FF;
    border-radius: 16px;
    padding: 22px 16px 18px;
    text-align: center;
    box-shadow: 0 6px 14px rgba(74,124,255,0.10);
  }
  .kpi-label {
    font-size: 13px;
    font-weight: 700;
    color: #1F2A44;
    margin-bottom: 10px;
  }
  .kpi-value {
    font-size: 42px;
    font-weight: 800;
    color: ${BRAND_BLUE};
    letter-spacing: -1px;
    line-height: 1;
  }
  .kpi-unit {
    font-size: 16px;
    font-weight: 700;
    color: ${BRAND_BLUE};
    margin-left: 1px;
  }
  .kpi-sub {
    font-size: 12px;
    color: #5B6B8C;
    margin-top: 8px;
  }

  /* ── 차트 카드 ── */
  .chart-card {
    background: #FFFFFF;
    border: 1.5px solid #E3E8F2;
    border-radius: 18px;
    padding: 22px 24px;
  }
  .chart-wrap {
    position: relative;
    height: 250px;
  }

  /* ── 유형별 진단: 대표 우수/취약 박스 ── */
  .type-rep-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 18px;
  }
  .type-rep-box {
    border-radius: 16px;
    padding: 0 0 10px;
    border: 1.5px solid #E3E8F2;
    overflow: hidden;
    background: #FFFFFF;
  }
  .type-rep-box.rep-good { border-color: #BFD3FF; }
  .type-rep-box.rep-bad  { border-color: #FCD0DD; }
  .type-rep-title {
    font-size: 13px;
    font-weight: 800;
    color: #FFFFFF;
    text-align: center;
    padding: 9px 0;
    margin-bottom: 8px;
  }
  .rep-good .type-rep-title { background: ${BRAND_BLUE}; }
  .rep-bad  .type-rep-title { background: ${BRAND_PINK}; }
  .type-rep-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 18px;
    font-size: 13px;
  }
  .type-rep-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .rep-good .type-rep-dot { background: ${BRAND_BLUE}; }
  .rep-bad  .type-rep-dot { background: ${BRAND_PINK}; }
  .type-rep-label { color: #1F2A44; font-weight: 600; font-size: 13px; }
  .type-rep-empty { color: #8A93A6; font-size: 13px; padding: 7px 18px; }

  /* ── 유형별 진단: 단원별 바 리스트 ── */
  .type-row-box {
    background: #FFFFFF;
    border: 1.5px solid #E3E8F2;
    border-radius: 14px;
    padding: 16px 20px;
    margin-bottom: 12px;
  }
  .type-row-box:last-child { margin-bottom: 0; }
  .type-row-top {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  .type-row-label {
    font-size: 14px;
    color: #1F2A44;
    font-weight: 700;
    flex: 1;
  }
  .type-row-count {
    font-size: 11px;
    color: #8A93A6;
    margin-right: 6px;
  }
  .type-row-pct {
    font-size: 15px;
    font-weight: 800;
    color: #1F2A44;
    min-width: 42px;
    text-align: right;
  }
  .type-badge {
    font-size: 11px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 12px;
    flex-shrink: 0;
    color: #FFFFFF;
  }
  .type-badge-good { background: ${BRAND_BLUE}; }
  .type-badge-bad  { background: ${BRAND_PINK}; }
  .type-bar-bg {
    background: #EEF1F6;
    border-radius: 5px;
    height: 9px;
    overflow: hidden;
  }
  .type-bar-fill {
    height: 100%;
    border-radius: 5px;
  }

  /* ── 오답 문항 카드 ── */
  .wrong-card-list {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .wrong-card {
    background: #FFFFFF;
    border: 1.5px solid #FCD0DD;
    border-radius: 16px;
    padding: 18px 22px;
  }
  .wrong-card-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .wrong-card-num {
    background: ${BRAND_PINK};
    color: #fff;
    font-size: 13px;
    font-weight: 800;
    padding: 4px 14px;
    border-radius: 20px;
    white-space: nowrap;
  }
  .wrong-card-topic {
    font-size: 15px;
    font-weight: 700;
    color: #1F2A44;
    flex: 1;
  }
  .wrong-card-diff {
    font-size: 11px;
    font-weight: 700;
    padding: 3px 12px;
    border-radius: 12px;
    white-space: nowrap;
    border: 1.5px solid transparent;
  }
  /* 난이도: 최상 → 하 (확정 색상표) */
  .diff-A { background:#FF5555; color:#FFFFFF; border-color:#FF5555; }
  .diff-B { background:#4A7CFF; color:#FFFFFF; border-color:#4A7CFF; }
  .diff-C { background:#13AE67; color:#FFFFFF; border-color:#13AE67; }
  .diff-D { background:#8FC31F; color:#FFFFFF; border-color:#8FC31F; }
  .diff-E { background:#F8B62D; color:#FFFFFF; border-color:#F8B62D; }
  .diff-default { background:#F0F2F6; color:#6B7280; border-color:#D8DCE4; }
  .wrong-card-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }
  .wrong-card-method-label {
    font-size: 11px;
    color: #8A93A6;
    font-weight: 600;
  }
  .wrong-card-method {
    background: #EEF3FF;
    color: ${BRAND_BLUE};
    font-size: 12px;
    font-weight: 600;
    padding: 3px 12px;
    border-radius: 10px;
  }
  .wrong-card-comment {
    background: #FDF2F5;
    border: 1px solid #FAD8E2;
    border-radius: 10px;
    padding: 12px 16px;
    font-size: 13px;
    color: #A0455E;
    line-height: 1.7;
  }
  .wrong-badge {
    background: #FDEEF2;
    border: 1.5px solid ${BRAND_PINK};
    color: #E14D67;
    font-size: 13px;
    font-weight: 700;
    padding: 6px 16px;
    border-radius: 30px;
    display: inline-block;
  }
  .wrong-card-no-detail {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .no-wrong {
    background: #E8F8EF;
    border: 1.5px solid #86EFAC;
    color: #16A34A;
    font-size: 13px;
    font-weight: 700;
    padding: 6px 16px;
    border-radius: 30px;
    display: inline-block;
  }

  /* ── 선생님이 전하는 말 ── */
  .comment-card {
    background: #FFFFFF;
    border: 1.5px solid #BFD3FF;
    border-radius: 18px;
    padding: 26px 30px;
  }
  .comment-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 800;
    color: #1F2A44;
    margin-bottom: 14px;
  }
  .comment-title::before {
    content: '';
    width: 9px; height: 9px;
    border-radius: 50%;
    background: ${BRAND_BLUE};
  }
  .comment-text {
    color: #3A4763;
    font-size: 14px;
    line-height: 1.9;
  }

  /* ── 프리미엄: 월간 누적 분석 ── */
  .mini-kpi-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 18px;
  }
  .month-list {
    background: #FFFFFF;
    border: 1.5px solid #E3E8F2;
    border-radius: 16px;
    padding: 10px 20px;
    margin-bottom: 18px;
  }
  .month-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 11px 2px;
    border-bottom: 1px solid #EEF1F6;
    font-size: 13px;
  }
  .month-row:last-child { border-bottom: none; }
  .month-date { color: #8A93A6; font-size: 12px; min-width: 84px; }
  .month-name { flex: 1; font-weight: 600; color: #1F2A44; }
  .month-score { font-weight: 800; color: ${BRAND_BLUE}; font-size: 14px; }
  .delta-up   { color: #13AE67; font-weight: 700; }
  .delta-down { color: #FF5555; font-weight: 700; }

  /* ── 푸터 ── */
  .footer {
    text-align: center;
    padding-top: 26px;
    margin-top: 6px;
    color: #8A93A6;
    font-size: 11px;
    border-top: 1px solid #E3E8F2;
  }
  .footer strong { color: #1F2A44; }

  /* ── 인쇄 (A4) ── */
  @page { size: A4; margin: 8mm; }
  @media print {
    body { background: #FFFFFF; }
    .page {
      width: auto;
      box-shadow: none;
      padding: 0;
      transform: none !important;
    }
    .tab-row, .date-row { display: none; }
    .hero { padding-bottom: 26px; }
    .section, .kpi-card, .info-card, .chart-card,
    .wrong-card, .comment-card, .type-rep-box, .type-row-box {
      break-inside: avoid;
    }
  }
</style>
</head>
<body>

<div class="page">

  <!-- 헤더 (탭 포함 파란 밴드) -->
  <div class="hero">
    <div class="hero-main">
      <div class="hero-logo">${logoInner}</div>
      <div class="hero-text">
        <h1>${studentName} 학생 보고서</h1>
        <div class="hero-sub">${className} &nbsp;·&nbsp; ${dateDisplay}</div>
      </div>
    </div>
    <!-- 시험 유형 탭 (학부모 열람 페이지에서 실시간 링크로 치환됨) -->
    <div class="tab-row"><!--TABS_START-->${tabsStatic}<!--TABS_END--></div>
  </div>
  <!--DATES_START--><!--DATES_END-->

  <!-- 인사말 -->
  <div class="greeting">
    ${PARENT_GREETING}<br>${studentName} 학생의 학습 결과 보고서를 보내드립니다.
  </div>

  ${infoSection}

  <!-- 핵심 지표 -->
  <div class="section">
    <div class="sec-title">핵심 지표</div>
    <div class="kpi-grid">
      ${kpiCards}
    </div>
  </div>

  ${attendanceSectionHtml}

  ${homeworkPerfSectionHtml}

  <!-- 유형별 진단 -->
  ${typeSection}

  <!-- 오답 문항 분석 -->
  <div class="section">
    <div class="sec-title">오답 문항 분석</div>
    ${wrongSectionHtml}
  </div>

  ${liteSummaryHtml}

  <!-- 최근 점수 추이 -->
  ${historySection}

  <!-- 반 분포 곡선 -->
  ${distSection}

  ${monthlySectionHtml}

  ${commentSection}

  <!-- 푸터 -->
  <div class="footer">
    <strong>${ACADEMY_NAME}</strong> &nbsp;·&nbsp; 본 보고서는 AI 분석을 기반으로 작성되었습니다.<br>
    생성일시: ${generatedAt}
  </div>

</div>

<script>
${historyChartJs}

// ── 모바일 화면 맞춤: 화면이 A4 폭보다 좁으면 페이지 전체를 축소 ──
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
