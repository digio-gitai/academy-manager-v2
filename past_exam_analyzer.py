"""Past exam PDF → GPT JSON extraction → Python template → 5-page HTML report.
장충고 분석보고서 수준의 퀄리티를 목표로 함.
페이지 수는 내용에 따라 가변 (5~7페이지).
"""

from __future__ import annotations
import base64, html, json, math, os, re, tempfile
from datetime import date
from typing import Any
import streamlit as st
import streamlit.components.v1 as components

from ocr_extract import (
    GOOGLE_VISION_AUTH_USER_MESSAGE, GoogleVisionAuthError,
    MIN_EMBEDDED_CHARS, OPENAI_AUTH_USER_MESSAGE,
    _build_openai_client, _strip_fences,
    extract_text_google_vision, has_google_vision_credentials,
    has_openai_api_key, pdf_extract_text, resolve_api_key,
)

# ── 경로 ──────────────────────────────────────────────────────────
_MODULE_DIR   = os.path.dirname(os.path.abspath(__file__))
DATA_DIR      = os.path.join(_MODULE_DIR, "data")
LOGO_PATH     = os.path.join(DATA_DIR, "academy_logo.png")
DEFAULT_ACADEMY = "Math Management"
GPT_MODEL       = "gpt-4o"
GPT_MAX_TOKENS  = 4096
PDF_TEXT_MAX    = 16000
MAX_PAGES       = 10
OCR_DPI         = 150
Q_TABLE_MAX     = 25   # 문항표 최대 행

# ══════════════════════════════════════════════════════════════════
# CSS  (장충고 보고서 CSS를 기반으로 통합)
# ══════════════════════════════════════════════════════════════════
REPORT_CSS = """
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

  /* 페이지 */
  .page{background:#fff;padding:36px 40px;margin-bottom:16px;border-radius:8px;
        box-shadow:0 2px 12px rgba(0,0,0,.07);position:relative;overflow:hidden;}
  .page-badge{position:absolute;top:20px;right:20px;background:var(--blue);
    color:#fff;font-weight:700;font-size:13px;width:44px;height:44px;
    border-radius:50%;display:flex;align-items:center;justify-content:center;}

  /* 헤더 */
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

  /* 섹션 */
  .section-title{font-size:15px;font-weight:700;color:var(--blue-dark);
    margin:20px 0 10px;padding-left:10px;border-left:4px solid var(--blue);}

  /* 기본정보 */
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

  /* 텍스트박스 */
  .trend-box{background:var(--gray-bg);border:1px solid var(--border);
    border-radius:6px;padding:14px 16px;margin-bottom:10px;
    font-size:12.5px;line-height:1.7;}
  .trend-title{font-weight:700;font-size:13px;margin-bottom:8px;}
  .bullet-list{list-style:none;padding:0;}
  .bullet-list li{padding:3px 0 3px 16px;position:relative;
    font-size:12px;color:#374151;}
  .bullet-list li::before{content:'•';position:absolute;left:0;
    color:var(--blue);font-weight:700;}

  /* 난이도표 */
  .diff-table{width:100%;border-collapse:collapse;margin-bottom:10px;}
  .diff-table td{padding:8px 12px;border:1px solid var(--border);
    vertical-align:top;font-size:12px;}
  .diff-table td:first-child{background:var(--gray-bg);font-weight:700;
    width:110px;white-space:nowrap;}
  .diff-level{font-size:15px;font-weight:900;color:var(--orange);}

  /* 문항표 */
  .q-table{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed;}
  .q-table th{background:var(--blue);color:#fff;padding:7px 6px;
    text-align:center;font-weight:700;border:1px solid var(--blue-dark);line-height:1.3;}
  .q-table td{padding:6px;border:1px solid var(--border);
    vertical-align:middle;line-height:1.4;word-break:keep-all;overflow-wrap:break-word;}
  .q-table tr:nth-child(even) td{background:var(--gray-bg);}
  .q-table .tc{text-align:center;} .q-table .tl{text-align:left;}
  .q-omit{font-size:11px;color:var(--gray);text-align:right;
    margin-top:5px;font-style:italic;}

  /* 배지 */
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

  /* 핵심문항 */
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

  /* PAGE4 차트 */
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

  /* 등급표 */
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

  /* PAGE5 전략 */
  .strat-grid{display:grid;grid-template-columns:1fr 1fr 1fr;
    border:1px solid var(--border);border-radius:8px;
    overflow:hidden;margin-bottom:20px;}
  .strat-header{background:var(--blue-light);font-weight:700;font-size:12px;
    color:var(--blue-dark);padding:10px 12px;
    border-bottom:1px solid var(--border);}
  .strat-header:not(:last-child){border-right:1px solid var(--border);}
  .strat-body{padding:12px;font-size:11.5px;line-height:1.6;color:#374151;}
  .strat-body:not(:last-child){border-right:1px solid var(--border);}

  /* 6주 플랜 */
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

  /* 조언 */
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

  /* SVG 차트 공통 */
  svg text{font-family:'Noto Sans KR',sans-serif;}

  /* 인쇄 */
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
"""

