"""Past exam PDF → GPT text analysis → 5-page HTML report (template-based)."""

from __future__ import annotations

import base64
import html
import os
import re
from datetime import date
from functools import lru_cache
from typing import Any

import streamlit as st
import streamlit.components.v1 as components

from ocr_extract import (
    GOOGLE_VISION_AUTH_USER_MESSAGE,
    GoogleVisionAuthError,
    MIN_EMBEDDED_CHARS,
    OPENAI_AUTH_USER_MESSAGE,
    _build_openai_client,
    _strip_fences,
    extract_text_google_vision,
    has_google_vision_credentials,
    has_openai_api_key,
    pdf_extract_text,
    resolve_api_key,
)

# ── Paths & constants ─────────────────────────────────────────────
_MODULE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(_MODULE_DIR, "data")
LOGO_PATH = os.path.join(DATA_DIR, "academy_logo.png")
TEMPLATE_PATH = os.path.join(
    _MODULE_DIR, "templates", "03_장충고_대수_분석보고서.html"
)

DEFAULT_ACADEMY_NAME = "압구정 페르마 수학"
ACADEMY_BRAND_MARKER = "<!-- ACADEMY_BRAND -->"
REPORT_TITLE_MARKER = "<!-- REPORT_TITLE -->"
GPT_MODEL = "gpt-4o"
GPT_MAX_TOKENS = 16384
PDF_TEXT_MAX_CHARS = 16000
PAST_EXAM_MAX_PAGES = 10
PAST_EXAM_OCR_DPI = 150

EXTRA_CSS = """
  /* 학원 브랜드 (PAGE 1 상단) */
  .academy-brand{display:flex;align-items:center;gap:14px;margin-bottom:18px;
    padding-bottom:14px;border-bottom:1px solid var(--border);}
  .academy-brand-logo{width:72px;height:72px;object-fit:contain;border-radius:8px;
    border:1px solid var(--border);flex-shrink:0;}
  .academy-brand-placeholder{width:72px;height:72px;border-radius:8px;flex-shrink:0;
    background:var(--blue-light);display:flex;align-items:center;justify-content:center;
    font-size:22px;font-weight:900;color:var(--blue-dark);}
  .academy-brand-name{font-size:16px;font-weight:800;color:var(--blue-dark);}

  /* 보고서 메인 제목 (입력값 고정) */
  .report-title-main{font-size:28px;font-weight:900;line-height:1.35;
    color:var(--black);margin:0 0 20px 0;}

  /* A4 세로(portrait) — 인쇄·미리보기 공통 */
  @page{size:A4 portrait;margin:10mm;}
  .page-wrap{max-width:794px;margin:24px auto;display:flex;flex-direction:column;}
  .page{max-width:794px;width:100%;min-height:1050px;overflow:hidden;overflow-x:hidden;
    page-break-after:always;break-after:page;}
  @media print{
    body{background:#fff;}
    .page-wrap{margin:0;max-width:100%;}
    .page{box-shadow:none;margin-bottom:0;border-radius:0;}
  }
  html,body{overflow-x:hidden;overflow-y:auto;max-height:none;}
  canvas{max-height:300px!important;}
  .chart-card{overflow:visible!important;}
  @media (max-width:900px){
    .p4-charts,.p4-bottom{grid-template-columns:1fr!important;}
    .key-q-body{grid-template-columns:1fr!important;}
    .key-q-left{border-right:none!important;border-bottom:1px solid var(--border);}
  }
"""

