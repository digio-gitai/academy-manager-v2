"""claude_report.py
Claude API를 사용해 학부모용 HTML 보고서를 생성하는 모듈.

사용법:
    from claude_report import generate_parent_report_html, generate_teacher_comment_draft

주요 함수:
    generate_teacher_comment_draft(...)  → 선생님이 전하는 말 AI 초안 생성
    generate_parent_report_html(...)     → 전체 HTML 보고서 생성
"""

from __future__ import annotations

import json
import os
import re
import statistics
from datetime import datetime
from pathlib import Path
from typing import Any

import anthropic
from dotenv import load_dotenv

from branding import ACADEMY_NAME, PARENT_GREETING

load_dotenv()

# ── 로고 이미지 base64 인코딩 ──────────────────────────────────────────────
def _get_logo_base64() -> str:
    """학원 로고 이미지를 base64로 반환."""
    # 투명 배경 로고 (하드코딩)
    _LOGO_B64 = "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"
    if _LOGO_B64:
        return _LOGO_B64
    # 폴백: 파일에서 읽기
    logo_path = Path(__file__).resolve().parent / "academy_logo.png"
    if not logo_path.exists():
        logo_path = Path(__file__).resolve().parent / "profile_image_jjh_math_v2.png"
    if logo_path.exists():
        import base64
        with open(logo_path, "rb") as f:
            return base64.b64encode(f.read()).decode()
    return ""


# ── Claude 클라이언트 ──────────────────────────────────────────────────────
def _get_client() -> anthropic.Anthropic:
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError(".env 파일에 ANTHROPIC_API_KEY가 없습니다.")
    return anthropic.Anthropic(api_key=api_key)


# ── 선생님이 전하는 말 AI 초안 생성 ────────────────────────────────────────────
def generate_teacher_comment_draft(
    *,
    student_name: str,
    score: float,
    class_avg: float | None,
    rank: int | None,
    total_students: int | None,
    wrong_numbers: list[int],
    total_questions: int,
    history_scores: list[float],
    test_name: str,
) -> str:
    """Claude API로 선생님이 전하는 말 초안을 생성합니다.
    강사가 직접 수정할 수 있도록 따뜻하고 구체적으로 작성됩니다.
    """
    client = _get_client()

    wrong_count = len(wrong_numbers)
    correct_count = total_questions - wrong_count
    trend = ""
    if len(history_scores) >= 2:
        diff = history_scores[-1] - history_scores[-2]
        if diff > 0:
            trend = f"지난 시험 대비 {diff:.1f}점 향상"
        elif diff < 0:
            trend = f"지난 시험 대비 {abs(diff):.1f}점 하락"
        else:
            trend = "지난 시험과 동일한 점수"

    rank_str = f"{rank}/{total_students}" if rank and total_students else "집계 중"
    avg_str = f"{class_avg:.1f}점" if class_avg is not None else "집계 중"

    prompt = (
        f"수학학원 선생님이 학부모님께 보내는 코멘트를 작성해줘.\n\n"
        f"학생명: {student_name}\n"
        f"시험명: {test_name}\n"
        f"이번 점수: {score:.1f}점 ({total_questions}문항 중 {correct_count}개 정답)\n"
        f"오답 문항: {wrong_numbers if wrong_numbers else '없음'}\n"
        f"반 평균: {avg_str}\n"
        f"반 석차: {rank_str}\n"
        f"점수 추이: {trend if trend else '첫 시험'}\n\n"
        f"조건:\n"
        f"- 학부모님께 드리는 말투로 (존댓말)\n"
        f"- 3~4문장으로 간결하게\n"
        f"- 칭찬 + 구체적 피드백 + 응원 순서로\n"
        f"- 너무 형식적이지 않게, 진심이 느껴지게\n"
        f"- 학생 이름 꼭 포함\n"
        f"- 코멘트 텍스트만 출력 (다른 설명 없이)\n"
    )

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text.strip()


# ── 문항별 AI 한줄평 생성 ────────────────────────────────────────────────
def generate_wrong_question_comments(
    *,
    student_name: str,
    wrong_details: list[dict[str, Any]],  # [{"number":3,"topic":"이차방정식","method":"인수분해 풀이","difficulty":"B"}, ...]
) -> dict[int, str]:
    """오답 문항별 AI 한줄평을 생성합니다.
    반환: {문항번호: 한줄평 텍스트}
    """
    if not wrong_details:
        return {}
    try:
        client = _get_client()
    except Exception:
        return {}

    items_text = "\n".join(
        f"- {d['number']}번: 단원={d.get('topic','미분류')}, "
        f"풀이유형={d.get('method','') or '미분류'}, "
        f"난이도={d.get('difficulty','')}"
        for d in wrong_details
    )

    prompt = (
        f"수학 학원 선생님으로서, {student_name} 학생의 오답 문항에 대해 "
        f"학부모님이 읽을 문항별 한줄 피드백을 작성해줘.\n\n"
        f"오답 문항 목록:\n{items_text}\n\n"
        f"조건:\n"
        f"- 각 문항마다 1~2문장으로 간결하게\n"
        f"- 어떤 개념이 부족한지 + 어떻게 보완하면 좋은지 포함\n"
        f"- 학부모가 이해할 수 있는 쉬운 표현 사용\n"
        f"- 아래 JSON 형식으로만 출력 (다른 설명 없이):\n"
        f'{{"comments": [{{"number": 3, "comment": "한줄평 내용"}}, ...]}}'
    )

    try:
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1000,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = message.content[0].text.strip()
        # JSON 펜스 제거
        raw = re.sub(r"```json|```", "", raw).strip()
        data = json.loads(raw)
        return {int(item["number"]): str(item["comment"]) for item in data.get("comments", [])}
    except Exception as e:
        import traceback
        print(f"[AI 한줄평 오류] {e}")
        traceback.print_exc()
        return {}


