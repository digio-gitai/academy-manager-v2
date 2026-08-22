import { useState } from 'react';
import type { ExamGroup, UnifiedGradeRecord } from '../../types/grades';
import { EXAM_GROUP_LABELS } from '../../types/grades';
import styles from './GradeTrendChart.module.css';

const GROUP_COLORS: Record<ExamGroup, { line: string; fill: string }> = {
  school: { line: '#2563EB', fill: 'rgba(37,99,235,0.10)' },
  mock: { line: '#F97316', fill: 'rgba(249,115,22,0.10)' },
  academy: { line: '#16A34A', fill: 'rgba(22,163,74,0.10)' },
};

const WIDTH = 640;
const HEIGHT = 320;
const PAD = { top: 24, right: 24, bottom: 36, left: 40 };

interface GradeTrendChartProps {
  records: UnifiedGradeRecord[];
}

/**
 * 스트림릿의 Plotly 성적 추이 그래프(카테고리별 색상 + 100점 기준선)를
 * 별도 라이브러리 없이 순수 SVG로 재현. 체크박스로 학교/모의/학원 필터.
 */
export function GradeTrendChart({ records }: GradeTrendChartProps) {
  const [showSchool, setShowSchool] = useState(true);
  const [showMock, setShowMock] = useState(true);
  const [showAcademy, setShowAcademy] = useState(true);

  const activeGroups: ExamGroup[] = [
    ...(showSchool ? (['school'] as ExamGroup[]) : []),
    ...(showMock ? (['mock'] as ExamGroup[]) : []),
    ...(showAcademy ? (['academy'] as ExamGroup[]) : []),
  ];
  const filtered = records.filter((r) => activeGroups.includes(r.examGroup));

  const dates = filtered.map((r) => new Date(r.examDate + 'T00:00:00').getTime());
  const minDate = dates.length ? Math.min(...dates) : 0;
  const maxDate = dates.length ? Math.max(...dates) : 1;
  const dateSpan = maxDate - minDate || 1;

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  function xFor(dateStr: string) {
    const t = new Date(dateStr + 'T00:00:00').getTime();
    return PAD.left + ((t - minDate) / dateSpan) * plotW;
  }
  function yFor(score: number) {
    const clamped = Math.max(0, Math.min(110, score));
    return PAD.top + (1 - clamped / 110) * plotH;
  }

  const series = (['school', 'mock', 'academy'] as ExamGroup[])
    .map((g) => ({
      group: g,
      points: filtered
        .filter((r) => r.examGroup === g)
        .sort((a, b) => (a.examDate < b.examDate ? -1 : 1)),
    }))
    .filter((s) => s.points.length > 0);

  const y100 = yFor(100);

  return (
    <div className={styles.card}>
      <h3 className={styles.sectionTitle}>성적 변화 추이</h3>
      <p className={styles.caption}>학교 · 모의 · 학원시험 유형별 수학 점수 추이</p>

      <div className={styles.filterRow}>
        <label className={styles.checkLabel}>
          <input type="checkbox" checked={showSchool} onChange={(e) => setShowSchool(e.target.checked)} />
          🏫 학교시험
        </label>
        <label className={styles.checkLabel}>
          <input type="checkbox" checked={showMock} onChange={(e) => setShowMock(e.target.checked)} />
          📝 모의고사
        </label>
        <label className={styles.checkLabel}>
          <input type="checkbox" checked={showAcademy} onChange={(e) => setShowAcademy(e.target.checked)} />
          🏆 학원시험
        </label>
      </div>

      {series.length === 0 ? (
        <p className={styles.emptyText}>그래프를 표시할 성적 데이터가 없습니다.</p>
      ) : (
        <>
          <div className={styles.chartWrap}>
            <svg className={styles.svgChart} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img">
              {/* y축 그리드 */}
              {[0, 20, 40, 60, 80, 100].map((v) => (
                <line
                  key={v}
                  x1={PAD.left}
                  x2={WIDTH - PAD.right}
                  y1={yFor(v)}
                  y2={yFor(v)}
                  stroke="#e2e8f0"
                  strokeWidth={1}
                />
              ))}
              {[0, 20, 40, 60, 80, 100].map((v) => (
                <text key={v} x={PAD.left - 8} y={yFor(v) + 4} fontSize={11} fill="#64748b" textAnchor="end">
                  {v}
                </text>
              ))}

              {/* 100점 기준선 */}
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y100}
                y2={y100}
                stroke="#94a3b8"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />

              {series.map((s) => {
                const c = GROUP_COLORS[s.group];
                const linePoints = s.points.map((p) => `${xFor(p.examDate)},${yFor(p.score)}`).join(' ');
                const areaPoints = `${xFor(s.points[0].examDate)},${yFor(0)} ${linePoints} ${xFor(
                  s.points[s.points.length - 1].examDate,
                )},${yFor(0)}`;
                return (
                  <g key={s.group}>
                    <polygon points={areaPoints} fill={c.fill} stroke="none" />
                    <polyline points={linePoints} fill="none" stroke={c.line} strokeWidth={2.5} />
                    {s.points.map((p, i) => (
                      <g key={i}>
                        <circle cx={xFor(p.examDate)} cy={yFor(p.score)} r={4.5} fill="#fff" stroke={c.line} strokeWidth={2.5} />
                        <text
                          x={xFor(p.examDate)}
                          y={yFor(p.score) - 10}
                          fontSize={11}
                          fill={c.line}
                          textAnchor="middle"
                        >
                          {p.score}
                        </text>
                      </g>
                    ))}
                  </g>
                );
              })}
            </svg>
          </div>
          <div className={styles.legend}>
            {series.map((s) => (
              <span key={s.group} className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: GROUP_COLORS[s.group].line }} />
                {EXAM_GROUP_LABELS[s.group]}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