# ══════════════════════════════════════════════════════════════════
# GPT JSON 추출 프롬프트  (장충고 수준 데이터 확보)
# ══════════════════════════════════════════════════════════════════
JSON_SYSTEM_PROMPT = """\
당신은 한국 수학 시험지 심층 분석 전문가입니다.
아래 시험지 텍스트를 분석하여 **JSON 데이터만** 반환하세요.
HTML·마크다운·설명 텍스트 없이 순수 JSON만 출력하세요.

## 반환 JSON 스키마

{
  "basic_info": {
    "school": "학교명 및 학년 (예: 장충고등학교 고2)",
    "exam_type": "시험 종류 (예: 1학기 중간고사 대수)",
    "exam_date": "시험 날짜 (예: 2026년 04월 28일)",
    "total_questions": 23,
    "obj_count": 19,
    "sub_count": 4,
    "total_score": 100,
    "scope_tags": ["지수와 로그", "지수·로그함수", "삼각함수", "실생활 응용"]
  },
  "trend": {
    "summary": "출제 경향 전체 요약 — 4~5문장, 구체적 단원명과 출제 방식 포함",
    "bullets": [
      "구체적 특징 1 (단원명·문항번호 포함)",
      "구체적 특징 2",
      "구체적 특징 3",
      "구체적 특징 4"
    ],
    "difficulty_level": "중상",
    "killer_questions": "18번 (로그 부등식 정수 개수), 서술형4 (삼각함수 부등식)",
    "variable_factors": "역함수·그래프 대칭성 파악, 복합 연산 처리 능력, 서술형 정확한 풀이 과정 서술 능력",
    "composition_detail": "선택형 19문항·서술형 4문항으로 구성. 전반부(1~10번)는 기본 계산 위주, 후반부(11~19번)와 서술형에 고난도 집중. 지수와 로그 35%, 지수·로그함수 30%, 삼각함수 20%, 실생활 응용 15% 비중.",
    "type_obj_pct": 68,
    "type_sub_pct": 32,
    "obj_rate": 58,
    "sub_rate": 38,
    "type_bar_note": "후반부 객관식과 서술형에서 복합 개념 요구가 높아 정답률이 낮게 나타납니다."
  },
  "questions": [
    {
      "num": "1",
      "type": "객관",
      "concept": "지수의 연산",
      "summary": "5⁴×5⁻² 지수 연산 기본 계산",
      "difficulty": "하",
      "correct_rate": 92
    }
  ],
  "key_questions": [
    {
      "num": "18",
      "emoji": "🔢",
      "title": "로그 부등식 — 정수 x의 개수 조건",
      "tag_class": "tag-killer",
      "tag_label": "최상",
      "point": "x²−x·log₃3n+log₃n≤0을 만족하는 정수 x의 개수가 정확히 3이 되도록 하는 자연수 n의 개수를 구하는 문제입니다. A=log₃n으로 치환 후 이차부등식의 근 사이 정수 개수를 분석해야 합니다.",
      "why_hard": "A=log₃n 치환 후 두 근 사이에 정수 x가 정확히 3개가 되는 A 범위를 설정하고, 이를 다시 n 범위로 역변환하는 이중 치환 과정이 복잡합니다.",
      "concepts": ["이차부등식의 해 (두 근의 위치)", "로그를 이용한 치환 (A=log₃n)", "근과 계수의 관계"],
      "steps": [
        "A=log₃n으로 치환 → x²−x(A+1)+A≤0 변환",
        "인수분해: (x−1)(x−A)≤0 → 두 근은 1과 A",
        "두 근 사이 정수가 3개인 A의 범위 탐색",
        "A=log₃n의 범위를 n 범위로 역변환 후 자연수 n 개수 산출"
      ]
    }
  ],
  "charts": {
    "domain_labels": ["지수와 로그", "지수·로그함수", "삼각함수", "실생활·추론"],
    "domain_rates": [72, 48, 55, 40],
    "diff_low_pct": 9,
    "diff_mid_pct": 39,
    "diff_high_pct": 52,
    "grade_dist": [10, 24, 32, 24, 10]
  },
  "grade_cuts": [
    {"grade": 1, "badge_class": "g1", "range": "상위 10%",   "cut": "88점 이상", "desc": "서술형 고난도 포함 전 문항 완벽 해결 가능한 최상위권"},
    {"grade": 2, "badge_class": "g2", "range": "10~34%",     "cut": "74점 이상", "desc": "기본/실력 문항 모두 맞추고 서술형에서 부분 점수 획득 구간"},
    {"grade": 3, "badge_class": "g3", "range": "34~66%",     "cut": "56점 이상", "desc": "기본 개념은 갖추나 서술형 고난도와 후반 객관식 일부에서 실점"},
    {"grade": 4, "badge_class": "g4", "range": "66~90%",     "cut": "38점 이상", "desc": "기초 개념 위주 득점. 해당 단원 보완 필요"},
    {"grade": 5, "badge_class": "g5", "range": "90~100%",    "cut": "38점 미만", "desc": "기초 개념 이해와 연산 훈련 부족. 교과서부터 재학습 필요"}
  ],
  "strategy": {
    "top": [
      "서술형 고난도 치환·판별식 연결 공식 반복 훈련",
      "미지수 설정부터 최종 결론까지 감점 없이 작성 연습",
      "계산이 긴 문제에서 중간 부호와 지수 값 실수 차단"
    ],
    "mid": [
      "연산 공식과 그래프 성질을 바르게 풀 수 있도록 훈련",
      "기본 그래프를 직접 그리며 점근선과 교점 찾는 연습",
      "틀린 문제의 전형 유형 파악 후 유사 문제 3회 이상 풀기"
    ],
    "low": [
      "교과서·기본서 예제·유제 반복으로 연산 두려움 제거",
      "핵심 개념과 공식을 백지에 적어 연습",
      "전반부 기본 문항 빠르게 답 내는 것을 목표로 설정"
    ]
  },
  "weekly_plan": [
    {"week": 1, "goal": "핵심개념 완성", "content": "• 기본 공식·성질 집중 복습\\n• 교과서 예제 전수\\n• 개념 정리 노트 작성", "questions": "1~5번"},
    {"week": 2, "goal": "유형 훈련",     "content": "• 기출 변형 풀이\\n• 유형별 분류 학습\\n• 취약 유형 집중", "questions": "6~12번"},
    {"week": 3, "goal": "중난이도 공략", "content": "• 오답 유형 집중\\n• 풀이 과정 정리\\n• 개념 연결 훈련", "questions": "13~17번"},
    {"week": 4, "goal": "고난도 진입",   "content": "• 서술형 완성\\n• 고난도 패턴 분석\\n• 시간 배분 연습", "questions": "18~서술형"},
    {"week": 5, "goal": "실전 모의",     "content": "• 시간 제한 풀이\\n• 실전 감각 유지\\n• 최종 점검", "questions": "전체"},
    {"week": 6, "goal": "최종 점검",     "content": "• 취약 단원 재확인\\n• 오답 전체 복습\\n• 핵심 공식 최종 정리", "questions": "오답 전체"}
  ],
  "parent_advice": {
    "title": "이번 시험, 점수 이면의 '과정'을 칭찬해주세요.",
    "body": "이번 시험은 단순 계산을 넘어 깊은 추론 능력을 요구했습니다. 단순히 몇 점을 맞았느냐보다 어느 단원에서 개념이 흔들렸는지 함께 분석하는 과정이 필요합니다. 규칙적인 학습 시간 확보와 오답 정리 습관을 지원해 주세요.",
    "summary": "이번 시험은 수준 높은 변별력 시험이었습니다. 단계별 학습 계획을 꾸준히 실행하면 다음 시험에서 유의미한 성적 향상을 기대할 수 있습니다.",
    "hashtags": ["#핵심단원_집중학습", "#오답노트_필수", "#서술형_과정점수", "#꾸준함이실력"]
  }
}

## 작성 규칙
- 한국어, 전문적·구체적. 실제 시험지 내용 기반.
- questions: 전체 문항 빠짐없이 (객관+서술 모두).
- key_questions: 오답률 높고 등급 가르는 문항을 반드시 정확히 3개 선정. 2개도 4개도 아닌 정확히 3개.
- charts.domain_labels: 반드시 실제 단원명 사용 (더미값 금지).
- tag_class: "tag-killer"(최상) / "tag-high"(상) / "tag-midhigh"(중상) / "tag-mid"(중) 중 선택.
- difficulty: "하"/"중하"/"중"/"중상"/"상"/"최상" 중 하나.
- grade_dist 합계 = 100.
- weekly_plan content 줄바꿈은 \\n으로.
- composition_detail: 전반부/후반부 구성, 단원별 비중 포함하여 구체적으로.
"""

# ══════════════════════════════════════════════════════════════════
# 유틸리티
# ══════════════════════════════════════════════════════════════════
def _logo_data_uri() -> str:
    if not os.path.isfile(LOGO_PATH): return ""
    with open(LOGO_PATH,"rb") as f: raw=f.read()
    ext=os.path.splitext(LOGO_PATH)[1].lower()
    mime="image/jpeg" if ext in(".jpg",".jpeg") else "image/png"
    return f"data:{mime};base64,{base64.b64encode(raw).decode()}"

def _save_logo(uploaded_file) -> None:
    os.makedirs(DATA_DIR,exist_ok=True)
    with open(LOGO_PATH,"wb") as f: f.write(uploaded_file.getvalue())

def _sanitize_filename(text:str,*,max_len:int=40)->str:
    cleaned=re.sub(r'[<>:"/\\|?*\n\r\t]',"",(text or "").strip())
    return re.sub(r"\s+","_",cleaned)[:max_len] or "기출분석"

def _clean(text:str)->str:
    if not text: return ""
    text=re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ufffd]','',text)
    return html.escape(text.strip())

def _diff_badge(d:str)->str:
    m={"하":"badge-low","중하":"badge-midlow","중":"badge-mid",
       "중상":"badge-midhigh","상":"badge-high","최상":"badge-killer"}
    return f'<span class="badge {m.get(d,"badge-mid")}">{html.escape(d)}</span>'

def _type_badge(t:str)->str:
    cls="badge-sub" if "서술" in t else "badge-obj"
    return f'<span class="badge {cls}">{html.escape(t)}</span>'