SYSTEM_PROMPT = """\
당신은 한국 수학 시험지 분석 전문 교육 컨설턴트입니다.
아래 시험지 텍스트(pdf_text)만 분석하여 학원 교육용 **5페이지 HTML 보고서**를 작성하세요.
이미지는 제공되지 않습니다.

## 참고 템플릿
`03_장충고_대수_분석보고서.html`과 **동일한 CSS·클래스명·섹션 구조**를 따르세요.

### 템플릿 CSS (<head>에 그대로 포함, 수정 금지)
<style>
{css}
</style>

### 템플릿 HTML 구조 참조
```html
{template_body}
```

### Chart.js 초기화 참조
```html
{chart_script}
```

## HTML 생성 규칙 (반드시 준수)

### Chart.js 로드 위치
<head> 태그 안에 반드시 포함:
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>

Chart.js CDN script는 **<head> 안에만** 둘 것. </body> 뒤·<html> 밖·PAGE 내부에 두지 말 것.

### PAGE 4 필수 구조 (canvas 3개 + chart-card)
PAGE 4에는 domainChart, diffChart, gradeChart **3개 canvas ID가 모두** 있어야 함.
canvas는 **래퍼 div 없이** chart-card 안에 두고, canvas 자체에 `style="height:XXXpx;"` 인라인 지정:

<div class="chart-card">
  <div class="chart-title">핵심 영역별 예상 정답률</div>
  <canvas id="domainChart" style="height:200px;"></canvas>
</div>
<div class="chart-card">
  <div class="chart-title">난이도별 문항 분포</div>
  <canvas id="diffChart" style="height:160px;"></canvas>
</div>
<div>
  <div class="p4-section-label">등급별 예상 분포</div>
  <canvas id="gradeChart" style="height:160px;width:100%;display:block;"></canvas>
</div>

gradeChart canvas가 HTML에 없는데 JS에서 getElementById('gradeChart')를 호출하면 전체 페이지가 깨지므로,
**canvas 3개를 HTML에 먼저 넣은 뒤** script에서 초기화할 것.

### Script 위치 및 Chart.js options
</body> **바로 앞**에 <script> 블록 **1개만** 작성.
반드시 domainChart, diffChart, gradeChart 3개 id를 new Chart()로 **모두** 초기화.
HTML에 없는 id를 절대 참조하지 말 것.
<script src="...chart.umd.min.js"> 형태의 로드 태그는 script 블록·</body> 뒤에 넣지 말 것.

각 new Chart() 호출의 options에 **반드시** 아래 두 줄을 포함할 것:
responsive: true,
maintainAspectRatio: false,

maintainAspectRatio: true 이면 canvas height가 무시되어 그래프가 안 보일 수 있음.

### PAGE 1 academy-brand (앱 삽입 — GPT 직접 작성 금지)
`{brand_marker}` 주석만 출력. 앱이 아래 구조로 대체함 — **div를 반드시 닫을 것**:
<div class="academy-brand">
  <img class="academy-brand-logo" src="..." alt="학원 로고">
  <span class="academy-brand-name">...</span>
</div>
img·span을 academy-brand 밖에 두거나 academy-brand div를 닫지 않으면 PAGE 1 배경·레이아웃이 깨짐.

### page-wrap / page 중첩 (필수)
<body> 안에 `<div class="page-wrap">` **1개만** 사용.
page-wrap은 PAGE 1~5를 **모두** 감싼 뒤 **맨 마지막에 1번만** 닫을 것:
  <div class="page-wrap">
    <div class="page"> ... </div>   ← PAGE 1
    <div class="page"> ... </div>   ← PAGE 2
    ...
    <div class="page"> ... </div>   ← PAGE 5
  </div>
PAGE 1 직후 `</div>`로 page-wrap을 닫으면 PAGE 2~5가 page-wrap 밖으로 나가 왼쪽으로 쏠림 — **절대 금지**.
각 `<div class="page">`는 열고 닫는 `</div>`가 1:1로 대응해야 함.

### PAGE 5 필수 구조
strat-grid 안에 **정확히 6개** div:
header 3개 + body 3개 순서로 배치.

### 전체 구조 순서
1. <!DOCTYPE html>
2. <html><head> ... Chart.js script ... CSS ... </head>
3. <body>
4. <div class="page-wrap"> 안에 PAGE 1 ~ PAGE 5 순서대로 (5개 필수, 누락 금지)
5. </div> (page-wrap 닫기)
6. <script> ... new Chart() 3개 ... </script>
7. </body></html>

## 출력 형식
- 완전한 HTML 문서 하나만 출력 (위 **전체 구조 순서** 준수).
- `<body>`: `<div class="page-wrap">` 안에 **정확히 5개** `<div class="page">` — PAGE 5 생략·미완성 금지.
- 모든 `.page`는 max-width 794px 세로(portrait) 방향. 가로로 늘어나는 wide/landscape 레이아웃 금지.

## PAGE 1 — 타이틀 + 기본정보 + 출제경향
순서:
  ① `{brand_marker}` 주석만 (학원 로고·이름 — 앱 삽입, GPT 출력 금지)
  ② `{title_marker}` 주석만 (보고서 제목 — 앱 삽입, GPT가 제목 작성·수정 금지)
  ③ `<div class="page-badge">1/5</div>`
  ④ section-title "1. 기본 정보" → info-grid, tag-row
  ⑤ section-title "2. 전체 구성 및 출제 경향" → trend-box, bullet-list, diff-table

## PAGE 2 — 문항별 분석표 (세로 방향 유지)
- page-badge 2/5, section-title "3. 문항별 상세 분석"
- q-table (badge-obj/sub, badge-low~killer, tc/tl)
- q-table 에는 선택형 전체 + 서술형 전체, 모든 문항을 빠짐없이 작성할 것.
- 일부만 쓰고 페이지를 마감하는 것 절대 금지. 문항 수가 20개면 20행 모두 작성.
- 행이 많아 페이지를 넘어가도 괜찮음. 전체 문항을 다 쓸 것.

## PAGE 3 — 핵심문항 심층분석 (세로 방향 유지)
- page-badge 3/5, section-title "4. 핵심 문항 심층 분석"
- key-q 블록 2~3개 (시험 난이도·문항 수에 따라 조정)
- 가장 중요한 킬러·고난도 문항 위주로 선정.

## PAGE 4 — 그래프 + 등급분포
- page-badge 4/5, section-title "5. 시험 분석 그래프"
- p4-charts, p4-bottom, section-title "6. 예상 등급 분포" → grade-table
- canvas 3개는 **chart-card + canvas 인라인 height** (HTML 생성 규칙 참조)
- Chart.js options: responsive:true, maintainAspectRatio:false 필수
- domainChart 의 labels 는 반드시 실제 시험에서 분석한 영역명을 사용할 것. '영역1','영역2' 같은 임시 레이블 절대 금지. 예: ['이등변삼각형','직각삼각형','내심·외심','닮음']
- diffChart 도넛 차트: 각 조각 위에 퍼센트를 직접 표기하는 커스텀 플러그인을 사용할 것. afterDraw 훅으로 arc 중심에 fillText 로 퍼센트 표기. canvas 아래에도 텍스트로 표기: <div style="font-size:11px;margin-top:8px;text-align:center;">하 XX% / 중 XX% / 상 XX%</div>
- 유형별 예상 정답률 bar-row 는 선택형·서술형 각각 1개씩 총 2개 작성. 1개만 쓰는 것 금지.

## PAGE 5 — 전략 + 6주 플랜 + 학부모 제언 (세로 방향 유지)
- page-badge 5/5 — **반드시 출력, 누락 금지**
- section-title "7. 등급별 맞춤 전략" → strat-grid (HTML 생성 규칙의 6개 div 구조)
- section-title "8. 단기 6주 집중 학습 플랜" → plan-table
- section-title "9. 학부모님께 드리는 제언" → advice-box, summary-box
- 모든 내용(전략·플랜·제언)은 이번 시험의 실제 분석 내용을 반영할 것. "기본 문제집 풀이" 같은 generic 내용 금지.
- 분석한 취약 단원명, 킬러 문항 번호, 출제 경향을 구체적으로 언급할 것.
- 학부모님께 드리는 제언은 장충고 분석보고서 수준으로 구체적이고 길게 서술할 것. 1~2줄 요약 금지.
- 6주 플랜은 각 주차마다 이번 시험의 실제 문항 번호와 단원명을 연결해서 작성할 것. 컬럼은 주차/학습목표/핵심학습내용/이번시험연결문항 4개로 구성.

### PAGE 5 strat-grid 예시 (6개 div — 개수 변경 금지)
  <div class="strat-grid">
    <div class="strat-header">1~2등급 [최상위·상위권]</div>
    <div class="strat-header">3~4등급 [중위권]</div>
    <div class="strat-header">5등급 [기초·하위권]</div>
    <div class="strat-body">내용</div>
    <div class="strat-body">내용</div>
    <div class="strat-body">내용</div>
  </div>

header 3개 + body 3개 = 총 6개. 4·5·7개 등 다른 개수 금지.

## 작성 규칙
- 한국어, 전문적·구체적. 없는 수치는 "(추정)" 표기.
- 5페이지 모두 **반드시 완성**할 것. PAGE 4·5를 생략하거나 제목만 쓰고 끝내지 말 것.
- PAGE 2 q-table은 선택형·서술형 모든 문항을 빠짐없이 포함할 것. 문항 수만큼 행을 작성하고 생략 금지.
- info-grid에 학교명 `{school_name}` 반영.
- 보고서 제목·학원 브랜드는 마커 위치만 비워 두세요.
"""