# ── 반 석차 계산 ──────────────────────────────────────────────────────────
def _calc_rank(student_score: float, all_scores: list[float]) -> tuple[int, int]:
    """(석차, 전체인원) 반환"""
    n = len(all_scores)
    rank = sum(1 for s in all_scores if s > student_score) + 1
    return rank, n


# ── HTML 보고서 생성 ──────────────────────────────────────────────────────
def generate_parent_report_html(
    *,
    student_name: str,
    school: str,
    grade: str,
    class_name: str,
    test_name: str,
    test_date: str,
    score: float,
    total_questions: int,
    wrong_numbers: list[int],
    all_scores: list[float],          # 반 전체 점수 (석차/평균 계산용)
    history: list[dict[str, Any]],    # [{"test_name":..,"date":..,"score":..}, ...]
    teacher_comment: str,
    # 선택 항목
    show_class_avg: bool = True,
    show_class_rank: bool = True,
    show_history_chart: bool = True,
    # 시험 종류 (일반/종합)
    test_type: str = "일반",          # "일반" or "종합"
    # 문항별 세부정보 (단원·풀이유형·난이도·AI한줄평)
    question_details: list[dict[str, Any]] | None = None,
) -> str:
    """HTML 보고서 문자열을 반환합니다."""

    logo_b64 = _get_logo_base64()
    logo_html = (
        f'<img src="data:image/png;base64,{logo_b64}" class="logo-img" alt="학원 로고">'
        if logo_b64 else
        f'<div class="logo-text">{ACADEMY_NAME}</div>'
    )

    # ── 통계 계산 ──
    wrong_count = len(wrong_numbers)
    correct_count = total_questions - wrong_count
    accuracy = round(correct_count / total_questions * 100, 1) if total_questions else 0

    class_avg: float | None = None
    rank: int | None = None
    total_students: int | None = None
    if all_scores:
        class_avg = round(sum(all_scores) / len(all_scores), 1)
        rank, total_students = _calc_rank(score, all_scores)

    # ── 점수 추이 데이터 ──
    history_labels = [h["test_name"][:10] for h in history[-8:]]
    history_scores_list = [h["score"] for h in history[-8:]]

    # ── KPI 카드 생성 ──
    kpi_cards = _build_kpi_cards(
        score=score,
        accuracy=accuracy,
        class_avg=class_avg,
        rank=rank,
        total_students=total_students,
        show_class_avg=show_class_avg,
        show_class_rank=show_class_rank,
    )

    # ── 오답 문항 세부 카드 빌드 ──
    wrong_section_html = _build_wrong_detail_cards(
        wrong_numbers=wrong_numbers,
        question_details=question_details,
        student_name=student_name,
    )

    # ── 유형별 진단표 빌드 ──
    type_analysis_html = _build_type_analysis(
        wrong_numbers=wrong_numbers,
        question_details=question_details,
    )

    # ── 점수 추이 차트 JS ──
    history_chart_js = ""
    history_chart_html = ""
    if show_history_chart and history_scores_list:
        history_chart_html = '<canvas id="historyChart"></canvas>'
        history_chart_js = f"""
        new Chart(document.getElementById('historyChart'), {{
            type: 'line',
            data: {{
                labels: {json.dumps(history_labels, ensure_ascii=False)},
                datasets: [{{
                    label: '내 점수',
                    data: {json.dumps(history_scores_list)},
                    borderColor: '#C9A84C',
                    backgroundColor: 'rgba(201,168,76,0.15)',
                    borderWidth: 3,
                    pointBackgroundColor: '#C9A84C',
                    pointRadius: 6,
                    pointHoverRadius: 8,
                    tension: 0.4,
                    fill: true,
                }}]
            }},
            options: {{
                responsive: true,
                plugins: {{
                    legend: {{ labels: {{ color: '#1B2A5E', font: {{ size: 13 }} }} }},
                    tooltip: {{ callbacks: {{ label: ctx => ctx.parsed.y + '점' }} }}
                }},
                scales: {{
                    y: {{
                        min: 0, max: 100,
                        grid: {{ color: 'rgba(27,42,94,0.08)' }},
                        ticks: {{ color: '#1B2A5E', callback: v => v + '점' }}
                    }},
                    x: {{
                        grid: {{ display: false }},
                        ticks: {{ color: '#1B2A5E', maxRotation: 30 }}
                    }}
                }}
            }}
        }});
        """

    # ── 정규분포 곡선 SVG 생성 ──
    normal_dist_js = ""
    normal_dist_html = ""
    if all_scores and len(all_scores) >= 2:
        import math as _math
        mean_s = round(sum(all_scores) / len(all_scores), 1)
        std_s = statistics.stdev(all_scores)
        if std_s < 1:
            std_s = 1.0
        percentile = round(sum(1 for s in all_scores if s < score) / len(all_scores) * 100)
        rank_str = f"{rank}위 / {total_students}명" if rank and total_students else ""
        score_int = int(score)
        mean_str = f"{mean_s:.1f}"
        top_pct = 100 - percentile

        # SVG 정규분포 곡선 생성
        W, H = 500, 140
        x_min = mean_s - 3.5 * std_s
        x_max = mean_s + 3.5 * std_s
        steps = 200

        def _to_x(v):
            return round((v - x_min) / (x_max - x_min) * W, 2)

        def _gauss(v):
            return _math.exp(-0.5 * ((v - mean_s) / std_s) ** 2)

        pts = [x_min + i * (x_max - x_min) / steps for i in range(steps + 1)]
        y_pts = [_gauss(x) for x in pts]
        max_y = max(y_pts)

        def _to_y(v):
            return round(H - 10 - (v / max_y) * (H - 20), 2)

        base_y = _to_y(0)

        # 전체 곡선 path
        path_d = " ".join(
            ("M" if i == 0 else "L") + str(_to_x(pts[i])) + "," + str(_to_y(y_pts[i]))
            for i in range(len(pts))
        )

        # 학생 위치까지 채우기
        fill_parts = [
            "M" + str(_to_x(pts[0])) + "," + str(base_y)
        ]
        for i, x in enumerate(pts):
            if x <= score:
                fill_parts.append("L" + str(_to_x(x)) + "," + str(_to_y(y_pts[i])))
        if len(fill_parts) > 1:
            last_x = _to_x(min(score, pts[-1]))
            fill_parts.append("L" + str(last_x) + "," + str(base_y) + " Z")
            fill_d = " ".join(fill_parts)
        else:
            fill_d = ""

        # 학생 위치
        sx = _to_x(score)
        sy_top = _to_y(_gauss(score))
        label_x = sx + 8 if sx < W * 0.7 else sx - 8
        label_anchor = "start" if sx < W * 0.7 else "end"
        mean_x = _to_x(mean_s)

        rank_html = ""
        if rank_str:
            rank_html = f'''<div style="text-align:center;">
      <div style="font-size:11px;color:#8A97B8;margin-bottom:2px;">석차</div>
      <div style="font-size:20px;font-weight:800;color:#1B2A5E;">{rank_str}</div>
    </div>'''

        fill_path = f'<path d="{fill_d}" fill="url(#fillGrad)"/>' if fill_d else ""
        score_label_x = str(label_x)
        score_label_y = str(sy_top - 8)
        score_label_anchor = label_anchor
        mean_label_x = str(mean_x)
        mean_label_y = str(H - 2)

        normal_dist_html = (
            '<div style="position:relative;">' +
            f'<svg viewBox="0 0 {W} {H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;">' +
            '<defs><linearGradient id="fillGrad" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#C9A84C" stop-opacity="0.6"/>' +
            '<stop offset="100%" stop-color="#C9A84C" stop-opacity="0.1"/>' +
            '</linearGradient></defs>' +
            fill_path +
            f'<path d="{path_d}" fill="none" stroke="#1B2A5E" stroke-width="2.5"/>' +
            f'<line x1="{sx}" y1="{sy_top}" x2="{sx}" y2="{base_y}" stroke="#C9A84C" stroke-width="2" stroke-dasharray="4,3"/>' +
            f'<circle cx="{sx}" cy="{sy_top}" r="5" fill="#C9A84C" stroke="#fff" stroke-width="2"/>' +
            f'<text x="{score_label_x}" y="{score_label_y}" fill="#1B2A5E" font-size="11" font-weight="700" text-anchor="{score_label_anchor}">{score_int}점</text>' +
            f'<text x="{mean_label_x}" y="{mean_label_y}" fill="#8A97B8" font-size="10" text-anchor="middle">평균 {mean_str}점</text>' +
            f'<line x1="0" y1="{base_y}" x2="{W}" y2="{base_y}" stroke="#E0E4F0" stroke-width="1"/>' +
            '</svg>' +
            '<div style="display:flex;justify-content:center;gap:24px;margin-top:12px;flex-wrap:wrap;">' +
            f'<div style="text-align:center;"><div style="font-size:11px;color:#8A97B8;margin-bottom:2px;">현재 점수</div><div style="font-size:20px;font-weight:800;color:#C9A84C;">{score_int}점</div></div>' +
            f'<div style="text-align:center;"><div style="font-size:11px;color:#8A97B8;margin-bottom:2px;">반 평균</div><div style="font-size:20px;font-weight:800;color:#1B2A5E;">{mean_str}점</div></div>' +
            f'<div style="text-align:center;"><div style="font-size:11px;color:#8A97B8;margin-bottom:2px;">상위</div><div style="font-size:20px;font-weight:800;color:#1B2A5E;">{top_pct}%</div></div>' +
            rank_html +
            '</div></div>'
        )
    else:
        normal_dist_html = ''
        normal_dist_js = ''


    # ── 날짜 포맷 ──
    try:
        dt = datetime.strptime(test_date, "%Y-%m-%d")
        date_display = dt.strftime("%Y년 %m월 %d일")
    except Exception:
        date_display = test_date

    generated_at = datetime.now().strftime("%Y.%m.%d %H:%M")

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{student_name} 학습 성취 보고서</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo',
                 'Noto Sans KR', 'Malgun Gothic', sans-serif;
    background: #F4F6FA;
    color: #1B2A5E;
    min-height: 100vh;
  }}

  /* ── 헤더 ── */
  .header {{
    background: linear-gradient(135deg, #FFFBF0 0%, #FFF8E1 50%, #FFFDE7 100%);
    padding: 40px 32px 36px;
    text-align: center;
    position: relative;
    overflow: hidden;
    border-bottom: 3px solid #F5C400;
  }}
  .header::before {{
    content: '';
    position: absolute;
    top: -40px; right: -40px;
    width: 180px; height: 180px;
    border-radius: 50%;
    background: rgba(245,196,0,0.12);
  }}
  .header::after {{
    content: '';
    position: absolute;
    bottom: -30px; left: -30px;
    width: 130px; height: 130px;
    border-radius: 50%;
    background: rgba(245,196,0,0.08);
  }}
  .logo-img {{
    width: 110px; height: 110px;
    border-radius: 0;
    object-fit: contain;
    object-position: center;
    margin-bottom: 18px;
    background: transparent;
  }}
  .logo-text {{
    font-size: 28px;
    font-weight: 800;
    color: #232222;
    letter-spacing: 4px;
    margin-bottom: 20px;
  }}
  .report-badge {{
    display: inline-block;
    background: rgba(35,34,34,0.08);
    border: 1px solid rgba(35,34,34,0.2);
    color: #232222;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 2px;
    padding: 5px 14px;
    border-radius: 20px;
    margin-bottom: 16px;
    text-transform: uppercase;
  }}
  .header h1 {{
    color: #232222;
    font-size: 32px;
    font-weight: 700;
    letter-spacing: -0.5px;
    margin-bottom: 8px;
  }}
  .header h1 span {{ color: #F5C400; -webkit-text-stroke: 1px #b38a00; }}
  .header-sub {{
    color: rgba(35,34,34,0.55);
    font-size: 14px;
    letter-spacing: 0.5px;
  }}

  /* ── 컨테이너 ── */
  .container {{
    max-width: 780px;
    margin: 0 auto;
    padding: 32px 20px 60px;
  }}

  /* ── 섹션 제목 ── */
  .section-title {{
    font-size: 13px;
    font-weight: 700;
    color: #C9A84C;
    letter-spacing: 2px;
    text-transform: uppercase;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
  }}
  .section-title::after {{
    content: '';
    flex: 1;
    height: 1px;
    background: linear-gradient(to right, rgba(201,168,76,0.4), transparent);
  }}

  /* ── 시험 정보 카드 ── */
  .info-card {{
    background: #FFFFFF;
    border-radius: 20px;
    padding: 28px 32px;
    margin-bottom: 20px;
    box-shadow: 0 2px 20px rgba(27,42,94,0.07);
    border: 1px solid rgba(27,42,94,0.06);
  }}
  .info-grid {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }}
  .info-item label {{
    font-size: 11px;
    font-weight: 600;
    color: #8A97B8;
    letter-spacing: 1px;
    text-transform: uppercase;
    display: block;
    margin-bottom: 4px;
  }}
  .info-item span {{
    font-size: 15px;
    font-weight: 600;
    color: #1B2A5E;
  }}

  /* ── KPI 카드 ── */
  .kpi-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 16px;
    margin-bottom: 20px;
  }}
  .kpi-card {{
    background: #FFFFFF;
    border-radius: 20px;
    padding: 24px 20px;
    text-align: center;
    box-shadow: 0 2px 20px rgba(27,42,94,0.07);
    border: 1px solid rgba(27,42,94,0.06);
    transition: transform 0.2s;
  }}
  .kpi-card:hover {{ transform: translateY(-2px); }}
  .kpi-card.highlight {{
    background: linear-gradient(135deg, #1B2A5E, #243570);
    border-color: transparent;
  }}
  .kpi-icon {{ font-size: 22px; margin-bottom: 8px; }}
  .kpi-label {{
    font-size: 11px;
    font-weight: 600;
    color: #8A97B8;
    letter-spacing: 1px;
    text-transform: uppercase;
    margin-bottom: 8px;
  }}
  .kpi-card.highlight .kpi-label {{ color: rgba(255,255,255,0.6); }}
  .kpi-value {{
    font-size: 32px;
    font-weight: 800;
    color: #1B2A5E;
    letter-spacing: -1px;
    line-height: 1;
  }}
  .kpi-card.highlight .kpi-value {{ color: #C9A84C; }}
  .kpi-unit {{
    font-size: 14px;
    font-weight: 500;
    color: #8A97B8;
    margin-left: 2px;
  }}
  .kpi-card.highlight .kpi-unit {{ color: rgba(255,255,255,0.5); }}
  .kpi-sub {{
    font-size: 12px;
    color: #8A97B8;
    margin-top: 6px;
  }}
  .kpi-card.highlight .kpi-sub {{ color: rgba(255,255,255,0.5); }}

  /* ── 차트 카드 ── */
  .chart-card {{
    background: #FFFFFF;
    border-radius: 20px;
    padding: 28px 32px;
    margin-bottom: 20px;
    box-shadow: 0 2px 20px rgba(27,42,94,0.07);
    border: 1px solid rgba(27,42,94,0.06);
  }}
  .chart-card canvas {{ max-height: 240px; }}

  /* ── 오답 문항 ── */
  .wrong-section {{
    background: #FFFFFF;
    border-radius: 20px;
    padding: 28px 32px;
    margin-bottom: 20px;
    box-shadow: 0 2px 20px rgba(27,42,94,0.07);
  }}
  .wrong-badges {{
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 8px;
  }}
  .wrong-badge {{
    background: #FFF3F3;
    border: 1.5px solid #FFBDBD;
    color: #D94F4F;
    font-size: 13px;
    font-weight: 700;
    padding: 6px 16px;
    border-radius: 30px;
  }}
  .no-wrong {{
    background: #F0FFF4;
    border: 1.5px solid #86EFAC;
    color: #16A34A;
    font-size: 13px;
    font-weight: 700;
    padding: 6px 16px;
    border-radius: 30px;
  }}

  /* ── 오답 상세 카드 ── */
  .wrong-card-list {{
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-top: 4px;
  }}
  .wrong-card {{
    background: #FAFBFF;
    border: 1.5px solid #E8EDF8;
    border-left: 5px solid #D94F4F;
    border-radius: 14px;
    padding: 18px 22px;
    transition: box-shadow 0.2s;
  }}
  .wrong-card:hover {{
    box-shadow: 0 4px 16px rgba(217,79,79,0.10);
  }}
  .wrong-card-header {{
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }}
  .wrong-card-num {{
    background: #D94F4F;
    color: #fff;
    font-size: 14px;
    font-weight: 800;
    padding: 4px 14px;
    border-radius: 20px;
    white-space: nowrap;
  }}
  .wrong-card-topic {{
    font-size: 15px;
    font-weight: 700;
    color: #1B2A5E;
    flex: 1;
  }}
  .wrong-card-diff {{
    font-size: 11px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 10px;
    white-space: nowrap;
  }}
  .diff-A {{ background:#4B0082; color:#fff; }}
  .diff-B {{ background:#DC2626; color:#fff; }}
  .diff-C {{ background:#F97316; color:#fff; }}
  .diff-D {{ background:#2563EB; color:#fff; }}
  .diff-E {{ background:#16A34A; color:#fff; }}
  .diff-default {{ background:#6B7280; color:#fff; }}
  .wrong-card-meta {{
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }}
  .wrong-card-method-label {{
    font-size: 11px;
    color: #8A97B8;
    font-weight: 600;
    letter-spacing: 0.5px;
  }}
  .wrong-card-method {{
    background: #EEF2FF;
    color: #3B4FAB;
    font-size: 12px;
    font-weight: 600;
    padding: 3px 12px;
    border-radius: 10px;
  }}
  .wrong-card-comment {{
    background: linear-gradient(135deg, #FFF8F0, #FFF3E8);
    border: 1px solid #FDDCB5;
    border-radius: 10px;
    padding: 12px 16px;
    font-size: 13px;
    color: #7C4A00;
    line-height: 1.7;
    position: relative;
  }}
  .wrong-card-comment::before {{
    content: '💡';
    margin-right: 6px;
  }}
  .wrong-card-no-detail {{
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 8px;
  }}

  /* ── 선생님이 전하는 말 ── */
  .comment-card {{
    background: linear-gradient(135deg, #0F1D3E, #1B2A5E);
    border-radius: 20px;
    padding: 32px;
    margin-bottom: 20px;
    position: relative;
    overflow: hidden;
  }}
  .comment-card::before {{
    content: '"';
    position: absolute;
    top: 10px; left: 20px;
    font-size: 100px;
    color: rgba(201,168,76,0.15);
    font-family: Georgia, serif;
    line-height: 1;
  }}
  .comment-title {{
    font-size: 12px;
    font-weight: 700;
    color: #C9A84C;
    letter-spacing: 2px;
    text-transform: uppercase;
    margin-bottom: 16px;
  }}
  .comment-text {{
    color: rgba(255,255,255,0.9);
    font-size: 15px;
    line-height: 1.8;
    position: relative;
    z-index: 1;
  }}

  /* ── 푸터 ── */
  .footer {{
    text-align: center;
    padding: 32px 20px;
    color: #8A97B8;
    font-size: 12px;
    border-top: 1px solid rgba(27,42,94,0.08);
  }}
  .footer strong {{ color: #1B2A5E; }}


  /* ── 유형별 진단표 ── */
  .type-rep-grid {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 20px;
  }}
  .type-rep-box {{
    background: #FFFFFF;
    border-radius: 16px;
    padding: 20px;
    box-shadow: 0 2px 12px rgba(27,42,94,0.07);
    border: 1px solid rgba(27,42,94,0.06);
  }}
  .type-rep-title {{
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 1px;
    padding: 6px 14px;
    border-radius: 20px;
    text-align: center;
    margin-bottom: 14px;
  }}
  .type-rep-title-good {{
    background: #EBF3FB;
    color: #2E6DA4;
  }}
  .type-rep-title-bad {{
    background: #FDECEA;
    color: #C0392B;
  }}
  .type-rep-item {{
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid rgba(27,42,94,0.06);
    font-size: 13px;
  }}
  .type-rep-item:last-child {{ border-bottom: none; }}
  .type-rep-num {{
    width: 22px; height: 22px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700; flex-shrink: 0;
  }}
  .type-rep-good .type-rep-num {{ background: #4A90D9; color: #fff; }}
  .type-rep-bad .type-rep-num {{ background: #E8735A; color: #fff; }}
  .type-rep-label {{ color: #1B2A5E; font-weight: 500; font-size: 12px; }}
  .type-bar-list {{
    background: #FFFFFF;
    border-radius: 16px;
    padding: 20px 24px;
    box-shadow: 0 2px 12px rgba(27,42,94,0.07);
    border: 1px solid rgba(27,42,94,0.06);
    margin-bottom: 20px;
  }}
  .type-row {{ margin-bottom: 14px; }}
  .type-row:last-child {{ margin-bottom: 0; }}
  .type-row-top {{
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }}
  .type-row-label {{
    font-size: 13px;
    color: #1B2A5E;
    font-weight: 500;
    flex: 1;
  }}
  .type-row-count {{
    font-size: 11px;
    color: #8A97B8;
    margin-left: auto;
    margin-right: 8px;
  }}
  .type-row-pct {{
    font-size: 13px;
    font-weight: 700;
    color: #1B2A5E;
    min-width: 36px;
    text-align: right;
  }}
  .type-badge {{
    font-size: 10px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 10px;
    flex-shrink: 0;
  }}
  .type-badge-good {{ background: #EBF3FB; color: #2E6DA4; }}
  .type-badge-bad {{ background: #FDECEA; color: #C0392B; }}
  .type-bar-bg {{
    background: #F0F2F8;
    border-radius: 4px;
    height: 8px;
    overflow: hidden;
  }}
  .type-bar-fill {{
    height: 100%;
    border-radius: 4px;
    transition: width 0.6s ease;
  }}

  /* ── 반응형 ── */
  @media (max-width: 480px) {{
    .header {{ padding: 36px 20px 32px; }}
    .header h1 {{ font-size: 24px; }}
    .kpi-grid {{ grid-template-columns: 1fr 1fr; }}
    .info-grid {{ grid-template-columns: 1fr; }}
    .chart-card {{ padding: 20px 16px; }}
  }}
</style>
</head>
<body>

<!-- 헤더 -->
<div class="header">
  {logo_html}
  <div class="report-badge">학습 성취 보고서</div>
  <h1><span>{student_name}</span> 학생 보고서</h1>
  <div class="header-sub">{class_name} &nbsp;·&nbsp; {date_display}</div>
  <div style="margin-top:14px;font-size:14px;line-height:1.6;opacity:0.92;">
    {PARENT_GREETING}<br>{student_name} 학생의 학습 결과 보고서를 보내드립니다.
  </div>
</div>

<div class="container">

  <!-- 시험 정보 -->
  <div class="info-card">
    <div class="section-title">시험 정보</div>
    <div class="info-grid">
      <div class="info-item">
        <label>시험명</label>
        <span>{test_name}</span>
      </div>
      <div class="info-item">
        <label>시험 유형</label>
        <span>{test_type} TEST</span>
      </div>
      <div class="info-item">
        <label>학교 · 학년</label>
        <span>{school} {grade}</span>
      </div>
      <div class="info-item">
        <label>소속 반</label>
        <span>{class_name}</span>
      </div>
    </div>
  </div>

  <!-- KPI 카드 -->
  <div class="section-title">핵심 지표</div>
  <div class="kpi-grid">
    {kpi_cards}
  </div>

  <!-- 유형별 진단표 -->
  {"" if not type_analysis_html else f'''
  <div class="chart-card">
    <div class="section-title">유형별 진단</div>
    ''' + type_analysis_html + '''
  </div>
  '''}

  <!-- 오답 문항 -->
  <div class="wrong-section">
    <div class="section-title">오답 문항 분석</div>
    {wrong_section_html}
  </div>

  <!-- 점수 추이 차트 -->
  {"" if not show_history_chart or not history_scores_list else f'''
  <div class="chart-card">
    <div class="section-title">최근 점수 추이</div>
    {history_chart_html}
  </div>
  '''}

  <!-- 정규분포 곡선 -->
  {"" if not normal_dist_html else f'''
  <div class="chart-card">
    <div class="section-title">우리 반 점수 분포에서 내 위치</div>
    <p style="font-size:12px;color:#8A97B8;margin-bottom:12px;">골드 영역이 {student_name} 학생의 위치입니다.</p>
    {normal_dist_html}
  </div>
  '''}

  <!-- 선생님이 전하는 말 -->
  <div class="comment-card">
    <div class="comment-title">선생님이 전하는 말</div>
    <div class="comment-text">{teacher_comment}</div>
  </div>

</div>

<!-- 푸터 -->
<div class="footer">
  <strong>{ACADEMY_NAME}</strong> &nbsp;·&nbsp; 본 보고서는 AI 분석을 기반으로 작성되었습니다.<br>
  생성일시: {generated_at}
</div>

<script>
{history_chart_js}
{normal_dist_js}
</script>

</body>
</html>"""

    return html



# ── 유형별 진단표 빌더 ────────────────────────────────────────────────────
def _build_type_analysis(
    *,
    wrong_numbers: list[int],
    question_details: list[dict[str, Any]] | None,
) -> str:
    """풀이유형별 정답률 진단표 HTML을 반환합니다."""
    if not question_details:
        return ""

    # 단원(대분류)별 정답/오답 집계
    type_stats: dict[str, dict] = {}
    wrong_set = set(wrong_numbers)

    for d in question_details:
        try:
            qnum = int(d["question_number"])
        except (KeyError, TypeError, ValueError):
            continue
        topic = (d.get("topic") or "").strip() or "미분류"
        if topic not in type_stats:
            type_stats[topic] = {"total": 0, "wrong": 0}
        type_stats[topic]["total"] += 1
        if qnum in wrong_set:
            type_stats[topic]["wrong"] += 1

    if not type_stats:
        return ""

    # 정답률 계산 및 정렬
    type_list = []
    for topic, stat in type_stats.items():
        total = stat["total"]
        wrong = stat["wrong"]
        correct = total - wrong
        pct = round(correct / total * 100) if total else 0
        type_list.append({"method": topic, "total": total, "correct": correct, "pct": pct})

    type_list.sort(key=lambda x: x["pct"], reverse=True)

    # 우수/취약 분류 (상위 3개, 하위 3개)
    top3 = [t["method"] for t in type_list[:3] if t["pct"] >= 70]
    bot3 = [t["method"] for t in type_list[-3:] if t["pct"] < 70]

    # 대표 우수/취약 박스
    top_items = "".join(
        f'<div class="type-rep-item type-rep-good">'
        f'<span class="type-rep-num">{i+1}</span>'
        f'<span class="type-rep-label">{t}</span>'
        f'</div>'
        for i, t in enumerate(top3)
    ) or '<div style="color:#8A97B8;font-size:13px;">해당 없음</div>'

    bot_items = "".join(
        f'<div class="type-rep-item type-rep-bad">'
        f'<span class="type-rep-num">{i+1}</span>'
        f'<span class="type-rep-label">{t}</span>'
        f'</div>'
        for i, t in enumerate(reversed(bot3))
    ) or '<div style="color:#8A97B8;font-size:13px;">해당 없음</div>'

    # 단원별 바 리스트 (문항 수 표시 추가)
    bar_rows = ""
    for item in type_list:
        pct = item["pct"]
        topic = item["method"]
        total = item["total"]
        correct = item["correct"]
        is_top = topic in top3
        is_bot = topic in bot3
        badge = ""
        bar_color = "#4A90D9"
        if is_top:
            badge = '<span class="type-badge type-badge-good">우수</span>'
            bar_color = "#4A90D9"
        elif is_bot:
            badge = '<span class="type-badge type-badge-bad">취약</span>'
            bar_color = "#E8735A"

        bar_rows += f"""
<div class="type-row">
  <div class="type-row-top">
    <span class="type-row-label">{topic}</span>
    {badge}
    <span class="type-row-count">{correct}/{total}문항</span>
    <span class="type-row-pct">{pct}%</span>
  </div>
  <div class="type-bar-bg">
    <div class="type-bar-fill" style="width:{pct}%;background:{bar_color};"></div>
  </div>
</div>"""

    return f"""
<div class="type-rep-grid">
  <div class="type-rep-box">
    <div class="type-rep-title type-rep-title-good">대표 우수 유형</div>
    {top_items}
  </div>
  <div class="type-rep-box">
    <div class="type-rep-title type-rep-title-bad">대표 취약 유형</div>
    {bot_items}
  </div>
</div>
<div class="type-bar-list">
{bar_rows}
</div>"""


# ── KPI 카드 빌더 ──────────────────────────────────────────────────────────
def _build_kpi_cards(
    *,
    score: float,
    accuracy: float,
    class_avg: float | None,
    rank: int | None,
    total_students: int | None,
    show_class_avg: bool,
    show_class_rank: bool,
) -> str:
    cards = []

    # 오늘 점수 (항상 표시 + 강조)
    cards.append(f"""
    <div class="kpi-card highlight">
      <div class="kpi-icon">🎯</div>
      <div class="kpi-label">이번 점수</div>
      <div class="kpi-value">{score:.0f}<span class="kpi-unit">점</span></div>
      <div class="kpi-sub">정답률 {accuracy}%</div>
    </div>""")

    # 반 평균 (선택)
    if show_class_avg:
        avg_str = f"{class_avg:.1f}" if class_avg is not None else "—"
        diff_str = ""
        if class_avg is not None:
            diff = score - class_avg
            sign = "+" if diff >= 0 else ""
            diff_str = f"평균 대비 {sign}{diff:.1f}점"
        cards.append(f"""
    <div class="kpi-card">
      <div class="kpi-icon">📊</div>
      <div class="kpi-label">반 평균</div>
      <div class="kpi-value">{avg_str}<span class="kpi-unit">점</span></div>
      <div class="kpi-sub">{diff_str}</div>
    </div>""")

    # 반 석차 (선택)
    if show_class_rank:
        rank_str = f"{rank}" if rank is not None else "—"
        total_str = f"전체 {total_students}명 중" if total_students else ""
        cards.append(f"""
    <div class="kpi-card">
      <div class="kpi-icon">🏅</div>
      <div class="kpi-label">반 석차</div>
      <div class="kpi-value">{rank_str}<span class="kpi-unit">위</span></div>
      <div class="kpi-sub">{total_str}</div>
    </div>""")

    return "\n".join(cards)


# ── 오답 상세 카드 빌더 ───────────────────────────────────────────────────
def _build_wrong_detail_cards(
    *,
    wrong_numbers: list[int],
    question_details: list[dict[str, Any]] | None,
    student_name: str,
) -> str:
    """오답 문항별 상세 카드 HTML을 반환합니다."""

    # 오답 없음
    if not wrong_numbers:
        return '<span class="no-wrong">오답 없음 🎉</span>'

    # question_details 없으면 기존 뱃지 형태로 폴백
    if not question_details:
        badges = "".join(
            f'<span class="wrong-badge">{n}번</span>' for n in wrong_numbers
        )
        return f'<div class="wrong-card-no-detail">{badges}</div>'

    # 문항번호 → 세부정보 딕셔너리 구성
    detail_map: dict[int, dict] = {}
    for d in question_details:
        try:
            detail_map[int(d["question_number"])] = d
        except (KeyError, TypeError, ValueError):
            pass

    # 오답 문항 중 세부정보 있는 것만 AI 한줄평 생성
    wrong_with_detail = []
    for n in wrong_numbers:
        d = detail_map.get(n)
        if d:
            wrong_with_detail.append({
                "number": n,
                "topic": d.get("topic") or "미분류",
                "method": d.get("question_method") or "",
                "difficulty": d.get("difficulty") or "",
            })

    # AI 한줄평 생성 (세부정보 있는 문항만)
    ai_comments: dict[int, str] = {}
    if wrong_with_detail:
        ai_comments = generate_wrong_question_comments(
            student_name=student_name,
            wrong_details=wrong_with_detail,
        )

    # 난이도 CSS 클래스 매핑
    def _diff_class(diff: str) -> str:
        return {
            "A": "diff-A", "B": "diff-B", "C": "diff-C",
            "D": "diff-D", "E": "diff-E",
        }.get((diff or "").upper(), "diff-default")

    def _diff_label(diff: str) -> str:
        return {
            "A": "A (최상)", "B": "B (상)", "C": "C (중)",
            "D": "D (하)", "E": "E (최하)",
        }.get((diff or "").upper(), diff or "—")

    # 카드 HTML 생성
    cards_html = []
    for n in wrong_numbers:
        d = detail_map.get(n)
        comment = ai_comments.get(n, "")

        if not d:
            # 세부정보 없는 문항 — 간단 뱃지
            cards_html.append(
                f'<div class="wrong-card">'
                f'<div class="wrong-card-header">'
                f'<span class="wrong-card-num">{n}번</span>'
                f'<span class="wrong-card-topic" style="color:#8A97B8;">문항 정보 없음</span>'
                f'</div></div>'
            )
            continue

        topic = d.get("topic") or "미분류"
        method = d.get("question_method") or ""
        diff = d.get("difficulty") or ""
        diff_cls = _diff_class(diff)
        diff_lbl = _diff_label(diff)

        method_html = (
            f'<div class="wrong-card-meta">'
            f'<span class="wrong-card-method-label">풀이유형</span>'
            f'<span class="wrong-card-method">{method}</span>'
            f'</div>'
        ) if method else ""

        comment_html = (
            f'<div class="wrong-card-comment">{comment}</div>'
        ) if comment else ""

        cards_html.append(f"""
<div class="wrong-card">
  <div class="wrong-card-header">
    <span class="wrong-card-num">{n}번</span>
    <span class="wrong-card-topic">{topic}</span>
    <span class="wrong-card-diff {diff_cls}">난이도 {diff_lbl}</span>
  </div>
  {method_html}
  {comment_html}
</div>""")

    return f'<div class="wrong-card-list">{"".join(cards_html)}</div>'