# ══════════════════════════════════════════════════════════════════
# SVG 차트 (Canvas 없이 PDF 완벽 출력)
# ══════════════════════════════════════════════════════════════════
def _svg_donut(low:int,mid:int,high:int)->str:
    cx,cy,ro,ri=90,90,78,46
    vals=[low,mid,high]
    colors=["#86EFAC","#FCD34D","#F87171"]
    labels=[f"하 {low}%",f"중 {mid}%",f"상 {high}%"]
    total=sum(vals) or 1
    angle=-math.pi/2
    paths=[]
    for i,v in enumerate(vals):
        sweep=2*math.pi*v/total
        x1=cx+ro*math.cos(angle); y1=cy+ro*math.sin(angle)
        x2=cx+ro*math.cos(angle+sweep); y2=cy+ro*math.sin(angle+sweep)
        x3=cx+ri*math.cos(angle+sweep); y3=cy+ri*math.sin(angle+sweep)
        x4=cx+ri*math.cos(angle); y4=cy+ri*math.sin(angle)
        lg=1 if sweep>math.pi else 0
        ma=angle+sweep/2
        lx=cx+(ro+ri)/2*math.cos(ma); ly=cy+(ro+ri)/2*math.sin(ma)
        d=(f"M{x1:.1f},{y1:.1f}A{ro},{ro},0,{lg},1,{x2:.1f},{y2:.1f}"
           f"L{x3:.1f},{y3:.1f}A{ri},{ri},0,{lg},0,{x4:.1f},{y4:.1f}Z")
        paths.append(f'<path d="{d}" fill="{colors[i]}" stroke="#fff" stroke-width="2"/>')
        if v>=5:
            paths.append(f'<text x="{lx:.1f}" y="{ly:.1f}" text-anchor="middle"'
                         f' dominant-baseline="middle" font-size="11"'
                         f' font-weight="700" fill="#111">{v}%</text>')
        angle+=sweep
    legend=""
    for i,(col,lb) in enumerate(zip(colors,labels)):
        ly2=200+i*18
        legend+=(f'<rect x="16" y="{ly2}" width="12" height="12" rx="2" fill="{col}"/>'
                 f'<text x="34" y="{ly2+10}" font-size="11" fill="#374151">{lb}</text>')
    return (f'<svg viewBox="0 0 180 260" width="180" height="260"'
            f' xmlns="http://www.w3.org/2000/svg">'
            +"".join(paths)+legend+"</svg>")

def _svg_hbar(labels:list,values:list)->str:
    colors=["#2563EB","#F97316","#16A34A","#9333EA","#DC2626","#0891B2"]
    row_h=28; total_h=len(labels)*row_h+10
    svg=(f'<svg viewBox="0 0 320 {total_h}" width="320" height="{total_h}"'
         f' xmlns="http://www.w3.org/2000/svg">')
    for i,(lb,val) in enumerate(zip(labels,values)):
        y=i*row_h+6
        bw=max(4,int(val*1.6))
        col=colors[i%len(colors)]
        svg+=(f'<text x="0" y="{y+11}" font-size="11" fill="#374151">{html.escape(lb)}</text>'
              f'<rect x="90" y="{y}" width="{bw}" height="18" rx="3" fill="{col}"/>'
              f'<text x="{90+bw+5}" y="{y+13}" font-size="11" fill="#374151">{val}%</text>')
    return svg+"</svg>"

def _svg_vbar(labels:list,values:list,colors:list)->str:
    mxv=max(values) if values else 1
    bw,gap,by=28,8,110; tw=len(labels)*(bw+gap)+20
    svg=(f'<svg viewBox="0 0 {tw} 130" width="{tw}" height="130"'
         f' xmlns="http://www.w3.org/2000/svg">')
    for i,(lb,val,col) in enumerate(zip(labels,values,colors)):
        x=10+i*(bw+gap)
        bh=int(val/mxv*80) if mxv else 4; bar_y=by-bh
        svg+=(f'<rect x="{x}" y="{bar_y}" width="{bw}" height="{bh}" rx="3" fill="{col}"/>'
              f'<text x="{x+bw//2}" y="{bar_y-3}" text-anchor="middle"'
              f' font-size="9" fill="#374151">{val}%</text>'
              f'<text x="{x+bw//2}" y="{by+14}" text-anchor="middle"'
              f' font-size="9" fill="#374151">{lb}</text>')
    return svg+"</svg>"

# ══════════════════════════════════════════════════════════════════
# PDF 텍스트 추출
# ══════════════════════════════════════════════════════════════════
def _combine_pages(pages:list)->str:
    parts=[]
    for p in sorted(pages,key=lambda x:x.get("page",0)):
        t=str(p.get("text") or "").strip()
        if t: parts.append(f"[페이지 {p.get('page','?')}]\n{t}")
    return "\n\n".join(parts)

def extract_pdf_text(pdf_bytes:bytes)->tuple[str,str]:
    emb=pdf_extract_text(pdf_bytes,max_pages=MAX_PAGES)
    if len(re.sub(r"\s+","",emb or ""))>=MIN_EMBEDDED_CHARS:
        return emb,"embedded"
    if not has_google_vision_credentials():
        raise ValueError("스캔 PDF는 Google Vision OCR이 필요합니다.\nservice-account-key.json을 확인해 주세요.")
    try:
        ocr=extract_text_google_vision(pdf_bytes,max_pages=MAX_PAGES,dpi=OCR_DPI)
    except GoogleVisionAuthError as e:
        raise ValueError(GOOGLE_VISION_AUTH_USER_MESSAGE) from e
    text=_combine_pages(ocr.get("pages") or [])
    if not text.strip():
        raise ValueError("Google Vision OCR로 텍스트를 읽지 못했습니다.")
    return text,"google_vision"

# ══════════════════════════════════════════════════════════════════
# GPT JSON 추출
# ══════════════════════════════════════════════════════════════════
def _call_gpt(school_name:str,pdf_text:str)->dict:
    api_key=resolve_api_key()
    if not api_key: raise RuntimeError("OpenAI API key가 없습니다.")
    client=_build_openai_client(api_key)
    user=( f"학교명: {school_name}\n분석일: {date.today()}\n\n"
           "아래 시험지 텍스트를 분석해 지정 JSON 스키마로 반환하세요.\n"
           "JSON 외 텍스트는 절대 포함하지 마세요.\n\n"
           f"--- 시험지 ---\n{pdf_text[:PDF_TEXT_MAX]}" )
    resp=client.chat.completions.create(
        model=GPT_MODEL, max_tokens=GPT_MAX_TOKENS,
        messages=[{"role":"system","content":JSON_SYSTEM_PROMPT},
                  {"role":"user","content":user}])
    raw=(resp.choices[0].message.content or "").strip()
    clean=_strip_fences(raw)
    clean=re.sub(r"^```[a-z]*\n?","",clean.strip(),flags=re.I)
    clean=re.sub(r"\n?```$","",clean.strip())
    try: return json.loads(clean)
    except:
        m=re.search(r"\{.*\}",clean,re.DOTALL)
        if m:
            try: return json.loads(m.group(0))
            except: pass
        raise ValueError(f"JSON 파싱 실패:\n{raw[:500]}")

# ══════════════════════════════════════════════════════════════════
# HTML 빌더
# ══════════════════════════════════════════════════════════════════
def _brand_html(academy_name:str,logo_uri:str)->str:
    logo=(f'<img class="academy-brand-logo" src="{logo_uri}" alt="로고">'
          if logo_uri else '<div class="academy-brand-placeholder">Σ</div>')
    return (f'<div class="academy-brand">{logo}'
            f'<span class="academy-brand-name">{html.escape(academy_name)}</span></div>')

