"""claude_report.py
Claude API를 사용해 학부모용 HTML 보고서를 생성하는 모듈.

사용법:
    from claude_report import generate_parent_report_html, generate_teacher_comment_draft

주요 함수:
    generate_teacher_comment_draft(...)  → 선생님이 전하는 말 AI 초안 생성
    generate_parent_report_html(...)     → 전체 HTML 보고서 생성 (A4 사이즈)

디자인:
    - A4 고정폭(794px) 페이지, 인쇄 시 A4 용지에 맞게 출력
    - 브랜드 컬러: 블루 #4A7CFF + 핑크 #F986A7
    - 상단 탭(시험 유형별)은 정적 HTML에서는 표시용이며,
      학부모 열람 페이지(?report=토큰)에서 뷰어가 <!--TABS_START--> 마커를
      실시간 링크로 치환해 과거 보고서 이동이 가능해진다.
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

# ── 브랜드 컬러 ────────────────────────────────────────────────────────────
BRAND_BLUE = "#4A7CFF"
BRAND_PINK = "#F986A7"

# 시험 유형 탭 목록 (OCR 저장 시 사용하는 test_type과 동일하게 유지)
TEST_CATEGORIES = ["일일테스트", "주간테스트", "월간테스트", "단원테스트", "기타"]

# 시험 유형 → 보고서 형식 자동 매핑
REPORT_MODE_BY_CATEGORY = {
    "일일테스트": "lite",      # 간단판 (점수·오답·추이만)
    "월간테스트": "premium",   # 월간 누적 분석 포함
}


def report_mode_for(test_category: str) -> str:
    """시험 유형에 맞는 보고서 형식을 반환합니다. (기본: standard)"""
    return REPORT_MODE_BY_CATEGORY.get((test_category or "").strip(), "standard")


# ── 로고 이미지 base64 인코딩 ──────────────────────────────────────────────
def _get_logo_base64() -> str:
    """학원 로고 이미지를 base64로 반환. (logo_jmath.png 우선)"""
    base = Path(__file__).resolve().parent
    for name in ("logo_jmath.png", "logo.png", "academy_logo.png"):
        p = base / name
        if p.exists():
            import base64
            with open(p, "rb") as f:
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
    # 시험 종류 (일반/종합) — 이전 버전 호환용 (현재 표시에는 test_category 사용)
    test_type: str = "일반",
    # 시험 유형 탭용 카테고리 (일일테스트/주간테스트/월간테스트/단원테스트/기타)
    test_category: str = "일일테스트",
    # 보고서 형식: "lite"(일일 간단판) / "standard"(단원·주간) / "premium"(월간 누적)
    report_mode: str = "standard",
    # 프리미엄용: 이번 달 단원별 누적 정답률 [{"topic":..,"correct":..,"total":..}]
    monthly_topic_stats: list[dict[str, Any]] | None = None,
    # 프리미엄용: 지난달 평균 점수
    prev_month_avg: float | None = None,
    # 문항별 세부정보 (단원·풀이유형·난이도·AI한줄평)
    question_details: list[dict[str, Any]] | None = None,
) -> str:
    """HTML 보고서 문자열을 반환합니다. (A4 사이즈, 블루+핑크 테마)"""

    logo_b64 = _get_logo_base64()
    logo_inner = (
        f'<img src="data:image/png;base64,{logo_b64}" class="logo-img" alt="학원 로고">'
        if logo_b64 else
        '<div class="logo-fallback">J MATH<span>+</span></div>'
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

    # ── 점수 추이 데이터 (최근 8회) ──
    history_labels = [h["test_name"][:10] for h in history[-8:]]
    history_scores_list = [h["score"] for h in history[-8:]]

    # ── 시험 유형 탭 ──
    cat = (test_category or "").strip() or "일일테스트"
    cats = list(TEST_CATEGORIES)
    if cat not in cats:
        cats.append(cat)
    tabs_static = "".join(
        f'<span class="tab{" active" if c == cat else ""}">{c}</span>'
        for c in cats
    )

    # ── 보고서 형식 ──
    mode = (report_mode or "standard").strip().lower()
    is_lite = mode == "lite"
    is_premium = mode == "premium"

    # ── KPI 카드 생성 (라이트는 점수·반평균만) ──
    kpi_cards = _build_kpi_cards(
        score=score,
        accuracy=accuracy,
        class_avg=class_avg,
        rank=rank,
        total_students=total_students,
        show_class_avg=show_class_avg,
        show_class_rank=show_class_rank and not is_lite,
    )

    # ── 오답 문항 빌드 (라이트는 간단 칩 + AI 한줄평 생략) ──
    if is_lite:
        wrong_section_html = _build_wrong_chips(
            wrong_numbers=wrong_numbers,
            question_details=question_details,
        )
        type_analysis_html = ""
    else:
        wrong_section_html = _build_wrong_detail_cards(
            wrong_numbers=wrong_numbers,
            question_details=question_details,
            student_name=student_name,
        )
        type_analysis_html = _build_type_analysis(
            wrong_numbers=wrong_numbers,
            question_details=question_details,
        )

    # ── 라이트: 오늘의 한줄 요약 (AI 미사용, 자동 생성) ──
    lite_summary_html = ""
    if is_lite:
        lite_summary_html = _build_lite_summary(
            student_name=student_name,
            correct_count=correct_count,
            total_questions=total_questions,
            wrong_numbers=wrong_numbers,
            question_details=question_details,
            teacher_comment=teacher_comment,
        )

    # ── 프리미엄: 이번 달 누적 분석 ──
    monthly_section_html = ""
    if is_premium:
        monthly_section_html = _build_monthly_section(
            history=history,
            test_date=test_date,
            monthly_topic_stats=monthly_topic_stats,
            prev_month_avg=prev_month_avg,
        )

    # ── 점수 추이 차트 JS (막대그래프: 과거 회색, 이번 시험 블루) ──
    history_chart_js = ""
    history_chart_html = ""
    if show_history_chart and history_scores_list:
        history_chart_html = (
            '<div class="chart-wrap"><canvas id="historyChart"></canvas></div>'
        )
        history_chart_js = f"""
        const hLabels = {json.dumps(history_labels, ensure_ascii=False)};
        const hScores = {json.dumps(history_scores_list)};
        const hColors = hScores.map((v, i) => i === hScores.length - 1 ? '{BRAND_BLUE}' : '#C9CFDA');
        new Chart(document.getElementById('historyChart'), {{
            type: 'bar',
            data: {{
                labels: hLabels,
                datasets: [{{
                    data: hScores,
                    backgroundColor: hColors,
                    borderRadius: 6,
                    maxBarThickness: 36,
                }}]
            }},
            options: {{
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: {{
                    legend: {{ display: false }},
                    tooltip: {{ callbacks: {{ label: ctx => ctx.parsed.y + '점' }} }}
                }},
                scales: {{
                    y: {{
                        min: 0, max: 100,
                        grid: {{ color: 'rgba(31,42,68,0.07)' }},
                        ticks: {{ color: '#5B6B8C', callback: v => v + '점' }}
                    }},
                    x: {{
                        grid: {{ display: false }},
                        ticks: {{ color: '#5B6B8C', maxRotation: 30 }}
                    }}
                }}
            }}
        }});
        """

    # ── 정규분포 곡선 SVG 생성 (블루 곡선 + 핑크 위치 마커, 라이트 제외) ──
    normal_dist_html = ""
    if all_scores and len(all_scores) >= 2 and not is_lite:
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
      <div style="font-size:11px;color:#8A93A6;margin-bottom:2px;">석차</div>
      <div style="font-size:20px;font-weight:800;color:#1F2A44;">{rank_str}</div>
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
            f'<stop offset="0%" stop-color="{BRAND_BLUE}" stop-opacity="0.45"/>' +
            f'<stop offset="100%" stop-color="{BRAND_BLUE}" stop-opacity="0.05"/>' +
            '</linearGradient></defs>' +
            fill_path +
            f'<path d="{path_d}" fill="none" stroke="{BRAND_BLUE}" stroke-width="2.5"/>' +
            f'<line x1="{sx}" y1="{sy_top}" x2="{sx}" y2="{base_y}" stroke="{BRAND_PINK}" stroke-width="2" stroke-dasharray="4,3"/>' +
            f'<circle cx="{sx}" cy="{sy_top}" r="5" fill="{BRAND_PINK}" stroke="#fff" stroke-width="2"/>' +
            f'<text x="{score_label_x}" y="{score_label_y}" fill="#1F2A44" font-size="11" font-weight="700" text-anchor="{score_label_anchor}">{score_int}점</text>' +
            f'<text x="{mean_label_x}" y="{mean_label_y}" fill="#8A93A6" font-size="10" text-anchor="middle">평균 {mean_str}점</text>' +
            f'<line x1="0" y1="{base_y}" x2="{W}" y2="{base_y}" stroke="#E3E8F2" stroke-width="1"/>' +
            '</svg>' +
            '<div style="display:flex;justify-content:center;gap:24px;margin-top:12px;flex-wrap:wrap;">' +
            f'<div style="text-align:center;"><div style="font-size:11px;color:#8A93A6;margin-bottom:2px;">현재 점수</div><div style="font-size:20px;font-weight:800;color:{BRAND_BLUE};">{score_int}점</div></div>' +
            f'<div style="text-align:center;"><div style="font-size:11px;color:#8A93A6;margin-bottom:2px;">반 평균</div><div style="font-size:20px;font-weight:800;color:#1F2A44;">{mean_str}점</div></div>' +
            f'<div style="text-align:center;"><div style="font-size:11px;color:#8A93A6;margin-bottom:2px;">상위</div><div style="font-size:20px;font-weight:800;color:#1F2A44;">{top_pct}%</div></div>' +
            rank_html +
            '</div></div>'
        )

    # ── 날짜 포맷 ──
    try:
        dt = datetime.strptime(test_date, "%Y-%m-%d")
        date_display = dt.strftime("%Y년 %m월 %d일")
    except Exception:
        date_display = test_date

    generated_at = datetime.now().strftime("%Y.%m.%d %H:%M")

    # ── 조건부 섹션 (라이트는 시험정보·선생님말 생략) ──
    info_section = "" if is_lite else f"""
  <!-- 시험 정보 -->
  <div class="section">
    <div class="sec-title">시험 정보 <small>{class_name} {date_display}</small></div>
    <div class="info-card">
      <div class="info-grid">
        <div class="info-item">
          <label>시험명</label>
          <span>{test_name}</span>
        </div>
        <div class="info-item">
          <label>시험 유형</label>
          <span>{cat}</span>
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
  </div>"""

    comment_section = "" if is_lite else f"""
  <!-- 선생님이 전하는 말 -->
  <div class="section">
    <div class="comment-card">
      <div class="comment-title">선생님이 전하는 말</div>
      <div class="comment-text">{teacher_comment}</div>
    </div>
  </div>"""

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=834">
<title>{student_name} 학습 성취 보고서</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo',
                 'Noto Sans KR', 'Malgun Gothic', sans-serif;
    background: #EFF2F8;
    color: #1F2A44;
  }}

  /* ── A4 페이지 ── */
  .page {{
    width: 794px;              /* A4 폭 210mm ≈ 794px */
    margin: 0 auto;
    background: #FFFFFF;
    padding: 26px 30px 36px;
    box-shadow: 0 4px 30px rgba(31,42,68,0.10);
  }}

  /* ── 헤더 밴드 (탭이 밴드 하단에 붙는 구조) ── */
  .hero {{
    background: {BRAND_BLUE};
    border-radius: 22px;
    padding: 26px 28px 0 26px;
  }}
  .hero-main {{
    display: flex;
    align-items: center;
    gap: 22px;
  }}
  .hero-logo {{
    width: 108px;
    height: 108px;
    background: #FFFFFF;
    border-radius: 50%;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }}
  .logo-img {{
    width: 84%;
    height: 84%;
    object-fit: contain;
  }}
  .logo-fallback {{
    font-family: 'Arial Black', 'Malgun Gothic', sans-serif;
    font-size: 17px;
    font-weight: 900;
    color: #231F20;
    letter-spacing: 1px;
    position: relative;
  }}
  .logo-fallback span {{
    color: #F5C400;
    font-size: 14px;
    position: relative;
    top: -7px;
  }}
  .hero-text {{
    flex: 1;
    text-align: center;
    padding-right: 40px;
  }}
  .hero-text h1 {{
    color: #FFFFFF;
    font-size: 27px;
    font-weight: 800;
    letter-spacing: -0.5px;
    margin-bottom: 7px;
  }}
  .hero-sub {{
    color: rgba(255,255,255,0.85);
    font-size: 13px;
    letter-spacing: 0.3px;
  }}

  /* ── 시험 유형 탭 (파란 밴드 안쪽 하단, 활성 탭이 흰 본문과 이어짐) ── */
  .tab-row {{
    display: flex;
    justify-content: center;
    gap: 5px;
    margin-top: 20px;
    flex-wrap: wrap;
  }}
  .tab {{
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
  }}
  .tab.active {{
    background: #FFFFFF;
    color: {BRAND_BLUE};
    border-color: #FFFFFF;
    font-weight: 800;
  }}
  .tab.disabled {{
    background: rgba(255,255,255,0.12);
    border-color: rgba(255,255,255,0.35);
    color: rgba(255,255,255,0.55);
    cursor: default;
    pointer-events: none;
  }}
  .date-row {{
    display: flex;
    gap: 6px;
    margin: 12px 4px 0;
    flex-wrap: wrap;
  }}
  .date-chip {{
    display: inline-block;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 600;
    background: #EEF3FF;
    color: {BRAND_BLUE};
    border: 1px solid #C9D9FF;
    text-decoration: none;
  }}
  .date-chip.active {{
    background: {BRAND_BLUE};
    color: #FFFFFF;
    border-color: {BRAND_BLUE};
  }}

  /* ── 인사말 ── */
  .greeting {{
    font-size: 13px;
    color: #5B6B8C;
    line-height: 1.7;
    margin: 14px 4px 26px;
  }}

  /* ── 섹션 제목 (● 파란점 + 제목) ── */
  .sec-title {{
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
    font-weight: 800;
    color: #1F2A44;
    margin: 0 0 14px 2px;
  }}
  .sec-title::before {{
    content: '';
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: {BRAND_BLUE};
    flex-shrink: 0;
  }}
  .sec-title small {{
    font-size: 12px;
    font-weight: 600;
    color: {BRAND_BLUE};
    margin-left: 2px;
  }}
  .section {{ margin-bottom: 34px; }}

  /* ── 시험 정보 카드 ── */
  .info-card {{
    background: #FFFFFF;
    border: 1.5px solid #BFD3FF;
    border-radius: 18px;
    padding: 24px 28px;
  }}
  .info-grid {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 22px 16px;
  }}
  .info-item label {{
    font-size: 12px;
    font-weight: 700;
    color: {BRAND_BLUE};
    display: block;
    margin-bottom: 5px;
  }}
  .info-item span {{
    font-size: 15px;
    font-weight: 600;
    color: #1F2A44;
  }}

  /* ── KPI 카드 ── */
  .kpi-grid {{
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }}
  .kpi-card {{
    background: #FFFFFF;
    border: 1.5px solid #BFD3FF;
    border-radius: 16px;
    padding: 22px 16px 18px;
    text-align: center;
    box-shadow: 0 6px 14px rgba(74,124,255,0.10);
  }}
  .kpi-label {{
    font-size: 13px;
    font-weight: 700;
    color: #1F2A44;
    margin-bottom: 10px;
  }}
  .kpi-value {{
    font-size: 42px;
    font-weight: 800;
    color: {BRAND_BLUE};
    letter-spacing: -1px;
    line-height: 1;
  }}
  .kpi-unit {{
    font-size: 16px;
    font-weight: 700;
    color: {BRAND_BLUE};
    margin-left: 1px;
  }}
  .kpi-sub {{
    font-size: 12px;
    color: #5B6B8C;
    margin-top: 8px;
  }}

  /* ── 차트 카드 ── */
  .chart-card {{
    background: #FFFFFF;
    border: 1.5px solid #E3E8F2;
    border-radius: 18px;
    padding: 22px 24px;
  }}
  .chart-wrap {{
    position: relative;
    height: 250px;
  }}

  /* ── 유형별 진단: 대표 우수/취약 박스 ── */
  .type-rep-grid {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 18px;
  }}
  .type-rep-box {{
    border-radius: 16px;
    padding: 0 0 10px;
    border: 1.5px solid #E3E8F2;
    overflow: hidden;
    background: #FFFFFF;
  }}
  .type-rep-box.rep-good {{ border-color: #BFD3FF; }}
  .type-rep-box.rep-bad  {{ border-color: #FCD0DD; }}
  .type-rep-title {{
    font-size: 13px;
    font-weight: 800;
    color: #FFFFFF;
    text-align: center;
    padding: 9px 0;
    margin-bottom: 8px;
  }}
  .rep-good .type-rep-title {{ background: {BRAND_BLUE}; }}
  .rep-bad  .type-rep-title {{ background: {BRAND_PINK}; }}
  .type-rep-item {{
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 18px;
    font-size: 13px;
  }}
  .type-rep-dot {{
    width: 8px; height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }}
  .rep-good .type-rep-dot {{ background: {BRAND_BLUE}; }}
  .rep-bad  .type-rep-dot {{ background: {BRAND_PINK}; }}
  .type-rep-label {{ color: #1F2A44; font-weight: 600; font-size: 13px; }}
  .type-rep-empty {{ color: #8A93A6; font-size: 13px; padding: 7px 18px; }}

  /* ── 유형별 진단: 단원별 바 리스트 ── */
  .type-row-box {{
    background: #FFFFFF;
    border: 1.5px solid #E3E8F2;
    border-radius: 14px;
    padding: 16px 20px;
    margin-bottom: 12px;
  }}
  .type-row-box:last-child {{ margin-bottom: 0; }}
  .type-row-top {{
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }}
  .type-row-label {{
    font-size: 14px;
    color: #1F2A44;
    font-weight: 700;
    flex: 1;
  }}
  .type-row-count {{
    font-size: 11px;
    color: #8A93A6;
    margin-right: 6px;
  }}
  .type-row-pct {{
    font-size: 15px;
    font-weight: 800;
    color: #1F2A44;
    min-width: 42px;
    text-align: right;
  }}
  .type-badge {{
    font-size: 11px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 12px;
    flex-shrink: 0;
    color: #FFFFFF;
  }}
  .type-badge-good {{ background: {BRAND_BLUE}; }}
  .type-badge-bad  {{ background: {BRAND_PINK}; }}
  .type-bar-bg {{
    background: #EEF1F6;
    border-radius: 5px;
    height: 9px;
    overflow: hidden;
  }}
  .type-bar-fill {{
    height: 100%;
    border-radius: 5px;
  }}

  /* ── 오답 문항 카드 ── */
  .wrong-card-list {{
    display: flex;
    flex-direction: column;
    gap: 14px;
  }}
  .wrong-card {{
    background: #FFFFFF;
    border: 1.5px solid #FCD0DD;
    border-radius: 16px;
    padding: 18px 22px;
  }}
  .wrong-card-header {{
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }}
  .wrong-card-num {{
    background: {BRAND_PINK};
    color: #fff;
    font-size: 13px;
    font-weight: 800;
    padding: 4px 14px;
    border-radius: 20px;
    white-space: nowrap;
  }}
  .wrong-card-topic {{
    font-size: 15px;
    font-weight: 700;
    color: #1F2A44;
    flex: 1;
  }}
  .wrong-card-diff {{
    font-size: 11px;
    font-weight: 700;
    padding: 3px 12px;
    border-radius: 12px;
    white-space: nowrap;
    border: 1.5px solid transparent;
  }}
  /* 난이도: 최상 → 하 (확정 색상표) */
  .diff-A {{ background:#FF5555; color:#FFFFFF; border-color:#FF5555; }}
  .diff-B {{ background:#4A7CFF; color:#FFFFFF; border-color:#4A7CFF; }}
  .diff-C {{ background:#13AE67; color:#FFFFFF; border-color:#13AE67; }}
  .diff-D {{ background:#8FC31F; color:#FFFFFF; border-color:#8FC31F; }}
  .diff-E {{ background:#F8B62D; color:#FFFFFF; border-color:#F8B62D; }}
  .diff-default {{ background:#F0F2F6; color:#6B7280; border-color:#D8DCE4; }}
  .wrong-card-meta {{
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    flex-wrap: wrap;
  }}
  .wrong-card-method-label {{
    font-size: 11px;
    color: #8A93A6;
    font-weight: 600;
  }}
  .wrong-card-method {{
    background: #EEF3FF;
    color: {BRAND_BLUE};
    font-size: 12px;
    font-weight: 600;
    padding: 3px 12px;
    border-radius: 10px;
  }}
  .wrong-card-comment {{
    background: #FDF2F5;
    border: 1px solid #FAD8E2;
    border-radius: 10px;
    padding: 12px 16px;
    font-size: 13px;
    color: #A0455E;
    line-height: 1.7;
  }}
  .wrong-badge {{
    background: #FDEEF2;
    border: 1.5px solid {BRAND_PINK};
    color: #E14D67;
    font-size: 13px;
    font-weight: 700;
    padding: 6px 16px;
    border-radius: 30px;
    display: inline-block;
  }}
  .wrong-card-no-detail {{
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }}
  .no-wrong {{
    background: #E8F8EF;
    border: 1.5px solid #86EFAC;
    color: #16A34A;
    font-size: 13px;
    font-weight: 700;
    padding: 6px 16px;
    border-radius: 30px;
    display: inline-block;
  }}

  /* ── 선생님이 전하는 말 ── */
  .comment-card {{
    background: #FFFFFF;
    border: 1.5px solid #BFD3FF;
    border-radius: 18px;
    padding: 26px 30px;
  }}
  .comment-title {{
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 800;
    color: #1F2A44;
    margin-bottom: 14px;
  }}
  .comment-title::before {{
    content: '';
    width: 9px; height: 9px;
    border-radius: 50%;
    background: {BRAND_BLUE};
  }}
  .comment-text {{
    color: #3A4763;
    font-size: 14px;
    line-height: 1.9;
  }}

  /* ── 프리미엄: 월간 누적 분석 ── */
  .mini-kpi-grid {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 18px;
  }}
  .month-list {{
    background: #FFFFFF;
    border: 1.5px solid #E3E8F2;
    border-radius: 16px;
    padding: 10px 20px;
    margin-bottom: 18px;
  }}
  .month-row {{
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 11px 2px;
    border-bottom: 1px solid #EEF1F6;
    font-size: 13px;
  }}
  .month-row:last-child {{ border-bottom: none; }}
  .month-date {{ color: #8A93A6; font-size: 12px; min-width: 84px; }}
  .month-name {{ flex: 1; font-weight: 600; color: #1F2A44; }}
  .month-score {{ font-weight: 800; color: {BRAND_BLUE}; font-size: 14px; }}
  .delta-up   {{ color: #13AE67; font-weight: 700; }}
  .delta-down {{ color: #FF5555; font-weight: 700; }}

  /* ── 푸터 ── */
  .footer {{
    text-align: center;
    padding-top: 26px;
    margin-top: 6px;
    color: #8A93A6;
    font-size: 11px;
    border-top: 1px solid #E3E8F2;
  }}
  .footer strong {{ color: #1F2A44; }}

  /* ── 인쇄 (A4) ── */
  @page {{ size: A4; margin: 8mm; }}
  @media print {{
    body {{ background: #FFFFFF; }}
    .page {{
      width: auto;
      box-shadow: none;
      padding: 0;
      transform: none !important;
    }}
    .tab-row, .date-row {{ display: none; }}
    .hero {{ padding-bottom: 26px; }}
    .section, .kpi-card, .info-card, .chart-card,
    .wrong-card, .comment-card, .type-rep-box, .type-row-box {{
      break-inside: avoid;
    }}
  }}
</style>
</head>
<body>

<div class="page">

  <!-- 헤더 (탭 포함 파란 밴드) -->
  <div class="hero">
    <div class="hero-main">
      <div class="hero-logo">{logo_inner}</div>
      <div class="hero-text">
        <h1>{student_name} 학생 보고서</h1>
        <div class="hero-sub">{class_name} &nbsp;·&nbsp; {date_display}</div>
      </div>
    </div>
    <!-- 시험 유형 탭 (학부모 열람 페이지에서 실시간 링크로 치환됨) -->
    <div class="tab-row"><!--TABS_START-->{tabs_static}<!--TABS_END--></div>
  </div>
  <!--DATES_START--><!--DATES_END-->

  <!-- 인사말 -->
  <div class="greeting">
    {PARENT_GREETING}<br>{student_name} 학생의 학습 결과 보고서를 보내드립니다.
  </div>

  {info_section}

  <!-- 핵심 지표 -->
  <div class="section">
    <div class="sec-title">핵심 지표</div>
    <div class="kpi-grid">
      {kpi_cards}
    </div>
  </div>

  <!-- 유형별 진단 -->
  {"" if not type_analysis_html else f'''
  <div class="section">
    <div class="sec-title">유형별 진단</div>
    ''' + type_analysis_html + '''
  </div>
  '''}

  <!-- 오답 문항 분석 -->
  <div class="section">
    <div class="sec-title">오답 문항 분석</div>
    {wrong_section_html}
  </div>

  {lite_summary_html}

  <!-- 최근 점수 추이 -->
  {"" if not show_history_chart or not history_scores_list else f'''
  <div class="section">
    <div class="sec-title">최근 점수 추이</div>
    <div class="chart-card">
      {history_chart_html}
    </div>
  </div>
  '''}

  <!-- 반 분포 곡선 -->
  {"" if not normal_dist_html else f'''
  <div class="section">
    <div class="sec-title">우리 반 점수 분포에서 내 위치</div>
    <div class="chart-card">
      <p style="font-size:12px;color:#8A93A6;margin-bottom:12px;">색칠된 영역이 {student_name} 학생의 위치입니다.</p>
      {normal_dist_html}
    </div>
  </div>
  '''}

  {monthly_section_html}

  {comment_section}

  <!-- 푸터 -->
  <div class="footer">
    <strong>{ACADEMY_NAME}</strong> &nbsp;·&nbsp; 본 보고서는 AI 분석을 기반으로 작성되었습니다.<br>
    생성일시: {generated_at}
  </div>

</div>

<script>
{history_chart_js}

// ── 모바일 화면 맞춤: 화면이 A4 폭보다 좁으면 페이지 전체를 축소 ──
(function() {{
  function fitPage() {{
    var page = document.querySelector('.page');
    if (!page) return;
    var w = window.innerWidth;
    if (w < 810) {{
      var s = w / 794;
      page.style.transform = 'scale(' + s + ')';
      page.style.transformOrigin = 'top left';
      document.body.style.overflowX = 'hidden';
      document.body.style.height = (page.offsetHeight * s) + 'px';
    }} else {{
      page.style.transform = '';
      document.body.style.height = '';
      document.body.style.overflowX = '';
    }}
  }}
  window.addEventListener('resize', fitPage);
  window.addEventListener('load', fitPage);
  fitPage();
}})();
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
        f'<div class="type-rep-item">'
        f'<span class="type-rep-dot"></span>'
        f'<span class="type-rep-label">{t}</span>'
        f'</div>'
        for t in top3
    ) or '<div class="type-rep-empty">해당 없음</div>'

    bot_items = "".join(
        f'<div class="type-rep-item">'
        f'<span class="type-rep-dot"></span>'
        f'<span class="type-rep-label">{t}</span>'
        f'</div>'
        for t in reversed(bot3)
    ) or '<div class="type-rep-empty">해당 없음</div>'

    # 단원별 바 리스트 (개별 박스)
    bar_rows = ""
    for item in type_list:
        pct = item["pct"]
        topic = item["method"]
        total = item["total"]
        correct = item["correct"]
        is_top = topic in top3
        is_bot = topic in bot3
        badge = ""
        bar_color = BRAND_BLUE
        if is_top:
            badge = '<span class="type-badge type-badge-good">우수</span>'
            bar_color = BRAND_BLUE
        elif is_bot:
            badge = '<span class="type-badge type-badge-bad">취약</span>'
            bar_color = BRAND_PINK

        bar_rows += f"""