# ── Template loading ──────────────────────────────────────────────
@lru_cache(maxsize=1)
def _load_template_raw() -> str:
    if not os.path.isfile(TEMPLATE_PATH):
        raise FileNotFoundError(f"템플릿 없음: {TEMPLATE_PATH}")
    with open(TEMPLATE_PATH, encoding="utf-8") as fh:
        return fh.read()


@lru_cache(maxsize=1)
def _get_report_css() -> str:
    raw = _load_template_raw()
    match = re.search(r"<style>(.*?)</style>", raw, re.DOTALL)
    base = match.group(1) if match else ""
    return base + EXTRA_CSS


def _get_template_body(*, max_chars: int = 14000) -> str:
    raw = _load_template_raw()
    match = re.search(r"<body>(.*?)</body>", raw, re.DOTALL | re.IGNORECASE)
    body = match.group(1).strip() if match else ""
    if len(body) > max_chars:
        return body[:max_chars] + "\n<!-- ... 생략 ... -->"
    return body


def _get_chart_script_ref() -> str:
    raw = _load_template_raw()
    match = re.search(r"<script>\s*new Chart.*?</script>", raw, re.DOTALL)
    return match.group(0) if match else ""


def _build_system_prompt(*, school_name: str) -> str:
    return SYSTEM_PROMPT.format(
        css=_get_report_css(),
        template_body=_get_template_body(),
        chart_script=_get_chart_script_ref(),
        brand_marker=ACADEMY_BRAND_MARKER,
        title_marker=REPORT_TITLE_MARKER,
        school_name=school_name,
    )


# ── Logo & brand ──────────────────────────────────────────────────
def _logo_data_uri() -> str:
    if not os.path.isfile(LOGO_PATH):
        return ""
    with open(LOGO_PATH, "rb") as fh:
        raw = fh.read()
    ext = os.path.splitext(LOGO_PATH)[1].lower()
    mime = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"
    return f"data:{mime};base64,{base64.b64encode(raw).decode()}"


def _save_logo(uploaded_file) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(LOGO_PATH, "wb") as fh:
        fh.write(uploaded_file.getvalue())


def _build_academy_brand(academy_name: str, logo_uri: str) -> str:
    esc = html.escape
    if logo_uri:
        logo = (
            f'<img class="academy-brand-logo" src="{logo_uri}" alt="학원 로고">'
        )
    else:
        logo = '<div class="academy-brand-placeholder">Σ</div>'
    return (
        '<div class="academy-brand">\n'
        f"  {logo}\n"
        f'  <span class="academy-brand-name">{esc(academy_name)}</span>\n'
        "</div>"
    )


def _build_report_title_html(report_title: str) -> str:
    return f'<div class="report-title-main">{html.escape(report_title)}</div>'


def _default_report_title(school_name: str) -> str:
    school = (school_name or "").strip() or "○○고등학교"
    return f"{school} 기출문제 분석 보고서"