def _build_page1(data:dict,school:str,academy:str,title:str,logo_uri:str)->str:
    bi=data.get("basic_info",{}); tr=data.get("trend",{})
    school_v=_clean(bi.get("school") or school or "○○학교")
    exam_type=_clean(bi.get("exam_type") or "기출문제")
    exam_date=_clean(bi.get("exam_date") or date.today().strftime("%Y년 %m월"))
    total_q=bi.get("total_questions","?")
    obj_c=bi.get("obj_count",""); sub_c=bi.get("sub_count","")
    comp_str=(f"총 {total_q}문항 (선택형 {obj_c}문항, 서술형 {sub_c}문항)"
              if obj_c and sub_c else f"총 {total_q}문항")
    tags="".join(f'<span class="tag">{_clean(t)}</span>'
                 for t in (bi.get("scope_tags") or []))
    summary=_clean(tr.get("summary",""))
    bullets="".join(f"<li>{_clean(b)}</li>" for b in (tr.get("bullets") or []))
    diff=_clean(tr.get("difficulty_level","중"))
    killer=_clean(tr.get("killer_questions",""))
    variable=_clean(tr.get("variable_factors",""))
    comp_detail=_clean(tr.get("composition_detail",""))
    brand=_brand_html(academy,logo_uri)

    return f"""<div class="page">
  <div class="page-badge">1</div>
  {brand}
  <div class="report-title">{html.escape(title)}</div>
  <div class="report-sub">{school_v} {exam_type} 심층 분석</div>

  <div class="section-title">1. 기본 정보</div>
  <div class="info-grid">
    <div class="info-cell"><div class="info-label">학교 및 학년</div><div class="info-value">{school_v}</div></div>
    <div class="info-cell"><div class="info-label">시험 종류</div><div class="info-value">{exam_type}</div></div>
    <div class="info-cell no-border-b"><div class="info-label">시험 일자</div><div class="info-value">{exam_date}</div></div>
    <div class="info-cell no-border-b"><div class="info-label">문항 구성</div><div class="info-value">{_clean(comp_str)}</div></div>
    <div class="tag-row"><span class="tag-label">시험 범위</span>{tags}</div>
  </div>

  <div class="section-title">2. 전체 구성 및 출제 경향</div>
  <div class="trend-box">
    <div class="trend-title">📊 출제 경향 요약</div>
    <p style="margin-bottom:10px;">{summary}</p>
    <ul class="bullet-list">{bullets}</ul>
  </div>
  <table class="diff-table">
    <tr><td>⚖ 전체 난이도</td><td><span class="diff-level">{diff}</span></td></tr>
    <tr><td>킬러 문항</td><td>{killer}</td></tr>
    <tr><td>변별력 요소</td><td>{variable}</td></tr>
  </table>
  <div class="trend-box">
    <div class="trend-title">📌 문항 구성 비율</div>
    <p style="font-size:12px;">{comp_detail}</p>
  </div>
</div>"""

def _build_page2(data:dict)->str:
    qs=data.get("questions") or []
    total=len(qs); disp=qs[:Q_TABLE_MAX]; omit=total-len(disp)
    rows=""
    for q in disp:
        num=q.get("num","?"); qt=q.get("type") or "객관"
        concept=_clean(q.get("concept",""))
        summary=_clean(q.get("summary",""))
        diff=q.get("difficulty","중")
        rate=q.get("correct_rate")
        rate_s=f"{rate}%" if rate is not None else "-"
        rows+=f"""    <tr>
      <td class="tc">{num}</td>
      <td class="tc">{_type_badge(qt)}</td>
      <td class="tl">{concept}</td>
      <td class="tl">{summary}</td>
      <td class="tc">{_diff_badge(diff)}</td>
      <td class="tc">{rate_s}</td>
    </tr>\n"""
    omit_note=(f'<p class="q-omit">※ 전체 {total}문항 중 {omit}문항 생략</p>'
               if omit>0 else "")
    return f"""<div class="page">
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
{rows}    </tbody>
  </table>
  {omit_note}
</div>"""

def _build_page3(data:dict)->str:
    kqs=data.get("key_questions") or []
    blocks=""
    for kq in kqs[:3]:
        num=kq.get("num","?"); emoji=kq.get("emoji","🔢")
        title=_clean(kq.get("title",""))
        tc=kq.get("tag_class","tag-high"); tl=_clean(kq.get("tag_label","상"))
        point=_clean(kq.get("point",""))
        why=_clean(kq.get("why_hard",""))
        mistake=_clean(kq.get("common_mistake",""))
        concepts="".join(f"<li>{_clean(c)}</li>" for c in (kq.get("concepts") or []))
        steps="".join(f"<li>{_clean(s)}</li>" for s in (kq.get("steps") or []))
        blocks+=f"""  <div class="key-q">
    <div class="key-q-header">
      <span class="key-q-title">{emoji} {num}번 &nbsp; {title}</span>
      <span class="key-q-tag {tc}">{tl}</span>
    </div>
    <div class="key-q-body">
      <div class="key-q-left">
        <div class="kq-subtitle">💡 핵심 포인트</div>
        <p class="kq-text">{point}</p>
        <div class="kq-subtitle">🔎 왜 어려웠을까?</div>
        <p class="kq-text">{why}</p>
        <div class="kq-subtitle">📚 필요 개념</div>
        <ul class="bullet-list">{concepts}</ul>
        {"" if not mistake else f'<div class="kq-subtitle" style="color:var(--red);margin-top:8px;">⚠️ 자주 하는 실수</div><p class="kq-text">{mistake}</p>'}
      </div>
      <div class="key-q-right">
        <div class="kq-subtitle">🚀 단계별 공략 솔루션</div>
        <ol class="step-list">{steps}</ol>
      </div>
    </div>
  </div>\n"""
    return f"""<div class="page">
  <div class="page-badge">3</div>
  <div class="section-title">4. 핵심 문항 심층 분석</div>
  <p style="font-size:12px;color:var(--gray);margin-bottom:14px;">이번 시험에서 오답률이 가장 높고 등급을 가르는 결정적인 역할을 한 핵심 문항을 선정하여 상세히 분석합니다.</p>
{blocks}</div>"""

def _build_page3b(data:dict)->str:
    kqs=data.get("key_questions") or []
    blocks=""
    for kq in kqs[2:4]:
        num=kq.get("num","?"); emoji=kq.get("emoji","🔢")
        title=_clean(kq.get("title",""))
        tc=kq.get("tag_class","tag-high"); tl=_clean(kq.get("tag_label","상"))
        point=_clean(kq.get("point",""))
        why=_clean(kq.get("why_hard",""))
        mistake=_clean(kq.get("common_mistake",""))
        concepts="".join(f"<li>{_clean(c)}</li>" for c in (kq.get("concepts") or []))
        steps="".join(f"<li>{_clean(s)}</li>" for s in (kq.get("steps") or []))
        blocks+=f"""  <div class="key-q">
    <div class="key-q-header">
      <span class="key-q-title">{emoji} {num}번 &nbsp; {title}</span>
      <span class="key-q-tag {tc}">{tl}</span>
    </div>
    <div class="key-q-body">
      <div class="key-q-left">
        <div class="kq-subtitle">💡 핵심 포인트</div>
        <p class="kq-text">{point}</p>
        <div class="kq-subtitle">🔎 왜 어려웠을까?</div>
        <p class="kq-text">{why}</p>
        <div class="kq-subtitle">📚 필요 개념</div>
        <ul class="bullet-list">{concepts}</ul>
        {"" if not mistake else f'<div class="kq-subtitle" style="color:var(--red);margin-top:8px;">⚠️ 자주 하는 실수</div><p class="kq-text">{mistake}</p>'}
      </div>
      <div class="key-q-right">
        <div class="kq-subtitle">🚀 단계별 공략 솔루션</div>
        <ol class="step-list">{steps}</ol>
      </div>
    </div>
  </div>\n"""
    return f"""<div class="page">
  <div class="page-badge">4</div>
  <div class="section-title">4. 핵심 문항 심층 분석 (계속)</div>
  <p style="font-size:12px;color:var(--gray);margin-bottom:14px;">핵심 문항 분석 이어서 수록합니다.</p>
{blocks}</div>"""

