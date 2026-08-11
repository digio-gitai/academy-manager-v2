"""Standalone HTML grade report generator (stdlib only)."""

import html
import json

_DIFF_LEVELS = ("최상", "상", "중", "하", "최하")
_TYPE_COLORS = {
    "객관식": "#5574d6",
    "주관식&서술형": "#9b5de5",
    "주관식": "#9b5de5",
    "서술형": "#9b5de5",
}
_COG_DOMAINS = ("계산", "이해", "추론", "해결")


def generate_html_report(data: dict) -> str:
    """
    Build a standalone HTML report string from structured exam data.

    Expected keys (all optional unless noted):
      student_name, grade_level, academy_name, exam_title, parent_comment,
      total_score, weighted_score, correct_rate, national_avg, national_delta,
      total_correct, total_questions,
      type_analysis, difficulty_analysis, difficulty_by_type,
      cognitive_analysis, unit_analysis, type_detail, irt_stats,
      unit_chart_refs
    """
    esc = html.escape

    student_name = esc(str(data.get("student_name", "")))
    grade_level = esc(str(data.get("grade_level", "")))
    academy_name = esc(str(data.get("academy_name", "")))
    exam_title = esc(str(data.get("exam_title", "")))
    parent_comment_safe = esc(str(data.get("parent_comment", "") or "")).replace(
        "\n", "<br>"
    )

    total_score = float(data.get("total_score", 0))
    weighted_score = float(data.get("weighted_score", total_score))
    correct_rate = float(data.get("correct_rate", 0))
    national_avg = float(data.get("national_avg", 0))
    national_delta = float(data.get("national_delta", total_score - national_avg))

    type_analysis = list(data.get("type_analysis") or [])
    difficulty_analysis = list(data.get("difficulty_analysis") or [])
    difficulty_by_type = list(data.get("difficulty_by_type") or [])
    cognitive_analysis = list(data.get("cognitive_analysis") or [])
    unit_analysis = list(data.get("unit_analysis") or [])
    type_detail = list(data.get("type_detail") or [])
    irt = dict(data.get("irt_stats") or {})
    unit_chart_refs = dict(data.get("unit_chart_refs") or {})

    total_correct = int(
        data.get("total_correct")
        or sum(int(t.get("correct", 0)) for t in type_analysis)
        or 0
    )
    total_questions = int(
        data.get("total_questions")
        or sum(int(t.get("total", 0)) for t in type_analysis)
        or 0
    )

    delta_sign = "+" if national_delta >= 0 else "−"
    delta_abs = abs(national_delta)
    delta_cls = "pos" if national_delta >= 0 else "neg"

    def pct_class(pct: float) -> str:
        if pct >= 80:
            return "green"
        if pct <= 40:
            return "red"
        if pct <= 60:
            return "orange"
        return "blue"

    def fmt_delta(own: float, nat: float) -> tuple[str, str, str]:
        d = own - nat
        if d >= 0:
            return f"+{d:.1f}", "pos", "green"
        return f"−{abs(d):.1f}", "neg", "red"

    # ── type table ──
    type_rows: list[str] = []
    for item in type_analysis:
        ttype = esc(str(item.get("type", "")))
        own = float(item.get("own_pct", 0))
        nat = float(item.get("national_pct", 0))
        d_str, _, d_color = fmt_delta(own, nat)
        color = _TYPE_COLORS.get(str(item.get("type", "")), "#5574d6")
        type_rows.append(
            f'<tr><td class="left" style="color:{color};font-weight:700">{ttype}</td>'
            f'<td>{int(item.get("total", 0))}</td>'
            f'<td class="blue">{int(item.get("correct", 0))}</td>'
            f'<td class="orange">{int(item.get("wrong", 0))}</td>'
            f"<td>{own:.1f}</td><td>{nat:.1f}</td>"
            f'<td class="{d_color}">{d_str}</td></tr>'
        )

    # ── difficulty matrix (page 1) ──
    diff_by_level = {str(d.get("level", "")): d for d in difficulty_analysis}

    def _level_vals(level: str, field: str) -> int:
        return int(diff_by_level.get(level, {}).get(field, 0))

    def _matrix_row(
        label: str,
        style: str,
        totals: list[int],
        corrects: list[int],
        score: str,
        label_style: str = "",
    ) -> str:
        tds_t = "".join(f"<td>{n if n else '—'}</td>" for n in totals)
        tds_c = "".join(
            f'<td class="blue">{c if c else "—"}</td>' for c in corrects
        )
        return (
            f'<tr{style}><td class="left" style="font-weight:700{label_style}">{label}</td>'
            f"{tds_t}{tds_c}<td class=\"orange\">{score}</td></tr>"
        )

    matrix_rows: list[str] = []
    if difficulty_by_type:
        for item in difficulty_by_type:
            ttype = str(item.get("type", ""))
            levels = item.get("levels") or {}
            totals = [
                int((levels.get(lv) or {}).get("total", 0)) for lv in _DIFF_LEVELS
            ]
            corrects = [
                int((levels.get(lv) or {}).get("correct", 0)) for lv in _DIFF_LEVELS
            ]
            score_val = item.get("score", "—")
            score = f"{float(score_val):.1f}" if score_val != "—" else "—"
            color = _TYPE_COLORS.get(ttype, "")
            lbl_style = f";color:{color}" if color else ""
            matrix_rows.append(
                _matrix_row(esc(ttype), "", totals, corrects, score, lbl_style)
            )
    else:
        for ttype, color in (("객관식", "#5574d6"), ("주관식&amp;서술형", "#9b5de5")):
            matrix_rows.append(
                _matrix_row(
                    ttype,
                    "",
                    [0] * 5,
                    [0] * 5,
                    "—",
                    f";color:{color}",
                )
            )

    sum_totals = [_level_vals(lv, "total") for lv in _DIFF_LEVELS]
    sum_corrects = [_level_vals(lv, "correct") for lv in _DIFF_LEVELS]
    matrix_rows.append(
        _matrix_row(
            "합계",
            ' style="background:var(--c-bg)"',
            sum_totals,
            sum_corrects,
            f"{total_score:.1f}",
        )
    )

    # ── difficulty detail table (page 2) — always 5 levels ──
    diff_rows: list[str] = []
    for level in _DIFF_LEVELS:
        item = diff_by_level.get(level, {})
        own = float(item.get("own_pct", 0))
        nat = float(item.get("national_pct", 0))
        d_str, _, d_color = fmt_delta(own, nat)
        total = int(item.get("total", 0))
        correct = int(item.get("correct", 0))
        wrong = int(item.get("wrong", 0))
        if not item:
            diff_rows.append(
                f"<tr><td>{level}</td><td>0</td>"
                f'<td class="blue">0</td><td>0</td>'
                f"<td>—</td><td>—</td><td>—</td></tr>"
            )
        else:
            diff_rows.append(
                f"<tr><td>{level}</td><td>{total}</td>"
                f'<td class="blue">{correct}</td>'
                f'<td class="orange">{wrong if wrong else 0}</td>'
                f"<td>{nat:.1f}</td>"
                f'<td class="{pct_class(own)}">{own:.1f}</td>'
                f'<td class="{d_color}">{d_str}</td></tr>'
            )

    # ── cognitive — merge with default domains ──
    cog_by_domain = {str(c.get("domain", "")): c for c in cognitive_analysis}
    cog_items: list[str] = []
    cog_table_rows: list[str] = []
    for domain in _COG_DOMAINS:
        item = cog_by_domain.get(domain, {})
        pct = float(item.get("pct", 0))
        cls = pct_class(pct) if item else "blue"
        bar = {
            "green": "var(--c-positive)",
            "orange": "var(--c-accent)",
            "red": "var(--c-negative)",
            "blue": "var(--c-main)",
        }.get(cls, "var(--c-main)")
        note = esc(str(item.get("note", "")))
        total = int(item.get("total", 0))
        correct = int(item.get("correct", 0))
        wrong = int(item.get("wrong", 0))
        if item:
            cog_items.append(
                f'<div class="cog-item"><div class="cog-row">'
                f"<span>{domain}</span><span class=\"{cls}\">{pct:.1f}%</span></div>"
                f'<div class="cog-track"><div class="cog-fill" '
                f'style="width:{pct:.1f}%;background:{bar}"></div></div>'
                f'<div class="cog-note">{total}문항 · 정답 {correct} · '
                f"오답 {wrong} · {note}</div></div>"
            )
            cog_table_rows.append(
                f"<tr><td>{domain}</td><td>{total}</td>"
                f'<td class="blue">{correct}</td>'
                f'<td class="orange">{wrong if wrong else 0}</td>'
                f'<td class="{cls}">{pct:.1f}</td></tr>'
            )
        else:
            cog_items.append(
                f'<div class="cog-item"><div class="cog-row">'
                f"<span>{domain}</span><span>—</span></div>"
                f'<div class="cog-track"><div class="cog-fill" '
                f'style="width:0;background:#eee"></div></div>'
                f'<div class="cog-note">데이터 없음</div></div>'
            )
            cog_table_rows.append(
                f"<tr><td>{domain}</td><td>0</td>"
                f'<td class="blue">0</td><td>0</td><td>—</td></tr>'
            )

    # ── unit table ──
    unit_rows: list[str] = []
    for item in unit_analysis:
        pct = float(item.get("pct", 0))
        cls = pct_class(pct)
        unit_label = esc(
            f"{item.get('unit_code', '')} {item.get('unit_name', '')}".strip()
        )
        unit_rows.append(
            f'<tr><td>{esc(str(item.get("course", "")))}</td>'
            f'<td class="left">{unit_label}</td>'
            f'<td>{int(item.get("total", 0))}</td>'
            f'<td class="blue">{int(item.get("correct", 0))}</td>'
            f'<td class="orange">{int(item.get("wrong", 0))}</td>'
            f'<td class="{cls}">{pct:.1f}</td></tr>'
        )

    # ── type detail table rows (server-side) ──
    def _timebar(correct: int, total: int) -> str:
        segs = []
        for i in range(max(total, 0)):
            color = "#1a7a4a" if i < correct else "#cc2e2e"
            segs.append(
                f'<div style="flex:1;height:12px;border-radius:2px;background:{color}"></div>'
            )
        inner = "".join(segs) if segs else "—"
        return f'<div style="display:flex;gap:2px;width:80px">{inner}</div>'

    type_detail_rows: list[str] = []
    for item in type_detail:
        own = float(item.get("own_pct", 0))
        avg = float(item.get("avg_pct", 0))
        correct = int(item.get("correct", 0))
        total = int(item.get("total", 0))
        own_color = "#1a7a4a" if own >= 100 else "#cc2e2e" if own == 0 else "#e85d26"
        type_detail_rows.append(
            f'<tr><td>{esc(str(item.get("course", "")))}</td>'
            f'<td class="left">{esc(str(item.get("code", "")))}. '
            f'{esc(str(item.get("name", "")))}</td>'
            f"<td>{_timebar(correct, total)}</td>"
            f"<td>{correct}/{total}</td>"
            f'<td style="font-weight:700;color:{own_color}">{own:.1f}</td>'
            f"<td>{avg:.1f}</td></tr>"
        )

    td1 = type_detail[:14]
    td2 = type_detail[14:]

    # ── IRT / grade boxes ──
    percentile = float(irt.get("percentile", 0))
    rank = int(irt.get("rank", 0))
    grade = int(irt.get("grade", 0))
    mean_score = float(irt.get("mean_score", 0))
    std_dev = float(irt.get("std_dev", 0))
    z_score = float(irt.get("z_score", 0))
    upper_pct = 100.0 - percentile
    grade_cuts = dict(irt.get("grade_cuts") or {})
    item_count = int(irt.get("item_count", total_questions))

    grade_meta = [
        ("5등급", "하위 10%", grade_cuts.get("5등급", "—"), 5),
        ("4등급", "하위 34%", grade_cuts.get("4등급", "—"), 4),
        ("3등급", "중간", f"{grade_cuts.get('3등급_low', '—')} ~ {grade_cuts.get('3등급_high', '—')}", 3),
        ("2등급", "상위 34%", f"{grade_cuts.get('2등급', '—')} 이상", 2),
        ("1등급", "상위 10%", f"{grade_cuts.get('1등급', '—')} 이상", 1),
    ]
    grade_boxes: list[str] = []
    for gnum, glbl, gcut, gval in grade_meta:
        active = " active" if grade == gval else ""
        cut_str = f"{gcut} 이하" if gval >= 4 and gcut != "—" else str(gcut)
        if gval == 2:
            cut_str = f"{grade_cuts.get('2등급', gcut)} 이상"
        grade_boxes.append(
            f'<div class="g-box{active}"><div class="g-num">{gnum}</div>'
            f'<div class="g-lbl">{glbl}</div>'
            f'<div class="g-cut">{esc(str(cut_str))}</div></div>'
        )

    # ── chart JSON payloads ──
    type_labels = [str(t.get("type", "")) for t in type_analysis]
    type_national = [float(t.get("national_pct", 0)) for t in type_analysis]
    type_own = [float(t.get("own_pct", 0)) for t in type_analysis]
    type_totals = [int(t.get("total", 0)) for t in type_analysis]
    type_pie = type_totals if sum(type_totals) else [1] * max(len(type_analysis), 1)
    type_own_colors = [
        "#1a7a4a" if o >= n else "#e85d26"
        for o, n in zip(type_own, type_national)
    ]

    diff_labels = list(_DIFF_LEVELS)
    diff_national = [
        float(diff_by_level.get(lv, {}).get("national_pct", 0)) for lv in _DIFF_LEVELS
    ]
    diff_own = [float(diff_by_level.get(lv, {}).get("own_pct", 0)) for lv in _DIFF_LEVELS]
    diff_own_colors = [
        "#1a7a4a" if o >= n else "#e85d26" for o, n in zip(diff_own, diff_national)
    ]

    cog_labels = list(_COG_DOMAINS)
    cog_own = [
        float(cog_by_domain.get(d, {}).get("pct", 0)) for d in _COG_DOMAINS
    ]
    cog_national = [
        float(
            cog_by_domain.get(d, {}).get(
                "national_pct", cog_by_domain.get(d, {}).get("pct", 0)
            )
        )
        for d in _COG_DOMAINS
    ]

    unit_labels = [
        str(u.get("unit_code") or u.get("unit_name", "")) for u in unit_analysis
    ]
    unit_own = [float(u.get("pct", 0)) for u in unit_analysis]
    unit_colors = [
        "#1a5fd4" if p >= 70 else "#e85d26" if p < 55 else "#1a9e75" for p in unit_own
    ]
    unit_top10 = unit_chart_refs.get("top10")
    unit_top34 = unit_chart_refs.get("top34")
    if not unit_top10 or len(unit_top10) != len(unit_labels):
        unit_top10 = [min(p + 10, 95) for p in unit_own] if unit_own else []
    if not unit_top34 or len(unit_top34) != len(unit_labels):
        unit_top34 = [max(p - 5, 55) for p in unit_own] if unit_own else []

    type_detail_js = [
        {
            "code": str(item.get("code", "")),
            "name": str(item.get("name", "")),
            "correct": int(item.get("correct", 0)),
            "total": int(item.get("total", 0)),
            "own": float(item.get("own_pct", 0)),
            "avg": float(item.get("avg_pct", 0)),
        }
        for item in type_detail
    ]

    chart_script = f"""<script>
Chart.defaults.font.family = "'Noto Sans KR', sans-serif";
Chart.defaults.font.size = 10;
Chart.defaults.color = '#666';
const GRID = 'rgba(0,0,0,0.06)';
const TYPE_LABELS = {json.dumps(type_labels, ensure_ascii=False)};
const TYPE_NATIONAL = {json.dumps(type_national, ensure_ascii=False)};
const TYPE_OWN = {json.dumps(type_own, ensure_ascii=False)};
const TYPE_OWN_COLORS = {json.dumps(type_own_colors, ensure_ascii=False)};
const TYPE_PIE = {json.dumps(type_pie, ensure_ascii=False)};
const DIFF_LABELS = {json.dumps(diff_labels, ensure_ascii=False)};
const DIFF_NATIONAL = {json.dumps(diff_national, ensure_ascii=False)};
const DIFF_OWN = {json.dumps(diff_own, ensure_ascii=False)};
const DIFF_OWN_COLORS = {json.dumps(diff_own_colors, ensure_ascii=False)};
const COG_LABELS = {json.dumps(cog_labels, ensure_ascii=False)};
const COG_OWN = {json.dumps(cog_own, ensure_ascii=False)};
const COG_NATIONAL = {json.dumps(cog_national, ensure_ascii=False)};
const UNIT_LABELS = {json.dumps(unit_labels, ensure_ascii=False)};
const UNIT_OWN = {json.dumps(unit_own, ensure_ascii=False)};
const UNIT_COLORS = {json.dumps(unit_colors, ensure_ascii=False)};
const UNIT_TOP10 = {json.dumps(unit_top10, ensure_ascii=False)};
const UNIT_TOP34 = {json.dumps(unit_top34, ensure_ascii=False)};
const TYPE_DATA = {json.dumps(type_detail_js, ensure_ascii=False)};
const STUDENT_SCORE = {total_score:.1f};
const MEAN_SCORE = {mean_score:.1f};
const STD_DEV = {std_dev:.2f};
const Z_SCORE = {z_score:.2f};

if (document.getElementById('typeChart') && TYPE_LABELS.length) {{
  new Chart(document.getElementById('typeChart'), {{
    type: 'bar',
    data: {{
      labels: TYPE_LABELS,
      datasets: [
        {{ label: '전국 추정', data: TYPE_NATIONAL, backgroundColor: '#ccc', borderRadius: 3 }},
        {{ label: '본인', data: TYPE_OWN, backgroundColor: TYPE_OWN_COLORS, borderRadius: 3 }}
      ]
    }},
    options: {{
      responsive: true, maintainAspectRatio: false,
      plugins: {{ legend: {{ position:'top', labels:{{ boxWidth:10, padding:10 }} }} }},
      scales: {{
        x: {{ grid:{{ display:false }} }},
        y: {{ min:0, max:100, grid:{{ color:GRID }}, ticks:{{ stepSize:25 }} }}
      }}
    }}
  }});
}}
if (document.getElementById('pieChart') && TYPE_PIE.length) {{
  new Chart(document.getElementById('pieChart'), {{
    type: 'doughnut',
    data: {{
      labels: TYPE_LABELS,
      datasets: [{{ data: TYPE_PIE, backgroundColor:['#5574d6','#9b5de5','#1a9e75','#e85d26'], borderWidth:0 }}]
    }},
    options: {{ plugins:{{ legend:{{ display:false }} }}, cutout:'58%' }}
  }});
}}
if (document.getElementById('diffChart') && DIFF_LABELS.length) {{
  new Chart(document.getElementById('diffChart'), {{
    type: 'bar',
    data: {{
      labels: DIFF_LABELS,
      datasets: [
        {{ label:'전국 추정', data: DIFF_NATIONAL, backgroundColor:'#ccc', borderRadius:3 }},
        {{ label:'본인', data: DIFF_OWN, backgroundColor: DIFF_OWN_COLORS, borderRadius:3 }}
      ]
    }},
    options: {{
      responsive:true, maintainAspectRatio:false,
      plugins:{{ legend:{{ position:'top', labels:{{ boxWidth:10, padding:10 }} }} }},
      scales:{{
        x:{{ grid:{{ display:false }} }},
        y:{{ min:0, max:100, grid:{{ color:GRID }}, ticks:{{ stepSize:25 }} }}
      }}
    }}
  }});
}}
if (document.getElementById('radarChart') && COG_LABELS.length) {{
  new Chart(document.getElementById('radarChart'), {{
    type: 'radar',
    data: {{
      labels: COG_LABELS,
      datasets: [
        {{ label:'전국 추정', data: COG_NATIONAL, borderColor:'#aaa', backgroundColor:'rgba(170,170,170,0.1)', pointRadius:2 }},
        {{ label:'본인', data: COG_OWN, borderColor:'#1a5fd4', backgroundColor:'rgba(26,95,212,0.15)', pointRadius:3, borderWidth:2 }}
      ]
    }},
    options: {{
      responsive:false,
      plugins:{{ legend:{{ display:false }} }},
      scales:{{ r:{{ min:0, max:100, ticks:{{ display:false, stepSize:25 }}, grid:{{ color:GRID }}, pointLabels:{{ font:{{ size:11 }} }} }} }}
    }}
  }});
}}
if (document.getElementById('unitChart') && UNIT_LABELS.length) {{
  new Chart(document.getElementById('unitChart'), {{
    type: 'bar',
    data: {{
      labels: UNIT_LABELS,
      datasets: [
        {{ label:'상위 10%', data: UNIT_TOP10, type:'line', borderColor:'#cc2e2e', borderDash:[4,3], pointRadius:3, borderWidth:1.5, fill:false, tension:0.3 }},
        {{ label:'상위 34%', data: UNIT_TOP34, type:'line', borderColor:'#888', borderDash:[6,4], pointRadius:3, borderWidth:1, fill:false, tension:0.3 }},
        {{ label:'개인 정답률', data: UNIT_OWN, backgroundColor: UNIT_COLORS, borderRadius:3 }}
      ]
    }},
    options: {{
      responsive:true, maintainAspectRatio:false,
      plugins:{{ legend:{{ position:'top', labels:{{ boxWidth:10, padding:8, font:{{ size:9 }} }} }} }},
      scales:{{
        x:{{ grid:{{ display:false }} }},
        y:{{ min:0, max:100, grid:{{ color:GRID }}, ticks:{{ stepSize:25 }} }}
      }}
    }}
  }});
}}
if (document.getElementById('typeDetailChart1') && TYPE_DATA.length) {{
  const td1 = TYPE_DATA.slice(0, 14);
  new Chart(document.getElementById('typeDetailChart1'), {{
    type: 'bar',
    data: {{
      labels: td1.map(d => d.code),
      datasets: [
        {{ label:'전체 평균', data: td1.map(d => d.avg), backgroundColor:'#e0e0e0', borderRadius:2 }},
        {{ label:'본인', data: td1.map(d => d.own), backgroundColor: td1.map(d => d.own===100?'#1a5fd4':d.own===0?'#cc2e2e':'#e85d26'), borderRadius:2 }}
      ]
    }},
    options: {{
      responsive:true, maintainAspectRatio:false,
      plugins:{{ legend:{{ display:false }} }},
      scales:{{
        x:{{ grid:{{ display:false }}, ticks:{{ font:{{ size:9 }} }} }},
        y:{{ min:0, max:100, grid:{{ color:GRID }}, ticks:{{ stepSize:25 }} }}
      }}
    }}
  }});
}}
function normalPDF(x, mu, sigma) {{
  return Math.exp(-0.5*Math.pow((x-mu)/sigma,2)) / (sigma*Math.sqrt(2*Math.PI));
}}
if (document.getElementById('normalChart') && STD_DEV > 0) {{
  const mu = MEAN_SCORE, sigma = STD_DEV;
  const xs = [], ys = [];
  for (let x = mu - 3*sigma; x <= mu + 3*sigma; x += sigma/6) {{
    xs.push(x.toFixed(1));
    ys.push(+(normalPDF(x, mu, sigma)*100).toFixed(5));
  }}
  new Chart(document.getElementById('normalChart'), {{
    type: 'line',
    data: {{
      labels: xs,
      datasets: [
        {{ data: ys, borderColor:'#1a5fd4', borderWidth:2, fill:true, backgroundColor:'rgba(26,95,212,0.10)', pointRadius:0, tension:0.4 }},
        {{ data: xs.map((x,i) => Math.abs(parseFloat(x)-STUDENT_SCORE)<0.3 ? ys[i] : null), borderColor:'#cc2e2e', borderWidth:0, pointRadius:7, pointBackgroundColor:'#cc2e2e', showLine:false }}
      ]
    }},
    options: {{
      responsive:true, maintainAspectRatio:false,
      plugins:{{ legend:{{ display:false }} }},
      scales:{{
        x:{{ ticks:{{ maxTicksLimit:8, callback:(v,i)=>xs[i] }}, grid:{{ display:false }} }},
        y:{{ display:false }}
      }}
    }}
  }});
}}
</script>"""

    td1_rows = "".join(type_detail_rows[:14]) or '<tr><td colspan="6">데이터 없음</td></tr>'
    td2_rows = "".join(type_detail_rows[14:]) or '<tr><td colspan="6">데이터 없음</td></tr>'

    html_out = f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>학생 수학 성적 분석 보고서</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap">
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
<style>
  *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
  :root {{
    --c-main:#1a5fd4; --c-accent:#e85d26; --c-positive:#1a7a4a; --c-negative:#cc2e2e;
    --c-purple:#9b5de5; --c-teal:#1a9e75; --c-text:#1a1a1a; --c-muted:#666;
    --c-border:#e2e2e2; --c-bg:#f7f8fc; --page-w:794px; --page-h:1123px; --pad:30px;
  }}
  html, body {{ font-family:'Noto Sans KR',sans-serif; font-size:13px; color:var(--c-text); background:#e8eaef; }}
  .page {{
    width:var(--page-w); min-height:var(--page-h); background:#fff; margin:20px auto;
    padding:var(--pad); border:0.5px solid #ccc; position:relative; page-break-after:always;
  }}
  .page-header {{
    display:flex; align-items:flex-start; justify-content:space-between;
    margin-bottom:20px; padding-bottom:14px; border-bottom:2.5px solid var(--c-main);
  }}
  .h-student-tag {{ font-size:11px; color:var(--c-muted); margin-bottom:3px; }}
  .h-student-name {{ font-size:16px; font-weight:700; }}
  .h-center {{ text-align:center; }}
  .h-report-type {{ font-size:10px; font-weight:700; letter-spacing:2.5px; color:var(--c-main); margin-bottom:5px; }}
  .h-exam-title {{ font-size:14px; font-weight:700; }}
  .h-logo {{ width:68px; height:44px; background:var(--c-main); border-radius:8px; display:flex; align-items:center; justify-content:center; }}
  .h-logo span {{ color:#fff; font-size:12px; font-weight:700; text-align:center; line-height:1.4; }}
  .comment-section {{
    margin-bottom:20px; padding:14px 16px; background:var(--c-bg);
    border:0.5px solid var(--c-border); border-left:3px solid var(--c-main); border-radius:8px;
  }}
  .comment-title {{ font-size:12px; font-weight:700; color:var(--c-main); margin-bottom:8px; }}
  .comment-body {{ font-size:12px; line-height:1.8; color:var(--c-text); }}
  .sec-title {{ font-size:13px; font-weight:700; margin-bottom:10px; display:flex; align-items:center; gap:7px; }}
  .sec-title::before {{ content:''; display:inline-block; width:3px; height:14px; background:var(--c-main); border-radius:2px; }}
  .sec-sub {{ font-size:10px; font-weight:400; color:var(--c-muted); }}
  .summary-row {{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:20px; }}
  .s-card {{ border:0.5px solid var(--c-border); border-radius:8px; padding:10px 12px; }}
  .s-card .lbl {{ font-size:10px; color:var(--c-muted); margin-bottom:3px; }}
  .s-card .val {{ font-size:24px; font-weight:700; color:var(--c-main); line-height:1.1; }}
  .s-card .val.orange {{ color:var(--c-accent); }}
  .s-card .val.gray {{ color:#aaa; }}
  .s-card .sub {{ font-size:10px; color:var(--c-muted); margin-top:2px; }}
  .s-card .delta {{ font-size:11px; font-weight:700; margin-top:2px; }}
  .pos {{ color:var(--c-positive); }} .neg {{ color:var(--c-negative); }}
  table {{ width:100%; border-collapse:collapse; font-size:11px; }}
  th {{ background:var(--c-bg); padding:6px 8px; border:0.5px solid var(--c-border); text-align:center; font-size:10px; color:var(--c-muted); font-weight:700; }}
  td {{ padding:7px 8px; border:0.5px solid var(--c-border); text-align:center; }}
  td.left {{ text-align:left; }}
  .blue {{ color:var(--c-main); font-weight:700; }}
  .orange {{ color:var(--c-accent); font-weight:700; }}
  .green {{ color:var(--c-positive); font-weight:700; }}
  .red {{ color:var(--c-negative); font-weight:700; }}
  .chart-wrap {{ position:relative; width:100%; }}
  .type-grid {{ display:grid; grid-template-columns:1fr 190px; gap:16px; margin-bottom:20px; }}
  .pie-side {{ display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; }}
  .legend-item {{ display:flex; align-items:center; gap:5px; font-size:10px; color:var(--c-muted); }}
  .legend-sq {{ width:10px; height:10px; border-radius:2px; }}
  hr {{ border:none; border-top:0.5px solid var(--c-border); margin:16px 0; }}
  .radar-grid {{ display:grid; grid-template-columns:170px 1fr; gap:16px; align-items:start; }}
  .cog-list {{ display:flex; flex-direction:column; gap:10px; padding-top:4px; }}
  .cog-item .cog-row {{ display:flex; justify-content:space-between; font-size:11px; }}
  .cog-track {{ height:4px; background:#eee; border-radius:4px; margin:3px 0 2px; }}
  .cog-fill {{ height:4px; border-radius:4px; }}
  .cog-note {{ font-size:9px; color:var(--c-muted); }}
  .normal-grid {{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:16px; }}
  .n-stat {{ border:0.5px solid var(--c-border); border-radius:8px; padding:10px; text-align:center; }}
  .n-stat .nlbl {{ font-size:10px; color:var(--c-muted); margin-bottom:3px; }}
  .n-stat .nval {{ font-size:17px; font-weight:700; color:var(--c-main); }}
  .n-stat .nsub {{ font-size:10px; color:var(--c-muted); margin-top:2px; }}
  .grade-row {{ display:grid; grid-template-columns:repeat(5,1fr); gap:6px; margin-top:14px; }}
  .g-box {{ border:0.5px solid var(--c-border); border-radius:6px; padding:8px 6px; text-align:center; }}
  .g-box.active {{ background:var(--c-main); border-color:var(--c-main); }}
  .g-num {{ font-size:15px; font-weight:700; color:var(--c-muted); }}
  .g-box.active .g-num {{ color:#fff; }}
  .g-lbl {{ font-size:9px; color:var(--c-muted); }}
  .g-box.active .g-lbl {{ color:rgba(255,255,255,.75); }}
  .g-cut {{ font-size:11px; font-weight:700; color:var(--c-muted); margin-top:3px; }}
  .g-box.active .g-cut {{ color:#fff; }}
  .page-footer {{
    position:absolute; bottom:18px; left:var(--pad); right:var(--pad);
    display:flex; justify-content:space-between; font-size:10px; color:#bbb;
    border-top:0.5px solid var(--c-border); padding-top:6px;
  }}
</style>
</head>
<body>

<div class="page">
  <div class="page-header">
    <div>
      <div class="h-student-tag">{grade_level} · {academy_name}</div>
      <div class="h-student-name">{student_name}</div>
    </div>
    <div class="h-center">
      <div class="h-report-type">TEST &amp; ANALYSIS REPORT</div>
      <div class="h-exam-title">{exam_title}</div>
    </div>
    <div class="h-logo"><span>{academy_name}</span></div>
  </div>

  <div class="comment-section">
    <div class="comment-title">학부모님께 전하는 글</div>
    <div class="comment-body">{{{{parent_comment}}}}</div>
  </div>

  <div class="summary-row">
    <div class="s-card">
      <div class="lbl">종합점수</div>
      <div class="val">{total_score:.1f}</div>
      <div class="sub">{total_correct} / {total_questions}</div>
    </div>
    <div class="s-card">
      <div class="lbl">가중치 점수</div>
      <div class="val orange">{weighted_score:.1f}</div>
    </div>
    <div class="s-card">
      <div class="lbl">정답률</div>
      <div class="val">{correct_rate:.1f}%</div>
    </div>
    <div class="s-card">
      <div class="lbl">전국 추정 평균</div>
      <div class="val gray">{national_avg:.1f}</div>
      <div class="delta {delta_cls}">{delta_sign}{delta_abs:.1f}</div>
    </div>
  </div>

  <div class="sec-title">문제 타입 분석</div>
  <div class="type-grid">
    <div>
      <table style="margin-bottom:10px">
        <thead><tr>
          <th>타입</th><th>문항</th><th>정답</th><th>오답</th>
          <th>본인</th><th>전국 추정</th><th>Δ</th>
        </tr></thead>
        <tbody>{"".join(type_rows) if type_rows else '<tr><td colspan="7">데이터 없음</td></tr>'}</tbody>
      </table>
      <div class="chart-wrap" style="height:130px"><canvas id="typeChart"></canvas></div>
    </div>
    <div class="pie-side">
      <canvas id="pieChart" width="130" height="130"></canvas>
      <div>
        {"".join(f'<div class="legend-item"><div class="legend-sq" style="background:{_TYPE_COLORS.get(l, "#5574d6")}"></div> {esc(l)}</div>' for l in type_labels) if type_labels else ""}
      </div>
    </div>
  </div>

  <hr>
  <div class="sec-title">난이도별 분석</div>
  <table>
    <thead>
      <tr>
        <th rowspan="2">항목</th>
        <th colspan="5">출제 문항 수</th>
        <th colspan="5">정답 수</th>
        <th>최종점수<br><span style="font-weight:400">(100점 환산)</span></th>
      </tr>
      <tr>
        <th>최상</th><th>상</th><th>중</th><th>하</th><th>최하</th>
        <th>최상</th><th>상</th><th>중</th><th>하</th><th>최하</th>
        <th></th>
      </tr>
    </thead>
    <tbody>{"".join(matrix_rows)}</tbody>
  </table>
  <div class="page-footer"><span>{academy_name}</span><span>1 / 6</span></div>
</div>

<div class="page">
  <div class="sec-title">난이도별 분석 <span class="sec-sub">본인 정답률 vs 전국 추정 (IRT 기반)</span></div>
  <div class="chart-wrap" style="height:160px;margin-bottom:14px"><canvas id="diffChart"></canvas></div>
  <table style="margin-bottom:20px">
    <thead><tr>
      <th>난이도</th><th>문항</th><th>정답</th><th>오답</th>
      <th>전국 추정</th><th>본인</th><th>Δ</th>
    </tr></thead>
    <tbody>{"".join(diff_rows)}</tbody>
  </table>
  <hr>
  <div class="sec-title">인지영역 분석 <span class="sec-sub">계산 · 이해 · 추론 · 해결 영역별 성취도</span></div>
  <div class="radar-grid">
    <canvas id="radarChart" width="170" height="170"></canvas>
    <div>
      <div class="cog-list">{"".join(cog_items)}</div>
      <table style="margin-top:12px;font-size:10px">
        <thead><tr><th>영역</th><th>문항</th><th>정답</th><th>오답</th><th>정답률</th></tr></thead>
        <tbody>{"".join(cog_table_rows)}</tbody>
      </table>
    </div>
  </div>
  <div class="page-footer"><span>{academy_name}</span><span>2 / 6</span></div>
</div>

<div class="page">
  <div class="sec-title">단원별 분석 <span class="sec-sub">단원별 정답률</span></div>
  <div class="chart-wrap" style="height:180px;margin-bottom:16px"><canvas id="unitChart"></canvas></div>
  <table>
    <thead><tr><th>과정</th><th>단원</th><th>문항</th><th>정답</th><th>오답</th><th>정답률</th></tr></thead>
    <tbody>{"".join(unit_rows) if unit_rows else '<tr><td colspan="6">데이터 없음</td></tr>'}</tbody>
  </table>
  <div class="page-footer"><span>{academy_name}</span><span>3 / 6</span></div>
</div>

<div class="page">
  <div class="sec-title">유형별 분석 <span class="sec-sub">본인 정답률 기준</span></div>
  <div class="chart-wrap" style="height:130px;margin-bottom:14px"><canvas id="typeDetailChart1"></canvas></div>
  <table style="font-size:10px">
    <thead><tr>
      <th>과정</th><th>유형</th><th>시간순 정오결과</th><th>문항</th><th>본인</th><th>전체 평균</th>
    </tr></thead>
    <tbody>{td1_rows}</tbody>
  </table>
  <div class="page-footer"><span>{academy_name}</span><span>4 / 6</span></div>
</div>

<div class="page">
  <div class="sec-title">유형별 분석 <span class="sec-sub">(이어서)</span></div>
  <table style="font-size:10px">
    <thead><tr>
      <th>과정</th><th>유형</th><th>시간순 정오결과</th><th>문항</th><th>본인</th><th>전체 평균</th>
    </tr></thead>
    <tbody>{td2_rows}</tbody>
  </table>
  <div class="page-footer"><span>{academy_name}</span><span>5 / 6</span></div>
</div>

<div class="page">
  <div class="sec-title">학생 위치 분석 <span class="sec-sub">전국 IRT 추정 정규분포 기반 위치 분석</span></div>
  <div class="normal-grid">
    <div class="n-stat">
      <div class="nlbl">상위 백분위</div>
      <div class="nval" style="color:var(--c-positive)">상위 {upper_pct:.1f}%</div>
      <div class="nsub">백분위 {percentile:.1f}</div>
    </div>
    <div class="n-stat">
      <div class="nlbl">예상 등수·등급</div>
      <div class="nval">{rank}위 · {grade}등급</div>
    </div>
    <div class="n-stat">
      <div class="nlbl">실제 / 평균 점수</div>
      <div class="nval">{total_score:.1f} / {mean_score:.1f}</div>
      <div class="nsub" style="color:var(--c-positive)">Z-score {z_score:+.2f}</div>
    </div>
    <div class="n-stat">
      <div class="nlbl">표준편차 Z / Z값</div>
      <div class="nval">{std_dev:.2f} / {z_score:+.2f}</div>
      <div class="nsub">사용된 문항 {item_count}</div>
    </div>
  </div>
  <div class="chart-wrap" style="height:200px;margin-bottom:14px"><canvas id="normalChart"></canvas></div>
  <div class="grade-row">{"".join(grade_boxes)}</div>
  <div style="margin-top:16px;padding:12px;background:var(--c-bg);border-radius:8px;font-size:10px;color:var(--c-muted);line-height:1.8">
    <strong style="color:var(--c-text)">5등급 체계 안내</strong><br>
    같은 시험지를 전국 학생 100명이 풀었다고 가정했을 때, 우리 학생의 위치를 5단계 등급으로 표시합니다.<br>
    1등급 — 상위 10% · 2등급 — 상위 10~34% · 3등급 — 중간(34~66%) · 4등급 — 하위 10~34% · 5등급 — 하위 10%
  </div>
  <div class="page-footer"><span>{academy_name}</span><span>6 / 6</span></div>
</div>

{chart_script}
</body>
</html>"""
    return html_out.replace("{{parent_comment}}", parent_comment_safe)