# ── PDF text extraction ───────────────────────────────────────────
def _combine_page_texts(pages: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for page in sorted(pages, key=lambda p: p.get("page", 0)):
        text = str(page.get("text") or "").strip()
        if text:
            parts.append(f"[페이지 {page.get('page', '?')}]\n{text}")
    return "\n\n".join(parts)


def _embedded_char_count(text: str) -> int:
    return len(re.sub(r"\s+", "", text or ""))


def extract_pdf_text(pdf_bytes: bytes) -> tuple[str, str]:
    """Return (text, method) where method is 'embedded' or 'google_vision'."""
    embedded = pdf_extract_text(pdf_bytes, max_pages=PAST_EXAM_MAX_PAGES)
    if _embedded_char_count(embedded) >= MIN_EMBEDDED_CHARS:
        return embedded, "embedded"

    if not has_google_vision_credentials():
        raise ValueError(
            "PDF에서 텍스트를 추출하지 못했습니다. 스캔 PDF는 Google Vision OCR이 필요합니다.\n\n"
            "`streamlit-app/service-account-key.json`을 확인해 주세요."
        )
    try:
        ocr = extract_text_google_vision(
            pdf_bytes,
            max_pages=PAST_EXAM_MAX_PAGES,
            dpi=PAST_EXAM_OCR_DPI,
        )
    except GoogleVisionAuthError as exc:
        raise ValueError(GOOGLE_VISION_AUTH_USER_MESSAGE) from exc

    text = _combine_page_texts(ocr.get("pages") or [])
    if not text.strip():
        raise ValueError(
            "Google Vision OCR을 실행했지만 읽을 수 있는 텍스트가 없습니다."
        )
    return text, "google_vision"


# ── HTML post-processing ──────────────────────────────────────────
def _extract_body(html_doc: str) -> str:
    doc = html_doc.strip()
    match = re.search(r"<body[^>]*>(.*?)</body>", doc, re.DOTALL | re.IGNORECASE)
    if match:
        return match.group(1).strip()
    doc = re.sub(r"<!DOCTYPE[^>]*>", "", doc, flags=re.I)
    doc = re.sub(r"</?html[^>]*>", "", doc, flags=re.I)
    head = re.search(r"<head[^>]*>.*?</head>", doc, re.DOTALL | re.I)
    if head:
        doc = doc.replace(head.group(0), "")
    return doc.strip()


CANVAS_IDS = ("domainChart", "diffChart", "gradeChart")


def _safe_chart_script() -> str:
    """Chart.js init — skip missing canvas (prevents JS breaking the whole page)."""
    return """
<script>
(function(){
  function C(id,cfg){var el=document.getElementById(id);if(!el)return;new Chart(el,cfg);}
  C('domainChart',{
    type:'bar',
    data:{labels:['영역1','영역2','영역3','영역4'],
      datasets:[{data:[72,58,65,48],backgroundColor:['#2563EB','#F97316','#16A34A','#9333EA'],borderRadius:4}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{x:{max:100,ticks:{callback:function(v){return v+'%';}}}}}
  });
  // diffChart — 도넛 조각 위에 퍼센트 직접 표기
  var diffData=[25,45,30];
  var diffColors=['#86EFAC','#FCD34D','#F87171'];
  var diffLabels=['하','중','상'];
  var diffPlugin={
    id:'diffLabels',
    afterDraw:function(chart){
      var ctx=chart.ctx;
      var meta=chart.getDatasetMeta(0);
      meta.data.forEach(function(arc,i){
        var mid=arc.startAngle+(arc.endAngle-arc.startAngle)/2;
        var r=(arc.outerRadius+arc.innerRadius)/2;
        var x=arc.x+Math.cos(mid)*r;
        var y=arc.y+Math.sin(mid)*r;
        ctx.save();
        ctx.fillStyle='#333';
        ctx.font='bold 11px sans-serif';
        ctx.textAlign='center';
        ctx.textBaseline='middle';
        ctx.fillText(diffData[i]+'%',x,y);
        ctx.restore();
      });
    }
  };
  C('diffChart',{
    type:'doughnut',
    data:{labels:diffLabels,datasets:[{data:diffData,
      backgroundColor:diffColors,borderWidth:2,borderColor:'#fff'}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{position:'bottom',labels:{font:{size:10},padding:6}},
        tooltip:{callbacks:{label:function(c){return c.label+' '+c.parsed+'%';}}}
      },
      layout:{padding:8}
    },
    plugins:[diffPlugin]
  });
  C('gradeChart',{
    type:'bar',
    data:{labels:['1등급','2등급','3등급','4등급','5등급'],
      datasets:[{data:[10,24,32,24,10],
      backgroundColor:['#1E3A8A','#2563EB','#60A5FA','#93C5FD','#BFDBFE'],borderRadius:4}]},
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{
        y:{max:40,ticks:{callback:function(v){return v+'%';}},grid:{color:'#F3F4F6'}},
        x:{grid:{display:false},ticks:{font:{size:10}}}
      }
    }
  });
})();
</script>"""


_DIV_OPEN = re.compile(r"<div\b", re.I)
_DIV_CLOSE = re.compile(r"</div>", re.I)


def _strip_page_wrap_markup(body: str) -> str:
    """Remove page-wrap open tags only; page blocks are rebuilt via balanced extraction."""
    body = re.sub(r'<div class="page-wrap">\s*', "", body, flags=re.I)
    return body.strip()


def _find_balanced_div_end(html: str, start: int) -> int | None:
    pos = start
    depth = 0
    while pos < len(html):
        open_m = _DIV_OPEN.search(html, pos)
        close_m = _DIV_CLOSE.search(html, pos)
        if not open_m and not close_m:
            return None
        if open_m and (not close_m or open_m.start() < close_m.start()):
            depth += 1
            pos = open_m.end()
        else:
            depth -= 1
            pos = close_m.end()
            if depth == 0:
                return pos
    return None


def _extract_page_blocks(body: str) -> list[str]:
    """Extract each `<div class="page">` … `</div>` block with balanced nesting."""
    body = _strip_page_wrap_markup(body)
    pages: list[str] = []
    for m in re.finditer(r'<div class="page">', body, re.I):
        end = _find_balanced_div_end(body, m.start())
        if end:
            pages.append(body[m.start() : end].strip())
    return pages


def _split_pages(body: str) -> list[str]:
    return _extract_page_blocks(body)


def _academy_brand_is_well_formed(body: str) -> bool:
    return bool(
        re.search(
            r'<div class="academy-brand">\s*'
            r"(?:<img class=\"academy-brand-logo\"|<div class=\"academy-brand-placeholder\">)"
            r"[\s\S]*?"
            r'<span class="academy-brand-name">[\s\S]*?</span>\s*</div>',
            body,
            re.I,
        )
    )


def _repair_academy_brand(body: str, brand_html: str) -> str:
    """Ensure PAGE 1 has a properly closed academy-brand block."""
    if _academy_brand_is_well_formed(body):
        return body

    body = re.sub(
        r'<div class="academy-brand"[^>]*>[\s\S]*?'
        r"(?=<!-- REPORT_TITLE -->|<div class=\"report-title-main\"|<div class=\"section-title\"|<div class=\"page-badge\">)",
        "",
        body,
        count=1,
        flags=re.I,
    )
    body = re.sub(
        r'<img[^>]*class="[^"]*academy-brand-logo[^"]*"[^>]*>\s*',
        "",
        body,
        count=1,
        flags=re.I,
    )
    body = re.sub(
        r'<span class="academy-brand-name"[^>]*>[\s\S]*?</span>\s*',
        "",
        body,
        count=1,
        flags=re.I,
    )
    body = re.sub(r"<!-- ACADEMY_BRAND -->\s*", "", body)

    if brand_html in body:
        return body

    updated = re.sub(
        r'(<div class="page">\s*<div class="page-badge">1/5</div>)',
        rf"\1\n{brand_html}",
        body,
        count=1,
        flags=re.I,
    )
    if updated != body:
        return updated

    return re.sub(
        r"(<div class=\"page\">)",
        rf"\1\n{brand_html}",
        body,
        count=1,
        flags=re.I,
    )


def _has_canvas(body: str, canvas_id: str) -> bool:
    return bool(re.search(rf'id=["\']{canvas_id}["\']', body))


def _fallback_page4_html() -> str:
    return """<div class="page">
  <div class="page-badge">4/5</div>
  <div class="section-title">5. 시험 분석 그래프</div>
  <div class="p4-charts">
    <div class="chart-card" style="overflow:visible;">
      <div class="chart-title">핵심 영역별 예상 정답률</div>
      <canvas id="domainChart" style="height:180px;"></canvas>
    </div>
    <div class="chart-card" style="overflow:visible;">
      <div class="chart-title">난이도별 문항 분포</div>
      <canvas id="diffChart" style="height:160px;"></canvas>
      <div style="font-size:11px;margin-top:6px;text-align:center;color:#374151;">하 25% / 중 45% / 상 30%</div>
    </div>
  </div>
  <div class="p4-bottom">
    <div>
      <div class="p4-section-label">유형별 예상 정답률</div>
      <div class="bar-row"><span class="bar-label">선택형</span><div class="bar-track">
        <div class="bar-fill" style="width:58%;background:#2563EB"><span class="bar-pct">58%</span></div>
      </div></div>
      <div class="bar-row"><span class="bar-label">서술형</span><div class="bar-track">
        <div class="bar-fill" style="width:40%;background:#7C3AED"><span class="bar-pct">40%</span></div>
      </div></div>
      <p class="bar-note">후반부·서술형 문항에서 정답률이 낮게 나타납니다.</p>
    </div>
    <div>
      <div class="p4-section-label">등급별 예상 분포</div>
      <canvas id="gradeChart" style="height:160px;width:100%;display:block;"></canvas>
    </div>
  </div>
  <div class="section-title">6. 예상 등급 분포 (고등학교 5등급제)</div>
  <table class="grade-table">
    <thead><tr><th>등급</th><th>누적 비율</th><th>예상 원점수 컷</th><th>해당 등급 특징 분석</th></tr></thead>
    <tbody>
      <tr><td><span class="grade-badge g1">1등급</span></td><td>상위 10%</td><td><span class="cut">88점 이상</span></td><td>최상위권</td></tr>
      <tr><td><span class="grade-badge g2">2등급</span></td><td>10~34%</td><td><span class="cut">74점 이상</span></td><td>상위권</td></tr>
      <tr><td><span class="grade-badge g3">3등급</span></td><td>34~66%</td><td><span class="cut">56점 이상</span></td><td>중위권</td></tr>
      <tr><td><span class="grade-badge g4">4등급</span></td><td>66~90%</td><td><span class="cut">38점 이상</span></td><td>기초 보완 필요</td></tr>
      <tr><td><span class="grade-badge g5">5등급</span></td><td>90~100%</td><td><span class="cut">38점 미만</span></td><td>기초 재학습</td></tr>
    </tbody>
  </table>
</div>"""


def _build_strat_grid(bodies: list[str] | None = None) -> str:
    defaults = [
        "<ul class=\"bullet-list\"><li>서술형·고난도 문항 집중 훈련</li></ul>",
        "<ul class=\"bullet-list\"><li>중난이도 기출 유형 반복 학습</li></ul>",
        "<ul class=\"bullet-list\"><li>교과서 예제로 기초 개념 재정립</li></ul>",
    ]
    content = (bodies or defaults)[:3]
    while len(content) < 3:
        content.append(defaults[len(content)])
    return f"""<div class="strat-grid">
    <div class="strat-header">1~2등급 [최상위·상위권]</div>
    <div class="strat-header">3~4등급 [중위권]</div>
    <div class="strat-header">5등급 [기초·하위권]</div>
    <div class="strat-body">{content[0]}</div>
    <div class="strat-body">{content[1]}</div>
    <div class="strat-body">{content[2]}</div>
  </div>"""


def _fallback_page5_html() -> str:
    return f"""<div class="page">
  <div class="page-badge">5/5</div>
  <div class="section-title">7. 등급별 맞춤 전략 (고등학교 5등급제)</div>
  {_build_strat_grid()}
  <div class="section-title">8. 단기 6주 집중 학습 플랜</div>
  <table class="plan-table">
    <thead><tr><th>주차</th><th>학습 목표</th><th>핵심 학습 내용</th><th>연결 문항</th></tr></thead>
    <tbody>
      <tr><td style="text-align:center;"><span class="week-badge">1주차</span></td>
        <td><div class="week-goal">기초 개념</div></td><td class="week-items">교과서 예제</td><td>1~5번</td></tr>
      <tr><td style="text-align:center;"><span class="week-badge">2주차</span></td>
        <td><div class="week-goal">유형 훈련</div></td><td class="week-items">기출 변형</td><td>6~12번</td></tr>
    </tbody>
  </table>
  <div class="section-title">9. 학부모님께 드리는 제언</div>
  <div class="advice-box">
    <div class="advice-title">💡 과정을 함께 점검해 주세요</div>
    <p>점수보다 취약 단원 파악과 학습 과정 점검이 중요합니다.</p>
  </div>
  <div class="summary-box">
    <div class="summary-title">📋 종합 총평</div>
    <p>기출 분석을 바탕으로 단계별 학습 계획을 실행해 주세요.</p>
  </div>
</div>"""


def _repair_strat_grid_in_page(page_html: str) -> str:
    if "strat-grid" not in page_html:
        insert = (
            '<div class="section-title">7. 등급별 맞춤 전략 (고등학교 5등급제)</div>\n'
            + _build_strat_grid()
        )
        return re.sub(
            r'(<div class="page-badge">5/5</div>)',
            rf"\1\n{insert}",
            page_html,
            count=1,
        )

    bodies = re.findall(r'<div class="strat-body">(.*?)</div>', page_html, re.DOTALL)
    headers = len(re.findall(r'class="strat-header"', page_html))
    if headers != 3 or len(bodies) != 3:
        bodies = bodies if len(bodies) == 3 else None
        return re.sub(
            r'<div class="strat-grid">.*?</div>',
            _build_strat_grid(bodies),
            page_html,
            count=1,
            flags=re.DOTALL,
        )
    return page_html


def _page4_is_incomplete(page_html: str) -> bool:
    if 'page-badge">4/5' not in page_html:
        return True
    if not all(_has_canvas(page_html, cid) for cid in CANVAS_IDS):
        return True
    if "grade-table" not in page_html:
        return True
    if "p4-bottom" not in page_html:
        return True
    # gradeChart canvas 부모에 height 없으면 렌더링 불가 → fallback 처리
    if not re.search(r'id=["\']gradeChart["\'][^>]*style=["\'][^"\']*height', page_html):
        return True
    text_only = re.sub(r"<[^>]+>", "", page_html)
    return len(text_only.strip()) < 80


def _page5_is_incomplete(page_html: str) -> bool:
    if "plan-table" not in page_html or "advice-box" not in page_html:
        return True
    headers = len(re.findall(r'class="strat-header"', page_html))
    bodies = len(re.findall(r'class="strat-body"', page_html))
    return headers != 3 or bodies != 3


def _repair_report_body(body: str) -> str:
    """Fix truncated GPT output: PAGE 4 charts, PAGE 5 strat-grid, 5 pages total."""
    body = body.strip()

    # GPT가 생성한 차트 스크립트를 먼저 추출해서 보존
    gpt_chart_script = None
    gpt_script_match = re.search(r"(<script>\s*new Chart.*?</script>)", body, flags=re.DOTALL | re.I)
    if not gpt_script_match:
        gpt_script_match = re.search(r"(<script>\s*\(function\(\).*?</script>)", body, flags=re.DOTALL | re.I)
    if gpt_script_match:
        gpt_chart_script = gpt_script_match.group(1)

    # 스크립트 제거 (나중에 다시 삽입)
    body = re.sub(r"<script>\s*new Chart.*?</script>", "", body, flags=re.DOTALL | re.I)
    body = re.sub(r"<script>\s*\(function\(\).*?</script>", "", body, flags=re.DOTALL | re.I)

    pages = _extract_page_blocks(body)
    if not pages:
        return f'<div class="page-wrap">\n{_fallback_page4_html()}\n{_fallback_page5_html()}\n</div>'

    # PAGE 4 (index 3)
    if len(pages) >= 4 and _page4_is_incomplete(pages[3]):
        pages[3] = _fallback_page4_html()
        gpt_chart_script = None  # fallback 페이지면 GPT 스크립트도 버림
    elif len(pages) == 3:
        pages.append(_fallback_page4_html())
        gpt_chart_script = None

    # PAGE 5 (index 4)
    if len(pages) >= 5:
        if _page5_is_incomplete(pages[4]):
            pages[4] = _fallback_page5_html()
        else:
            pages[4] = _repair_strat_grid_in_page(pages[4])
    else:
        while len(pages) < 4:
            pages.append(_fallback_page4_html())
        if len(pages) == 4:
            pages.append(_fallback_page5_html())

    inner = "\n".join(pages[:5])
    if all(_has_canvas(inner, cid) for cid in CANVAS_IDS):
        # GPT 스크립트가 있으면 우선 사용, 없으면 fallback
        inner += gpt_chart_script if gpt_chart_script else _safe_chart_script()

    return f'<div class="page-wrap">\n{inner}\n</div>'


def _wrap_document(body: str, *, doc_title: str) -> str:
    css = _get_report_css()
    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{html.escape(doc_title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>
{css}
</style>
</head>
<body>
{body}
</body>
</html>"""


def finalize_report_html(
    html_doc: str,
    *,
    school_name: str,
    academy_name: str,
    report_title: str,
    logo_uri: str,
) -> str:
    """Inject brand/title, repair PAGE 4/5, enforce template CSS."""
    title = (report_title or "").strip() or _default_report_title(school_name)
    body = _extract_body(html_doc)

    brand = _build_academy_brand(academy_name, logo_uri)
    title_html = _build_report_title_html(title)

    for marker, replacement in (
        (ACADEMY_BRAND_MARKER, brand),
        (REPORT_TITLE_MARKER, title_html),
        ("<!-- PAGE1_HEADER -->", brand + "\n" + title_html),
    ):
        if marker in body:
            body = body.replace(marker, replacement, 1)

    if brand not in body:
        body = re.sub(
            r'(<div class="page">\s*<div class="page-badge">1/5</div>)',
            rf"\1\n{brand}\n{title_html}",
            body,
            count=1,
        )
    elif title_html not in body:
        body = body.replace(brand, brand + "\n" + title_html, 1)

    body = re.sub(
        r'<div class="report-header">.*?</div>\s*',
        "",
        body,
        count=1,
        flags=re.DOTALL,
    )

    body = _repair_academy_brand(body, brand)
    body = _repair_report_body(body)
    return _wrap_document(body, doc_title=title)


# ── GPT ───────────────────────────────────────────────────────────
def _is_gpt_refusal(text: str) -> bool:
    low = (text or "").lower()
    return any(p in low for p in ("i'm sorry", "i am sorry", "can't assist", "cannot assist"))


def _call_gpt_analysis(
    *,
    school_name: str,
    academy_name: str,
    report_title: str,
    pdf_text: str,
) -> str:
    api_key = resolve_api_key()
    if not api_key:
        raise RuntimeError("OpenAI API key is not configured.")
    if not pdf_text.strip():
        raise ValueError("분석할 시험지 텍스트가 없습니다.")

    title = (report_title or "").strip() or _default_report_title(school_name)
    system = _build_system_prompt(school_name=school_name)
    user_msg = (
        f"학교명: {school_name}\n"
        f"학원명: {academy_name}\n"
        f"보고서 제목(앱 삽입, GPT 작성 금지): {title}\n"
        f"분석일: {date.today().isoformat()}\n\n"
        f"PAGE 1에 `{ACADEMY_BRAND_MARKER}` 와 `{REPORT_TITLE_MARKER}` 주석만 두세요.\n"
        "아래 시험지 텍스트를 분석해 5페이지 HTML 보고서를 작성하세요.\n\n"
        f"--- 시험지 텍스트 ---\n{pdf_text[:PDF_TEXT_MAX_CHARS]}"
    )

    client = _build_openai_client(api_key)
    response = client.chat.completions.create(
        model=GPT_MODEL,
        max_tokens=GPT_MAX_TOKENS,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_msg},
        ],
    )
    raw = (response.choices[0].message.content or "").strip()
    if _is_gpt_refusal(raw):
        raise ValueError("GPT가 분석 요청을 거부했습니다. PDF 텍스트 추출 상태를 확인해 주세요.")

    html_doc = _strip_fences(raw)
    finish = getattr(response.choices[0], "finish_reason", None)
    pages_n = len(_split_pages(_extract_body(html_doc)))
    if finish == "length" or pages_n < 5:
        html_doc = _continue_gpt_pages(
            client=client,
            system=system,
            partial_html=html_doc,
            school_name=school_name,
            academy_name=academy_name,
        )
    return html_doc


def _continue_gpt_pages(
    *,
    client: Any,
    system: str,
    partial_html: str,
    school_name: str,
    academy_name: str,
) -> str:
    """Request PAGE 4–5 completion when the first response was truncated."""
    tail = _extract_body(partial_html)[-6000:]
    user_msg = (
        f"학교명: {school_name}\n학원명: {academy_name}\n\n"
        "이전 HTML 보고서가 PAGE 4·5 작성 중 잘렸습니다.\n"
        "PAGE 1~3은 이미 완료되었으므로 **PAGE 4와 PAGE 5만** 작성하세요.\n"
        "출력: `<div class=\"page\">` 2개(PAGE 4 badge 4/5, PAGE 5 badge 5/5)만.\n"
        "PAGE 4: domainChart, diffChart, gradeChart canvas 3개 + grade-table 필수.\n"
        "PAGE 5: strat-grid(header 3 + body 3 = 6개) + plan-table + advice-box + summary-box.\n"
        "`</body>` 직전 script에서 3개 Chart 초기화.\n\n"
        f"--- 잘린 HTML 끝부분 ---\n{tail}"
    )
    response = client.chat.completions.create(
        model=GPT_MODEL,
        max_tokens=8192,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_msg},
        ],
    )
    extra = _strip_fences((response.choices[0].message.content or "").strip())
    base = _extract_body(partial_html)
    base = re.sub(r"<script>.*?</script>", "", base, flags=re.DOTALL | re.I)
    extra_body = _extract_body(extra) if "<body" in extra.lower() else extra
    # Keep only page 4/5 from continuation
    extra_pages = [
        p for p in _split_pages(extra_body)
        if 'page-badge">4/5' in p or 'page-badge">5/5' in p
    ]
    if not extra_pages:
        extra_pages = _split_pages(extra_body)
    merged = _split_pages(base)
    if len(merged) >= 4:
        merged = merged[:3]
    merged.extend(extra_pages[:2])
    inner = "\n".join(merged)
    return f"<!DOCTYPE html><html><body>{inner}</body></html>"


# ── Demo report ───────────────────────────────────────────────────
def _demo_chart_script() -> str:
    return _safe_chart_script()


def _mock_report_html(
    *,
    school_name: str,
    academy_name: str,
    report_title: str,
    logo_uri: str,
) -> str:
    raw_title = (report_title or "").strip() or _default_report_title(school_name)
    school = html.escape(school_name or "○○고등학교")
    today = date.today().isoformat()
    brand = _build_academy_brand(academy_name, logo_uri)
    title_html = _build_report_title_html(raw_title)

    body = f"""<div class="page-wrap">
<div class="page">
  <div class="page-badge">1/5</div>
  {brand}
  {title_html}
  <div class="section-title">1. 기본 정보</div>
  <div class="info-grid">
    <div class="info-cell"><div class="info-label">학교 및 학년</div><div class="info-value">{school}</div></div>
    <div class="info-cell"><div class="info-label">시험 종류</div><div class="info-value">기출 PDF 분석</div></div>
    <div class="info-cell" style="border-bottom:none"><div class="info-label">분석 일자</div><div class="info-value">{today}</div></div>
    <div class="info-cell" style="border-bottom:none"><div class="info-label">문항 구성</div><div class="info-value">총 25문항 (추정)</div></div>
    <div class="tag-row"><span class="tag-label">시험 범위</span><span class="tag">함수</span><span class="tag">방정식</span></div>
  </div>
  <div class="section-title">2. 전체 구성 및 출제 경향</div>
  <div class="trend-box"><div class="trend-title">📊 출제 경향 요약</div>
    <p>API 키 설정 후 실제 PDF 분석 결과가 생성됩니다. (데모 모드)</p></div>
</div>
<div class="page">
  <div class="page-badge">2/5</div>
  <div class="section-title">3. 문항별 상세 분석</div>
  <table class="q-table"><thead><tr>
    <th class="tc">번호</th><th class="tc">유형</th><th class="tc">핵심 개념</th>
    <th class="tc">문항 내용 요약</th><th class="tc">난이도</th><th class="tc">예상 정답률</th>
  </tr></thead><tbody>
    <tr><td class="tc">1</td><td class="tc"><span class="badge badge-obj">객관</span></td>
    <td class="tl">이차함수</td><td class="tl">꼭짓점·축</td>
    <td class="tc"><span class="badge badge-mid">중</span></td><td class="tc">78%</td></tr>
  </tbody></table>
</div>
<div class="page">
  <div class="page-badge">3/5</div>
  <div class="section-title">4. 핵심 문항 심층 분석</div>
  <div class="key-q"><div class="key-q-header">
    <span class="key-q-title">🔢 18번 함수 그래프</span><span class="key-q-tag tag-high">상</span>
  </div><div class="key-q-body"><div class="key-q-left"><p class="kq-text">그래프 추론형</p></div>
  <div class="key-q-right"><ol class="step-list"><li>개형 스케치</li><li>조건 검증</li></ol></div></div></div>
</div>
<div class="page">
  <div class="page-badge">4/5</div>
  <div class="section-title">5. 시험 분석 그래프</div>
  <div class="p4-charts">
    <div class="chart-card"><div class="chart-title">영역별 정답률</div>
      <canvas id="domainChart" style="height:200px;"></canvas></div>
    <div class="chart-card"><div class="chart-title">난이도 분포</div>
      <canvas id="diffChart" style="height:200px;"></canvas></div>
  </div>
  <div class="p4-bottom">
    <div><div class="p4-section-label">유형별 비중</div>
      <div class="bar-row"><span class="bar-label">객관</span><div class="bar-track">
        <div class="bar-fill" style="width:68%;background:#2563EB"><span class="bar-pct">68%</span></div>
      </div></div></div>
    <div>
      <div class="p4-section-label">등급별 예상 분포</div>
      <canvas id="gradeChart" style="height:160px;width:100%;display:block;"></canvas>
    </div>
  </div>
  <div class="section-title">6. 예상 등급 분포</div>
  <table class="grade-table"><thead><tr><th>등급</th><th>누적</th><th>컷</th><th>특징</th></tr></thead>
  <tbody><tr><td><span class="grade-badge g1">1등급</span></td><td>상위 10%</td>
  <td><span class="cut">88점+</span></td><td>최상위</td></tr></tbody></table>
</div>
<div class="page">
  <div class="page-badge">5/5</div>
  <div class="section-title">7. 등급별 맞춤 전략</div>
  <div class="strat-grid">
    <div class="strat-header">1~2등급</div><div class="strat-header">3~4등급</div><div class="strat-header">5등급</div>
    <div class="strat-body"><ul class="bullet-list"><li>고난도 집중</li></ul></div>
    <div class="strat-body"><ul class="bullet-list"><li>기출 반복</li></ul></div>
    <div class="strat-body"><ul class="bullet-list"><li>기초 재학습</li></ul></div>
  </div>
  <div class="section-title">8. 단기 6주 집중 학습 플랜</div>
  <table class="plan-table"><tr><td><span class="week-badge">1주차</span></td><td>기초 개념</td></tr></table>
  <div class="section-title">9. 학부모님께 드리는 제언</div>
  <div class="advice-box"><div class="advice-title">💡 과정 점검</div><p>점수보다 취약 단원 파악이 중요합니다.</p></div>
  <div class="summary-box"><div class="summary-title">📋 종합 총평</div><p>데모 모드입니다.</p></div>
</div>
</div>"""
    body += _demo_chart_script()
    return finalize_report_html(
        body,
        school_name=school_name,
        academy_name=academy_name,
        report_title=raw_title,
        logo_uri=logo_uri,
    )


def generate_past_exam_report_html(
    *,
    school_name: str,
    academy_name: str,
    report_title: str,
    logo_uri: str,
    pdf_text: str,
) -> str:
    title = (report_title or "").strip() or _default_report_title(school_name)
    if not resolve_api_key():
        return _mock_report_html(
            school_name=school_name,
            academy_name=academy_name,
            report_title=title,
            logo_uri=logo_uri,
        )
    html_doc = _call_gpt_analysis(
        school_name=school_name,
        academy_name=academy_name,
        report_title=title,
        pdf_text=pdf_text,
    )
    return finalize_report_html(
        html_doc,
        school_name=school_name,
        academy_name=academy_name,
        report_title=title,
        logo_uri=logo_uri,
    )


def _sanitize_filename(text: str, *, max_len: int = 40) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\n\r\t]', "", (text or "").strip())
    return re.sub(r"\s+", "_", cleaned)[:max_len] or "기출분석"


# ── Streamlit UI ──────────────────────────────────────────────────
def render_past_exam_analyzer_page() -> None:
    """기출 PDF → 5페이지 HTML 분석 보고서."""
    os.makedirs(DATA_DIR, exist_ok=True)

    st.markdown("### 기출문제 분석")
    st.caption(
        "학교 기출 PDF를 업로드하면 텍스트(OCR 포함)를 분석해 "
        f"템플릿 기반 5페이지 HTML 보고서를 생성합니다. (모델: {GPT_MODEL})"
    )

    if not has_openai_api_key():
        st.info("API 키가 없으면 **데모 보고서**가 생성됩니다.")

    if not os.path.isfile(TEMPLATE_PATH):
        st.error(f"템플릿 파일 없음: `{TEMPLATE_PATH}`")
        return

    # 1. 학교명
    school_name = st.text_input(
        "학교명",
        placeholder="예: 장충고등학교 고2",
        key="pastexam_school_name",
    )

    # 2. 학원명
    academy_name = st.text_input(
        "학원명",
        value=DEFAULT_ACADEMY_NAME,
        placeholder="예: 압구정 페르마 수학",
        key="pastexam_academy_name",
    )

    # 3. 보고서 제목
    report_title = st.text_input(
        "보고서 제목",
        placeholder="예: 2026학년도 장충고 고2 1학기 중간고사 기출문제 분석보고서",
        key="pastexam_report_title",
    )

    # 4. 학원 로고 (expander)
    with st.expander("학원 로고", expanded=False):
        st.caption(f"PNG/JPG → `{LOGO_PATH}` 저장 · 이후 보고서에 자동 적용")
        if os.path.isfile(LOGO_PATH):
            st.image(LOGO_PATH, width=96)
        logo_file = st.file_uploader(
            "로고 업로드",
            type=["png", "jpg", "jpeg"],
            key="pastexam_logo_upload",
        )
        if logo_file is not None:
            _save_logo(logo_file)
            st.success("로고가 저장되었습니다.")
            st.rerun()

    # 5. PDF 업로드
    pdf_file = st.file_uploader(
        "기출 PDF 업로드",
        type=["pdf"],
        key="pastexam_pdf_upload",
    )

    if st.button(
        "📊 분석 보고서 생성",
        type="primary",
        disabled=pdf_file is None,
        key="pastexam_generate_btn",
    ):
        if not school_name.strip():
            st.warning("학교명을 입력해 주세요.")
        else:
            try:
                with st.spinner("PDF 텍스트 추출 중… (스캔 PDF → OCR 자동)"):
                    pdf_text, method = extract_pdf_text(pdf_file.getvalue())
            except ValueError as exc:
                st.error(str(exc))
            else:
                if method == "google_vision":
                    st.info("스캔 PDF → **Google Vision OCR**으로 텍스트를 추출했습니다.")
                logo_uri = _logo_data_uri()
                try:
                    with st.spinner(f"GPT 분석 중… ({GPT_MODEL})"):
                        html_report = generate_past_exam_report_html(
                            school_name=school_name.strip(),
                            academy_name=(academy_name or DEFAULT_ACADEMY_NAME).strip(),
                            report_title=report_title.strip(),
                            logo_uri=logo_uri,
                            pdf_text=pdf_text,
                        )
                except Exception as exc:
                    msg = str(exc)
                    if "401" in msg or "authentication" in msg.lower():
                        st.error(OPENAI_AUTH_USER_MESSAGE)
                    else:
                        st.error(f"보고서 생성 실패: {exc}")
                else:
                    st.session_state["pastexam_report_html"] = html_report
                    st.session_state["pastexam_report_fname"] = (
                        f"기출분석_{_sanitize_filename(school_name)}_"
                        f"{date.today().isoformat()}.html"
                    )
                    st.success("5페이지 HTML 분석 보고서가 생성되었습니다.")

    html_report = st.session_state.get("pastexam_report_html")
    if html_report:
        st.divider()
        st.markdown("##### 보고서 미리보기")
        components.html(html_report, height=900, scrolling=True)
        st.download_button(
            "⬇️ HTML 다운로드",
            data=html_report.encode("utf-8"),
            file_name=st.session_state.get("pastexam_report_fname", "past_exam_report.html"),
            mime="text/html",
            key="pastexam_download_btn",
        )