def _build_page4(data:dict)->str:
    ch=data.get("charts") or {}
    tr=data.get("trend") or {}
    gc_list=data.get("grade_cuts") or []

    dl=ch.get("domain_labels") or ["영역1","영역2","영역3","영역4"]
    dr=ch.get("domain_rates") or [70,60,55,45]
    dlow=ch.get("diff_low_pct") or 25
    dmid=ch.get("diff_mid_pct") or 45
    dhigh=ch.get("diff_high_pct") or 30
    gdist=ch.get("grade_dist") or [10,24,32,24,10]
    obj_r=tr.get("obj_rate") or 65
    sub_r=tr.get("sub_rate") or 42
    bar_note=_clean(tr.get("type_bar_note",""))

    donut=_svg_donut(dlow,dmid,dhigh)
    hbar=_svg_hbar(dl,dr)
    gcols=["#1E3A8A","#2563EB","#60A5FA","#93C5FD","#BFDBFE"]
    vbar=_svg_vbar(["1등급","2등급","3등급","4등급","5등급"],gdist,gcols)

    grade_rows=""
    for gc in gc_list:
        g=gc.get("grade","?"); bc=gc.get("badge_class") or f"g{g}"
        rng=_clean(gc.get("range","")); cut=_clean(gc.get("cut",""))
        desc=_clean(gc.get("desc",""))
        grade_rows+=f"""      <tr>
        <td><span class="grade-badge {bc}">{g}등급</span></td>
        <td>{rng}</td><td><span class="cut">{cut}</span></td>
        <td>{desc}</td>
      </tr>\n"""

    return f"""<div class="page">
  <div class="page-badge">5</div>
  <div class="section-title">5. 시험 분석 그래프</div>
  <div class="p4-charts">
    <div class="chart-card">
      <div class="chart-title">핵심 영역별 예상 정답률</div>
      {hbar}
    </div>
    <div class="chart-card">
      <div class="chart-title">난이도별 문항 분포</div>
      <div style="display:flex;justify-content:center;">{donut}</div>
    </div>
  </div>
  <div class="p4-bottom">
    <div>
      <div class="p4-section-label">유형별 예상 정답률</div>
      <div class="bar-row">
        <div class="bar-label">선택형</div>
        <div class="bar-track"><div class="bar-fill" style="width:{obj_r}%;background:var(--blue);"><span class="bar-pct">{obj_r}%</span></div></div>
      </div>
      <div class="bar-row">
        <div class="bar-label">서술형</div>
        <div class="bar-track"><div class="bar-fill" style="width:{sub_r}%;background:var(--orange);"><span class="bar-pct">{sub_r}%</span></div></div>
      </div>
      <p class="bar-note">{bar_note}</p>
    </div>
    <div>
      <div class="p4-section-label">등급별 예상 분포</div>
      {vbar}
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
{grade_rows}    </tbody>
  </table>
</div>"""

def _build_page5(data:dict)->str:
    st_data=data.get("strategy") or {}
    weekly=data.get("weekly_plan") or []
    pa=data.get("parent_advice") or {}

    def _items(lst,limit=3):
        return "".join(f"<li>{_clean(i)}</li>" for i in (lst or [])[:limit])

    top=f'<ul class="bullet-list">{_items(st_data.get("top",[]))}</ul>'
    mid=f'<ul class="bullet-list">{_items(st_data.get("mid",[]))}</ul>'
    low=f'<ul class="bullet-list">{_items(st_data.get("low",[]))}</ul>'

    week_rows=""
    for wp in weekly[:6]:
        wk=wp.get("week","?"); goal=_clean(wp.get("goal",""))
        content=wp.get("content","").replace("\n","<br>")
        qs=_clean(wp.get("questions",""))
        week_rows+=f"""      <tr>
        <td style="text-align:center;"><span class="week-badge">{wk}주차</span></td>
        <td><div class="week-goal">{goal}</div></td>
        <td class="week-items">{content}</td>
        <td style="font-size:11px;color:var(--blue-dark);font-weight:600;">{qs}</td>
      </tr>\n"""

    adv_title=_clean(pa.get("title","과정을 함께 점검해 주세요"))
    adv_body=_clean(pa.get("body",""))
    summary=_clean(pa.get("summary",""))
    tags="".join(f'<span class="hash-tag">{_clean(h)}</span>'
                 for h in (pa.get("hashtags") or []))

    return f"""<div class="page">
  <div class="page-badge">6</div>
  <div class="section-title">7. 등급별 맞춤 전략</div>
  <div class="strat-grid">
    <div class="strat-header">1~2등급 [최상위·상위권]</div>
    <div class="strat-header">3~4등급 [중위권]</div>
    <div class="strat-header">5등급 [기초·하위권]</div>
    <div class="strat-body">{top}</div>
    <div class="strat-body">{mid}</div>
    <div class="strat-body">{low}</div>
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
{week_rows}    </tbody>
  </table>

  <div class="section-title">9. 학부모님께 드리는 제언</div>
  <div class="advice-box">
    <div class="advice-title">💡 {adv_title}</div>
    <p>{adv_body}</p>
  </div>
  <div class="summary-box">
    <div class="summary-title">📋 종합 총평</div>
    <p>{summary}</p>
    <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;">{tags}</div>
  </div>
</div>"""