<div class="type-row-box">
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
  <div class="type-rep-box rep-good">
    <div class="type-rep-title">대표 우수 유형</div>
    {top_items}
  </div>
  <div class="type-rep-box rep-bad">
    <div class="type-rep-title">대표 취약 유형</div>
    {bot_items}
  </div>
</div>
{bar_rows}"""


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

    # 이번 점수 (항상 표시)
    cards.append(f"""
    <div class="kpi-card">
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
      <div class="kpi-label">반 석차</div>
      <div class="kpi-value">{rank_str}<span class="kpi-unit">위</span></div>
      <div class="kpi-sub">{total_str}</div>
    </div>""")

    return "\n".join(cards)


# ── 라이트: 오답 간단 칩 빌더 ─────────────────────────────────────────────
def _build_wrong_chips(
    *,
    wrong_numbers: list[int],
    question_details: list[dict[str, Any]] | None,
) -> str:
    """오답 문항을 '번호 · 단원' 칩으로만 간단히 표시합니다. (AI 한줄평 없음)"""
    if not wrong_numbers:
        return '<span class="no-wrong">오답 없음 🎉</span>'

    detail_map: dict[int, dict] = {}
    for d in question_details or []:
        try:
            detail_map[int(d["question_number"])] = d
        except (KeyError, TypeError, ValueError):
            pass

    chips = []
    for n in wrong_numbers:
        d = detail_map.get(n)
        topic = ((d.get("topic") if d else "") or "").strip()
        label = f"{n}번 · {topic}" if topic else f"{n}번"
        chips.append(f'<span class="wrong-badge">{label}</span>')
    return f'<div class="wrong-card-no-detail">{"".join(chips)}</div>'


# ── 라이트: 오늘의 한줄 요약 빌더 (AI 미사용) ─────────────────────────────
def _build_lite_summary(
    *,
    student_name: str,
    correct_count: int,
    total_questions: int,
    wrong_numbers: list[int],
    question_details: list[dict[str, Any]] | None,
    teacher_comment: str,
) -> str:
    """일일테스트용 자동 한줄 요약. 선생님이 코멘트를 쓰면 그 내용을 우선 사용합니다."""
    text = (teacher_comment or "").strip()
    if not text or text == "선생님 코멘트를 입력해 주세요.":
        if not wrong_numbers:
            text = f"오늘 {total_questions}문항 모두 정답입니다. {student_name} 학생, 아주 잘했어요!"
        else:
            detail_map: dict[int, dict] = {}
            for d in question_details or []:
                try:
                    detail_map[int(d["question_number"])] = d
                except (KeyError, TypeError, ValueError):
                    pass
            topic_counts: dict[str, int] = {}
            for n in wrong_numbers:
                topic = ((detail_map.get(n) or {}).get("topic") or "").strip()
                if topic:
                    topic_counts[topic] = topic_counts.get(topic, 0) + 1
            if topic_counts:
                parts = ", ".join(f"{t} {c}문항" for t, c in topic_counts.items())
                text = (
                    f"오늘 {total_questions}문항 중 {correct_count}문항을 맞혔습니다. "
                    f"{parts}이 아쉬웠고, 다음 수업에서 함께 복습하겠습니다."
                )
            else:
                text = (
                    f"오늘 {total_questions}문항 중 {correct_count}문항을 맞혔습니다. "
                    f"틀린 문항은 다음 수업에서 함께 복습하겠습니다."
                )

    return f"""
  <div class="section">
    <div class="comment-card">
      <div class="comment-title">오늘의 한줄 요약</div>
      <div class="comment-text">{text}</div>
    </div>
  </div>"""


# ── 프리미엄: 월간 누적 분석 빌더 ─────────────────────────────────────────
def _build_monthly_section(
    *,
    history: list[dict[str, Any]],
    test_date: str,
    monthly_topic_stats: list[dict[str, Any]] | None,
    prev_month_avg: float | None,
) -> str:
    """이번 달 시험 목록 + 월 평균(전월 비교) + 단원별 누적 정답률 섹션."""
    ym = (test_date or "")[:7]
    month_tests = [h for h in history if str(h.get("date", ""))[:7] == ym]

    if not month_tests and not monthly_topic_stats:
        return ""

    try:
        month_label = f"{int(ym[:4])}년 {int(ym[5:7])}월"
    except Exception:
        month_label = "이번 달"

    # 이번 달 시험 목록
    rows = ""
    for h in month_tests:
        rows += (
            f'<div class="month-row">'
            f'<span class="month-date">{h.get("date", "")}</span>'
            f'<span class="month-name">{h.get("test_name", "")}</span>'
            f'<span class="month-score">{float(h.get("score", 0)):.0f}점</span>'
            f'</div>'
        )
    list_html = f'<div class="month-list">{rows}</div>' if rows else ""

    # 이번 달 평균 vs 지난달 평균
    kpi_html = ""
    if month_tests:
        this_avg = round(sum(float(h.get("score", 0)) for h in month_tests) / len(month_tests), 1)
        if prev_month_avg is not None:
            diff = round(this_avg - prev_month_avg, 1)
            if diff > 0:
                delta = f'<span class="delta-up">▲ {diff}점 상승</span>'
            elif diff < 0:
                delta = f'<span class="delta-down">▼ {abs(diff)}점 하락</span>'
            else:
                delta = "지난달과 동일"
            prev_card = f"""
    <div class="kpi-card">
      <div class="kpi-label">지난달 평균</div>
      <div class="kpi-value">{prev_month_avg:.1f}<span class="kpi-unit">점</span></div>
      <div class="kpi-sub">{delta}</div>
    </div>"""
        else:
            prev_card = """
    <div class="kpi-card">
      <div class="kpi-label">지난달 평균</div>
      <div class="kpi-value">—</div>
      <div class="kpi-sub">기록 없음</div>
    </div>"""
        kpi_html = f"""
  <div class="mini-kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">이번 달 평균 <small>({len(month_tests)}회 시험)</small></div>
      <div class="kpi-value">{this_avg:.1f}<span class="kpi-unit">점</span></div>
      <div class="kpi-sub">{month_label}</div>
    </div>
    {prev_card}
  </div>"""

    # 단원별 누적 정답률
    topic_html = ""
    if monthly_topic_stats:
        stats = sorted(
            monthly_topic_stats,
            key=lambda x: (x["correct"] / x["total"] if x.get("total") else 0),
            reverse=True,
        )
        bar_rows = ""
        for s in stats:
            total = int(s.get("total", 0))
            correct = int(s.get("correct", 0))
            if not total:
                continue
            pct = round(correct / total * 100)
            bar_color = BRAND_BLUE if pct >= 70 else BRAND_PINK
            bar_rows += f"""
<div class="type-row-box">
  <div class="type-row-top">
    <span class="type-row-label">{s.get("topic", "미분류")}</span>
    <span class="type-row-count">{correct}/{total}문항</span>
    <span class="type-row-pct">{pct}%</span>
  </div>
  <div class="type-bar-bg">
    <div class="type-bar-fill" style="width:{pct}%;background:{bar_color};"></div>
  </div>
</div>"""
        if bar_rows:
            topic_html = f"""
  <div style="margin-top:4px;">
    <div style="font-size:13px;font-weight:700;color:#5B6B8C;margin:0 2px 10px;">단원별 누적 정답률 (이번 달 전체 시험 기준)</div>
    {bar_rows}
  </div>"""

    return f"""
  <!-- 이번 달 학습 리포트 (프리미엄) -->
  <div class="section">
    <div class="sec-title">이번 달 학습 리포트 <small>{month_label}</small></div>
    {kpi_html}
    {list_html}
    {topic_html}
  </div>"""


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
            "A": "최상", "B": "상", "C": "중상",
            "D": "중", "E": "하",
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
                f'<span class="wrong-card-topic" style="color:#8A93A6;">문항 정보 없음</span>'
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