def _build_full_html(data:dict,*,school_name:str,academy_name:str,
                     report_title:str,logo_uri:str)->str:
    title=(report_title or "").strip() or f"{school_name} 기출문제 분석 보고서"
    p1=_build_page1(data,school_name,academy_name,title,logo_uri)
    p2=_build_page2(data)
    p3=_build_page3(data)
    p4=_build_page4(data)
    p5=_build_page5(data)
    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{html.escape(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Noto Sans KR:wght@300;400;500;700;900&display=swap" rel="stylesheet">
<style>
{REPORT_CSS}
</style>
</head>
<body>
<div class="page-wrap">
{p1}
{p2}
{p3}
{p4}
{p5}
</div>
</body>
</html>"""

# ══════════════════════════════════════════════════════════════════
# Playwright PDF (A4 완전 고정)
# ══════════════════════════════════════════════════════════════════
def _html_to_pdf_bytes(html_content:str)->bytes:
    from playwright.sync_api import sync_playwright
    A4_CSS="""<style id="pdf-a4">
@page{size:A4 portrait;margin:0;}
html,body{background:#fff!important;
  -webkit-print-color-adjust:exact!important;
  print-color-adjust:exact!important;}
.page-wrap{margin:0!important;max-width:210mm!important;width:210mm!important;}
.page{width:210mm!important;padding:14mm 16mm!important;
  margin:0!important;border-radius:0!important;box-shadow:none!important;
  page-break-after:always!important;break-after:page!important;
  box-sizing:border-box!important;overflow:hidden!important;
  font-size:12px!important;}
.section-title{font-size:13px!important;margin:14px 0 8px!important;}
.q-table{font-size:10px!important;}
.q-table td,.q-table th{padding:5px 5px!important;}
.plan-table{font-size:11px!important;}
.grade-table{font-size:11px!important;}
.strat-body{font-size:11px!important;}
</style>"""
    patched=html_content.replace("</head>",A4_CSS+"\n</head>",1)
    with sync_playwright() as p:
        browser=p.chromium.launch()
        page=browser.new_page(viewport={"width":794,"height":1123})
        page.set_content(patched,wait_until="domcontentloaded")
        page.wait_for_timeout(500)
        pdf=page.pdf(format="A4",print_background=True,
                     margin={"top":"0","bottom":"0","left":"0","right":"0"})
        browser.close()
    return pdf

# ══════════════════════════════════════════════════════════════════
# 데모 데이터
# ══════════════════════════════════════════════════════════════════
DEMO_DATA={
  "basic_info":{
    "school":"장충고등학교 고2","exam_type":"1학기 중간고사 대수",
    "exam_date":"2026년 04월 28일","total_questions":23,
    "obj_count":19,"sub_count":4,"total_score":100,
    "scope_tags":["지수와 로그","지수·로그함수","삼각함수","실생활 응용"]
  },
  "trend":{
    "summary":"본 시험지는 지수와 로그의 기본 계산 능력부터 삼각함수의 기초 개념, 지수·로그함수의 그래프 성질, 실생활 응용까지 대수 과목의 전반적인 이해도를 묻는 문항들로 고르게 구성되었습니다. 특히 함수 단원에서는 그래프의 3사분면 통과 여부, 대칭성, 역함수 관계를 활용하는 추론형 문항이 출제되어 그래프 해석 능력이 요구됩니다.",
    "bullets":[
      "지수와 로그의 연산 규칙을 정확히 알고 적용하는 기본 계산 문항이 전반부에 주로 출제되었습니다.",
      "지수·로그함수의 그래프 성질(접근선, 대칭성 등)을 활용하여 추론하는 문항의 비중이 높습니다.",
      "삼각함수의 기본 성질(sin, cos, tan)을 이용하여 각 사분면에서의 부호 판별 및 식의 값을 도출하는 문항이 출제되었습니다.",
      "서술형 문항에서는 부채꼴 넓이, 로그 법칙 증명, 지수·로그함수 최대최솟값, 삼각함수 부등식 범위 문제가 배치되었습니다."
    ],
    "difficulty_level":"중상",
    "killer_questions":"18번 (로그 부등식 정수 개수), 서술형3 (지수·로그함수 합성 최대최솟값), 서술형4 (삼각함수 부등식)",
    "variable_factors":"역함수·그래프 대칭성 파악, 복합 연산 처리 능력, 서술형 정확한 풀이 과정 서술 능력",
    "composition_detail":"선택형 19문항, 서술형 4문항으로 구성되어 있으며, 지수와 로그 단원 약 35%, 지수·로그함수 단원 약 30%, 삼각함수 단원 약 20%, 실생활 응용 및 복합 문항이 약 15%를 차지합니다. 전반부(1~10번)는 기본 개념과 단순 계산 위주로 평이하게 전개되며, 후반부 선택형(11~19번)과 서술형에 고난도 문항이 집중 배치되어 시간 안배가 매우 중요한 시험입니다.",
    "type_obj_pct":68,"type_sub_pct":32,"obj_rate":58,"sub_rate":38,
    "type_bar_note":"객관식 전반부에 비해 후반부 객관식(14~18번)과 서술형에서 복합 개념과 계산 요구가 높아 정답률이 낮게 나타납니다."
  },
  "questions":[
    {"num":"1","type":"객관","concept":"지수의 연산","summary":"5⁴×5⁻² 지수 연산 기본 계산","difficulty":"하","correct_rate":92},
    {"num":"2","type":"객관","concept":"로그 방정식","summary":"log₃(2x−1)=1 기본 로그 방정식 풀이","difficulty":"하","correct_rate":90},
    {"num":"3","type":"객관","concept":"삼각함수 값","summary":"tan(5π/6) 삼각함수 값 계산","difficulty":"중하","correct_rate":80},
    {"num":"4","type":"객관","concept":"로그 정의역","summary":"log₍ₓ₊₁₎(6−x) 정의되는 정수 x의 개수","difficulty":"중","correct_rate":75},
    {"num":"5","type":"객관","concept":"지수함수 그래프","summary":"y=aˣ⁻¹+1 이 항상 지나는 점 추론","difficulty":"중","correct_rate":78},
    {"num":"6","type":"객관","concept":"동경과 삼각비","summary":"θ와 5θ의 동경이 직각을 이룰 때 θ의 크기","difficulty":"중상","correct_rate":60},
    {"num":"7","type":"객관","concept":"지수함수 그래프","summary":"제3사분면을 지나지 않는 지수함수 선택","difficulty":"중상","correct_rate":58},
    {"num":"8","type":"객관","concept":"로그 방정식 응용","summary":"1보다 큰 두 실수 a, b 조건에서 log_a(b) 값 추론","difficulty":"중상","correct_rate":55},
    {"num":"9","type":"객관","concept":"합성함수·역함수","summary":"f(a)=½일 때 f(2a) 값 계산","difficulty":"중상","correct_rate":50},
    {"num":"10","type":"객관","concept":"지수 연산 복합","summary":"A+B+C 값 계산 (거듭제곱근·지수·로그 종합)","difficulty":"중상","correct_rate":48},
    {"num":"11","type":"객관","concept":"지수 실생활·상용로그","summary":"세균 개체 수 4배 이상 되는 최솟값 k","difficulty":"중상","correct_rate":52},
    {"num":"12","type":"객관","concept":"지수방정식·실근","summary":"두 실근 α, β에 대해 4^(1/α)×4^(1/β) 계산","difficulty":"중상","correct_rate":48},
    {"num":"13","type":"객관","concept":"삼각 부등식·범위","summary":"sin(x−π/3)>√3/2 만족하는 범위에서 α+β","difficulty":"중상","correct_rate":50},
    {"num":"14","type":"객관","concept":"n제곱근·실수 존재","summary":"음의 실수 n제곱근이 존재하는 n 값의 합","difficulty":"상","correct_rate":38},
    {"num":"15","type":"객관","concept":"지수함수·내분점","summary":"AB를 2:1 내분하는 점이 원점 O일 때 AB² 값","difficulty":"상","correct_rate":35},
    {"num":"16","type":"객관","concept":"삼각방정식·합산","summary":"조건 만족하는 모든 x 값의 합","difficulty":"상","correct_rate":32},
    {"num":"17","type":"객관","concept":"로그함수·삼각형 넓이","summary":"삼각형 ABC 넓이 계산","difficulty":"상","correct_rate":30},
    {"num":"18","type":"객관","concept":"로그 부등식·정수 개수","summary":"정수 x가 3개가 되도록 하는 자연수 n의 개수","difficulty":"최상","correct_rate":22},
    {"num":"19","type":"객관","concept":"삼각함수 최대최솟값","summary":"0≤x≤π에서 M×m 계산","difficulty":"상","correct_rate":38},
    {"num":"서술1","type":"서술","concept":"부채꼴 넓이","summary":"중심각 2/3 rad, 호의 길이 4인 부채꼴의 넓이","difficulty":"중","correct_rate":65},
    {"num":"서술2","type":"서술","concept":"로그 밑 변환 증명","summary":"log_a(b)=log_c(b)/log_c(a) 증명","difficulty":"중상","correct_rate":45},
    {"num":"서술3","type":"서술","concept":"지수·로그함수 최대최솟값","summary":"10≤x≤100에서 f(x)의 최댓값 M, 최솟값 m → M+m","difficulty":"상","correct_rate":30},
    {"num":"서술4","type":"서술","concept":"삼각함수 부등식","summary":"x²+2xsinθ+1>0이 항상 성립하는 θ의 범위","difficulty":"최상","correct_rate":20}
  ],
  "key_questions":[
    {"num":"18","emoji":"🔢","title":"로그 부등식 — 정수 x의 개수 조건","tag_class":"tag-killer","tag_label":"최상",
     "point":"x²−x·log₃3n+log₃n≤0을 만족하는 정수 x의 개수가 정확히 3이 되도록 하는 자연수 n의 개수를 구하는 문제입니다. A=log₃n으로 치환 후 이차부등식의 근 사이 정수 개수를 분석해야 합니다.",
     "why_hard":"A=log₃n 치환 후 두 근 사이에 정수 x가 정확히 3개가 되는 A 범위를 설정하고, 이를 다시 n 범위로 역변환하는 이중 치환 과정이 복잡합니다.",
     "concepts":["이차부등식의 해 (두 근의 위치)","로그를 이용한 치환 (A=log₃n)","근과 계수의 관계 (근의 합·곱)"],
     "steps":["A=log₃n으로 치환 → x²−x(A+1)+A≤0 변환","인수분해: (x−1)(x−A)≤0 → 두 근은 1과 A","두 근 사이 정수가 3개인 A의 범위 탐색","A=log₃n의 범위를 n 범위로 역변환 후 자연수 n 개수 산출"]},
    {"num":"서술3","emoji":"📐","title":"지수·로그함수 합성 최대최솟값","tag_class":"tag-high","tag_label":"상",
     "point":"10≤x≤100 범위에서 f(x)=2^(log₂x)²−4×2^(log₁₀₀x)의 최대·최솟값을 구하는 문제입니다. 로그를 치환하여 이차 형태로 변환하는 핵심 아이디어를 찾는 것이 관건입니다.",
     "why_hard":"단순 대입으로는 풀 수 없고, t=log₂x로 치환하여 이차함수 형태로 바꾸는 과정과 x의 범위를 t의 범위로 변환하는 논리적 연결이 어렵습니다.",
     "concepts":["지수·로그함수 합성","치환을 통한 이차함수 변환","범위 변환 (x → t)"],
     "steps":["t=log₂x 치환 → x:10~100이면 t 범위 설정","f를 t에 대한 이차식으로 변환","구간 내 최대·최솟값 탐색 (꼭짓점·경계값 비교)","M, m 도출 후 M+m 계산"]},
    {"num":"서술4","emoji":"🔺","title":"삼각함수 부등식 — θ의 범위","tag_class":"tag-killer","tag_label":"최상",
     "point":"모든 실수 x에 대해 x²+2x·sinθ+1>0이 항상 성립하는 θ의 범위를 구하는 문제입니다. 이차부등식이 모든 실수에서 성립할 조건인 판별식 D<0을 이용합니다.",
     "why_hard":"이차부등식의 '항상 성립' 조건을 삼각함수와 연결하는 발상이 필요하며, D<0에서 sinθ의 범위, 단위원에서 θ의 범위로 변환하는 과정이 복잡합니다.",
     "concepts":["이차부등식의 항상 성립 조건 (D<0)","삼각함수 부등식 |sinθ|<1","삼각함수 범위 → θ 범위 변환"],
     "steps":["판별식 D=(2sinθ)²−4<0 설정","4sin²θ<4 → |sinθ|<1","sinθ≠±1 → θ≠π/2, 3π/2 (0≤θ<2π)","최종: 0≤θ<π/2 또는 π/2<θ<3π/2 또는 3π/2<θ<2π"]}
  ],
  "charts":{
    "domain_labels":["지수와 로그","지수·로그함수","삼각함수","실생활·추론"],
    "domain_rates":[72,48,55,40],
    "diff_low_pct":9,"diff_mid_pct":39,"diff_high_pct":52,
    "grade_dist":[10,24,32,24,10]
  },
  "grade_cuts":[
    {"grade":1,"badge_class":"g1","range":"상위 10%","cut":"88점 이상","desc":"서술형 고난도 포함 전 문항 완벽 해결 가능한 최상위권"},
    {"grade":2,"badge_class":"g2","range":"10~34%","cut":"74점 이상","desc":"기본/실력 문항 모두 맞추고, '상' 난이도 서술형에서 부분 점수 획득 구간"},
    {"grade":3,"badge_class":"g3","range":"34~66%","cut":"56점 이상","desc":"기본 개념은 갖추나, 서술형 고난도와 후반 객관식 일부에서 실점 발생"},
    {"grade":4,"badge_class":"g4","range":"66~90%","cut":"38점 이상","desc":"기초 지수·로그 개념 위주로 득점. 삼각함수 및 함수 단원 보완 필요"},
    {"grade":5,"badge_class":"g5","range":"90~100%","cut":"38점 미만","desc":"기초 개념 이해와 연산 훈련이 부족한 상태. 교과서부터 재학습 필요"}
  ],
  "strategy":{
    "top":["서술형3·4 유형의 치환·판별식 연결 공식을 반복 훈련합니다.","미지수 설정부터 최종 결론까지 감점 없이 작성하는 연습이 필요합니다.","계산이 긴 문제에서 중간 부호와 지수 값의 실수를 차단해야 합니다."],
    "mid":["지수·로그 연산 공식과 그래프 성질을 바르게 풀 수 있도록 훈련합니다.","기본 그래프를 직접 그리며 점근선과 교점을 찾는 연습을 합니다.","틀린 문제의 전형 유형을 파악하고 동 유형의 유사 문제를 3회 이상 풀어 체화합니다."],
    "low":["교과서와 기본서의 예제·유제를 반복해서 풀어 연산의 두려움을 없애는 것이 1순위입니다.","거듭제곱근, 로그의 밑/진수 조건, 라디안 개념을 백지에 적어 연습합니다.","전반부 기본 개념 문항에 시간 낭비 없이 빠르게 답을 내는 것을 목표로 합니다."]
  },
  "weekly_plan":[
    {"week":1,"goal":"지수·로그 연산 완성","content":"• 지수법칙과 로그의 기본 성질 집중 복습\n• 거듭제곱근 정의와 실근 개수 판별\n• 상용로그 활용 계산 (log2, log3 암기)","questions":"1번, 2번, 10번, 11번"},
    {"week":2,"goal":"지수·로그함수 그래프","content":"• y=aˣ, y=logₐx 기본 그래프 개형 완벽 이해\n• 평행이동·대칭이동 적용 후 그래프 변환\n• 3사분면 통과 조건, 수직점근선 파악","questions":"5번, 7번, 15번, 17번"},
    {"week":3,"goal":"삼각함수 기초·동경","content":"• 호도법과 부채꼴 넓이 공식 완벽 암기\n• 동경 개념과 사분면 각도 판별 훈련\n• sin·cos·tan 값과 부호 사분면 정리","questions":"3번, 6번, 서술1"},
    {"week":4,"goal":"삼각함수 방정식·부등식","content":"• 삼각 방정식 풀이 (일반해 → 범위 제한)\n• 삼각 부등식과 단위원 활용 범위 설정\n• 합성 삼각함수의 최대·최솟값 구하기","questions":"13번, 16번, 19번, 서술4"},
    {"week":5,"goal":"복합·고난도 문항 공략","content":"• 역함수·합성함수 연계 문제 집중 훈련\n• 지수방정식의 치환(t=5ˣ) 기법 반복\n• 로그 부등식 + 정수 개수 조건 유형 연습","questions":"9번, 12번, 14번, 18번"},
    {"week":6,"goal":"서술형 완성 + 실전 모의","content":"• 서술형3·4 유형 치환·판별식 반복 풀이\n• 실제 시험 시간(50분) 내 OMR 마킹 모의 훈련\n• 오답 노트 정리 및 핵심 공식 최종 점검","questions":"서술형 전체, 취약 문항 재풀이"}
  ],
  "parent_advice":{
    "title":"이번 시험, 점수 이면의 '과정'을 칭찬해주세요.",
    "body":"이번 대수 시험은 단순한 연산 능력을 넘어, 함수의 그래프를 직접 그리고 기하학적인 대칭성과 교점의 의미를 추론해야 하는 매우 까다로운 시험이었습니다. 복합적인 시각적 사고를 요구했으므로 체감 난이도가 상당히 높았을 것입니다. 단순히 몇 점을 맞았느냐보다는, 어느 단원에서 개념이 흔들렸는지, 시간이 부족했는지 함께 분석하는 과정이 필요합니다.",
    "summary":"이번 1학기 중간고사는 대수 과목의 본질인 '식의 계산'과 '함수 그래프의 해석' 능력을 심도 있게 평가하는 수준 높은 시험이었습니다. 전체적으로 중상~상 난이도의 문항이 절반 이상 배치되어 변별력이 매우 컸습니다. 단계별 학습 계획을 꾸준히 실행하면 다음 시험에서 유의미한 성적 향상을 기대할 수 있습니다.",
    "hashtags":["#고난도_그래프추론","#역함수_대칭성","#시간관리필수","#수능형기출대비"]
  }
}

# ══════════════════════════════════════════════════════════════════
# 메인 생성 함수
# ══════════════════════════════════════════════════════════════════
def generate_past_exam_report_html(*,school_name:str,academy_name:str,
                                    report_title:str,logo_uri:str,pdf_text:str)->str:
    title=(report_title or "").strip() or f"{school_name} 기출문제 분석 보고서"
    if not resolve_api_key():
        return _build_full_html(DEMO_DATA,school_name=school_name,
                                academy_name=academy_name,report_title=title,logo_uri=logo_uri)
    data=_call_gpt(school_name=school_name,pdf_text=pdf_text)
    return _build_full_html(data,school_name=school_name,
                            academy_name=academy_name,report_title=title,logo_uri=logo_uri)

# ══════════════════════════════════════════════════════════════════
# Streamlit UI
# ══════════════════════════════════════════════════════════════════
def render_past_exam_analyzer_page()->None:
    os.makedirs(DATA_DIR,exist_ok=True)
    st.markdown("### 기출문제 분석 보고서")
    st.caption(f"학교 기출 PDF → GPT JSON 추출 → Python 템플릿 → 5페이지 보고서 (모델: {GPT_MODEL})")
    if not has_openai_api_key():
        st.info("API 키가 없으면 **장충고 데모 보고서**가 생성됩니다.")

    school_name=st.text_input("학교명",placeholder="예: 장충고등학교 고2",key="pe_school")
    academy_name=st.text_input("학원명",value=DEFAULT_ACADEMY,key="pe_academy")
    report_title=st.text_input("보고서 제목",placeholder="예: 2026학년도 장충고 고2 1학기 중간고사 분석보고서",key="pe_title")

    with st.expander("학원 로고",expanded=False):
        if os.path.isfile(LOGO_PATH): st.image(LOGO_PATH,width=80)
        lf=st.file_uploader("로고 업로드",type=["png","jpg","jpeg"],key="pe_logo")
        if lf:
            _save_logo(lf); st.success("저장 완료"); st.rerun()

    uploaded_files=st.file_uploader(
        "기출 파일 업로드 (PDF 또는 JPG/PNG 이미지 — 여러 파일 동시 선택 가능)",
        type=["pdf","jpg","jpeg","png"],
        accept_multiple_files=True,
        key="pe_pdf",
    )
    if uploaded_files:
        st.caption(f"📎 {len(uploaded_files)}개 파일 선택됨: " +
                   ", ".join(f.name for f in uploaded_files))

    if st.button("📊 분석 보고서 생성",type="primary",
                 disabled=not uploaded_files,key="pe_gen"):
        if not school_name.strip():
            st.warning("학교명을 입력해 주세요.")
        else:
            try:
                all_texts=[]
                used_vision=False
                for i, uf in enumerate(uploaded_files):
                    fname_lower=(uf.name or "").lower()
                    is_image=fname_lower.endswith((".jpg",".jpeg",".png"))
                    if is_image:
                        with st.spinner(f"[{i+1}/{len(uploaded_files)}] 이미지 OCR 중… {uf.name}"):
                            if not has_google_vision_credentials():
                                raise ValueError(
                                    "이미지 OCR을 위해 Google Vision이 필요합니다.\n"
                                    "`service-account-key.json`을 확인해 주세요.")
                            try:
                                ocr=extract_text_google_vision(uf.getvalue())
                            except GoogleVisionAuthError as exc:
                                raise ValueError(GOOGLE_VISION_AUTH_USER_MESSAGE) from exc
                            pages=ocr.get("pages") or []
                            text="\n\n".join(
                                f"[페이지 {p.get('page','?')}]\n{str(p.get('text',''))}"
                                for p in sorted(pages,key=lambda x:x.get("page",0))
                                if str(p.get("text","")).strip()
                            )
                            if text.strip():
                                all_texts.append(f"[파일: {uf.name}]\n{text}")
                                used_vision=True
                    else:
                        with st.spinner(f"[{i+1}/{len(uploaded_files)}] PDF 텍스트 추출 중… {uf.name}"):
                            text, method=extract_pdf_text(uf.getvalue())
                            if text.strip():
                                all_texts.append(f"[파일: {uf.name}]\n{text}")
                            if method=="google_vision":
                                used_vision=True

                if not all_texts:
                    raise ValueError("업로드한 파일에서 텍스트를 읽지 못했습니다.\n파일이 선명한지 확인해 주세요.")

                pdf_text="\n\n".join(all_texts)

                if used_vision:
                    st.info(f"✅ {len(uploaded_files)}개 파일 추출 완료 (Google Vision OCR 포함)")
                else:
                    st.info(f"✅ {len(uploaded_files)}개 파일 추출 완료")
                logo_uri=_logo_data_uri()
                with st.spinner(f"GPT 분석 중… ({GPT_MODEL})"):
                    html_report=generate_past_exam_report_html(
                        school_name=school_name.strip(),
                        academy_name=(academy_name or DEFAULT_ACADEMY).strip(),
                        report_title=report_title.strip(),
                        logo_uri=logo_uri, pdf_text=pdf_text)
                st.session_state["pe_html"]=html_report
                st.session_state["pe_fname"]=(
                    f"기출분석_{_sanitize_filename(school_name)}_{date.today()}.html")
                st.success("✅ 보고서 생성 완료!")
            except Exception as e:
                msg=str(e)
                if "401" in msg or "authentication" in msg.lower():
                    st.error(OPENAI_AUTH_USER_MESSAGE)
                else:
                    st.error(f"보고서 생성 실패: {e}")

    html_report=st.session_state.get("pe_html")
    if html_report:
        st.divider()
        fname=st.session_state.get("pe_fname","past_exam_report.html")
        col1,col2,col3=st.columns(3)
        with col1:
            st.download_button("⬇️ HTML 다운로드",
                data=html_report.encode("utf-8"),
                file_name=fname,mime="text/html",key="pe_dl")
        with col2:
            if st.button("📄 PDF 다운로드",key="pe_pdf_btn"):
                with st.spinner("PDF 생성 중… (약 10초)"):
                    try:
                        pdf_bytes=_html_to_pdf_bytes(html_report)
                        st.download_button("📥 PDF 저장",data=pdf_bytes,
                            file_name=fname.replace(".html",".pdf"),
                            mime="application/pdf",key="pe_pdf_save")
                        st.success("PDF 생성 완료!")
                    except Exception as e:
                        st.error(f"PDF 생성 실패: {e}\n\npip install playwright && playwright install chromium")
        with col3:
            enc=base64.b64encode(html_report.encode("utf-8")).decode()
            components.html(f"""
<script>
function openR(){{
  var b=atob("{enc}"),a=new Uint8Array(b.length);
  for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);
  window.open(URL.createObjectURL(new Blob([a],{{type:'text/html'}})),'_blank');
}}
</script>
<button onclick="openR()" style="background:#2563EB;color:#fff;border:none;
border-radius:6px;padding:8px 14px;font-size:13px;font-weight:600;
cursor:pointer;white-space:nowrap;">📊 새 탭에서 열기</button>""",height=50)
