from __future__ import annotations

"""OCR / text extraction for exam sheets (Google Vision → GPT-4o LaTeX refinement)."""

import base64
import json
import os
import re
from pathlib import Path
from typing import Any, Literal

import fitz
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from dotenv import load_dotenv
from google.api_core.exceptions import GoogleAPIError, PermissionDenied, Unauthenticated
from google.cloud import vision
from google.oauth2 import service_account

# Google Vision service account key — import 직후 최우선 정의 (forward slashes only)
GOOGLE_VISION_KEY_PATH = (
    "G:/app 개발/Academy-Manager/Academy-Manager/streamlit-app/service-account-key.json"
)

# ── Paths & env ───────────────────────────────────────────────────
_MODULE_DIR = Path(Path(__file__).resolve().as_posix())
load_dotenv(_MODULE_DIR / ".env")
load_dotenv(_MODULE_DIR.parent / ".env")

_REMOVED_GOOGLE_APPLICATION_CREDENTIALS = os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)
if _REMOVED_GOOGLE_APPLICATION_CREDENTIALS:
    print(
        "[ocr_extract] GOOGLE_APPLICATION_CREDENTIALS removed:",
        _REMOVED_GOOGLE_APPLICATION_CREDENTIALS.replace("\\", "/"),
    )

_vision_client: vision.ImageAnnotatorClient | None = None
_vision_auth_debug_printed = False


def _init_google_vision_client() -> vision.ImageAnnotatorClient:
    """Load credentials from GOOGLE_VISION_KEY_PATH and create Vision client."""
    global _vision_client, _vision_auth_debug_printed
    if _vision_client is not None:
        return _vision_client

    os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)
    key_path = GOOGLE_VISION_KEY_PATH

    if not _vision_auth_debug_printed:
        print(f"현재 작업 디렉토리: {os.getcwd()}")
        print(f"체크하려는 키 파일 경로: {key_path}")
        print(f"파일 존재 여부 확인: {os.path.exists(key_path)}")
        _vision_auth_debug_printed = True

    if not os.path.exists(key_path):
        st.error(f"파일을 찾을 수 없습니다: {key_path}")
        st.stop()

    try:
        credentials = service_account.Credentials.from_service_account_file(key_path)
        _vision_client = vision.ImageAnnotatorClient(credentials=credentials)
        print("인증 성공!")
    except Exception as exc:
        print(f"파일은 있지만 인증 실패: {exc}")
        st.error(f"인증 실패: {exc}")
        st.stop()

    return _vision_client


def _get_vision_client() -> vision.ImageAnnotatorClient:
    return _init_google_vision_client()


def has_google_vision_credentials() -> bool:
    return os.path.exists(GOOGLE_VISION_KEY_PATH)


ENV_OPENAI_KEY = "OPENAI_API_KEY"
ENV_LEGACY_OPENAI_KEY = "AI_INTEGRATIONS_OPENAI_API_KEY"
ENV_OPENAI_BASE_URL = "OPENAI_BASE_URL"
ENV_LEGACY_BASE_URL = "AI_INTEGRATIONS_OPENAI_BASE_URL"

GOOGLE_VISION_AUTH_USER_MESSAGE = (
    "Google Vision API 인증에 실패했습니다. "
    "streamlit-app/service-account-key.json 파일을 확인해주세요."
)
OPENAI_AUTH_USER_MESSAGE = "OpenAI API 인증에 실패했습니다. API 키를 확인해주세요."
GOOGLE_VISION_REQUEST_TIMEOUT = 60
GPT_REFINE_MODEL = "gpt-4o"
GPT_REFINE_MAX_TOKENS = 4096


class GoogleVisionAuthError(RuntimeError):
    """Raised when Google Vision credentials are missing or rejected."""


class OpenAIAuthError(RuntimeError):
    """Raised when OpenAI credentials are missing or rejected."""

DEFAULT_MAX_PAGES = 6
DEFAULT_DPI = 150
MIN_EMBEDDED_CHARS = 30

WARN_PDF_SCAN = (
    "PDF에서 추출할 수 있는 텍스트가 없습니다. 스캔본으로 보입니다. "
    "GPT Vision OCR을 사용하면 손글씨·인쇄 내용을 읽을 수 있습니다."
)
WARN_IMAGE = (
    "이미지 파일은 내장 텍스트가 없습니다. "
    "GPT Vision OCR을 실행해야 텍스트를 추출할 수 있습니다."
)
WARN_NO_API_KEY = (
    "OpenAI API 키가 필요합니다. "
    "streamlit-app/.env 파일에 OPENAI_API_KEY=sk-... 를 설정해 주세요. "
    "(.env.example 참고)"
)
WARN_NO_GOOGLE_VISION = (
    "Google Vision API 인증 파일이 필요합니다. "
    "streamlit-app/service-account-key.json (ocr_extract.py 옆)을 확인해 주세요."
)

LATEX_REFINE_SYSTEM_PROMPT = """당신은 수학 시험지 OCR 후처리 전문가입니다.

입력은 Google Vision OCR로 추출된 원문 텍스트입니다. 수식·기호가 깨져 있을 수 있습니다.
다음 규칙으로 **수학 문제 형식에 맞는 깔끔한 LaTeX 문법**으로 정리하세요.

규칙:
- 문항 번호(1., 2) 등), 한글 지문, 선택지 번호는 원문 구조를 유지하세요.
- 수식·분수·지수·근호·부등식은 LaTeX로 표기하세요.
  - 한 줄 인라인 수식: $...$
  - 여러 줄·큰 수식: $$...$$
- OCR 오타만 최소한으로 교정하고, 보이지 않는 내용을 새로 만들지 마세요.
- 채점·해설·추가 설명은 하지 마세요.
- 정리된 텍스트만 반환하세요 (마크다운 코드 펜스 금지)."""

# DEFAULT_QUESTION_TOPIC_MAP: 하드코딩 단원 제거
# GPT가 시험지 텍스트를 직접 분석해서 단원을 결정합니다.
# 하드코딩된 중학교 단원이 고등학교 시험지에 잘못 적용되는 문제를 방지합니다.
DEFAULT_QUESTION_TOPIC_MAP: dict[int, str] = {}

# MATH_TOPIC_KEYWORDS: 키워드 기반 단원 추정 제거
# 중학교 키워드가 고등학교 시험지에 잘못 매칭되는 문제를 방지합니다.
# 단원 분류는 전적으로 GPT가 시험지 텍스트를 보고 판단합니다.
MATH_TOPIC_KEYWORDS: list[tuple[str, list[str]]] = []

VISION_OCR_PROMPT = """당신은 수학 시험지에서 텍스트를 추출하는 OCR 전문가입니다.

업로드된 시험지 이미지(들)에서 보이는 모든 텍스트를 빠짐없이 옮겨 적으세요.
- 인쇄된 문제 지문, 선택지, 번호
- 학생이 손으로 쓴 풀이, 답, 표시(O/X 등)
- 수식은 가능한 한 원문에 가깝게 표기 (LaTeX 불필요, 읽기 쉬운 문자열로)

추측하거나 채점하지 마세요. 보이는 내용만 추출하세요.

아래 JSON 형식으로만 반환하세요 (순수 JSON, 마크다운 펜스 금지):

{
  "pages": [
    {"page": 1, "text": "해당 페이지에서 읽은 전체 텍스트"}
  ]
}

규칙:
- 이미지 순서대로 page 번호를 1부터 부여하세요.
- 해당 페이지에 읽을 수 있는 글자가 없으면 "text"는 빈 문자열 "".
- 순수 JSON만 반환하세요."""

PageMethod = Literal["embedded", "vision", "none"]
ExtractionStatus = Literal["ok", "needs_vision", "empty"]


def pdf_to_images(
    pdf_bytes: bytes,
    dpi: int = DEFAULT_DPI,
    max_pages: int = DEFAULT_MAX_PAGES,
) -> list[tuple[bytes, str]]:
    """Render each PDF page to PNG. Returns (png_bytes, 'image/png') tuples."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages: list[tuple[bytes, str]] = []
    try:
        for i in range(min(len(doc), max_pages)):
            mat = fitz.Matrix(dpi / 72, dpi / 72)
            pix = doc[i].get_pixmap(matrix=mat, alpha=False)
            pages.append((pix.tobytes("png"), "image/png"))
    finally:
        doc.close()
    return pages


def pdf_extract_text(pdf_bytes: bytes, max_pages: int = DEFAULT_MAX_PAGES) -> str:
    """Extract embedded PDF text (typed/printed PDFs). Empty for pure scans."""
    return _combine_pages(pdf_extract_pages(pdf_bytes, max_pages=max_pages))


def pdf_extract_pages(
    pdf_bytes: bytes,
    max_pages: int = DEFAULT_MAX_PAGES,
) -> list[dict[str, Any]]:
    """Per-page embedded text from PDF text layer."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    records: list[dict[str, Any]] = []
    try:
        for i in range(min(len(doc), max_pages)):
            page_text = doc[i].get_text("text").strip()
            records.append({
                "page": i + 1,
                "text": page_text,
                "method": "embedded",
            })
    finally:
        doc.close()
    return records


def _strip_fences(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
    if raw.endswith("```"):
        raw = raw.rsplit("```", 1)[0]
    return raw.strip()


def _build_openai_client(api_key: str):
    import openai as _openai

    base_url = (
        os.environ.get(ENV_OPENAI_BASE_URL, "")
        or os.environ.get(ENV_LEGACY_BASE_URL, "")
    )
    kwargs: dict = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    return _openai.OpenAI(**kwargs)


def resolve_api_key(user_api_key: str = "") -> str:
    """Resolve API key: optional session override → OPENAI_API_KEY → legacy env."""
    return (
        user_api_key.strip()
        or os.environ.get(ENV_OPENAI_KEY, "")
        or os.environ.get(ENV_LEGACY_OPENAI_KEY, "")
    )


def has_openai_api_key(user_api_key: str = "") -> bool:
    return bool(resolve_api_key(user_api_key))


def _mime_from_filename(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
    }.get(ext, "image/jpeg")


def _is_pdf(file_bytes: bytes, filename: str = "") -> bool:
    if filename.lower().endswith(".pdf"):
        return True
    return file_bytes[:5] == b"%PDF-"


def _embedded_char_count(pages: list[dict[str, Any]]) -> int:
    return sum(len(re.sub(r"\s+ ", "", p.get("text", ""))) for p in pages)


def _has_meaningful_question_content(pages: list[dict[str, Any]]) -> bool:
    """embedded 텍스트에 실제 문제 지문이 있는지 판단.

    매쓰플랫 등 일부 PDF는 글자수는 충분하지만
    목차/단원명/번호만 있고 실제 문제 내용이 없는 경우가 있음.
    문항당 평균 글자수가 50자 미만이면 OCR이 필요한 PDF로 판단.
    """
    combined = " ".join(p.get("text", "") for p in pages)
    question_count = len(re.findall(
        r"(?m)^\s*0?([1-9]|1[0-9]|20)\s*[\.\)\.\u3002\u3001]?\s*$", combined
    ))
    if question_count == 0:
        return True  # 문항 번호 못 찾으면 일반 PDF로 간주
    total_chars = len(re.sub(r"\s+", "", combined))
    avg_chars_per_question = total_chars / question_count
    return avg_chars_per_question >= 50

def _combine_pages(pages: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for p in sorted(pages, key=lambda x: x["page"]):
        text = p.get("text", "").strip()
        if text:
            parts.append(f"[페이지 {p['page']}]\n{text}")
    return "\n\n".join(parts)


def _methods_used(pages: list[dict[str, Any]]) -> list[str]:
    return sorted({p.get("method") for p in pages if p.get("method")})


def _result(
    *,
    source: Literal["pdf", "image"],
    pages: list[dict[str, Any]],
    status: ExtractionStatus,
    needs_vision: bool,
    warning: str | None = None,
) -> dict[str, Any]:
    raw = _combine_pages(pages)
    if status == "ok" and not raw.strip():
        status = "empty"
    return {
        "source": source,
        "pages": pages,
        "raw_combined": raw,
        "methods_used": _methods_used(pages),
        "status": status,
        "needs_vision": needs_vision,
        "warning": warning,
    }


def vision_extract_pages(
    page_images: list[tuple[bytes, str]],
    user_api_key: str = "",
    *,
    model: str = "gpt-4o",
    max_tokens: int = 4096,
) -> list[dict[str, Any]]:
    """OCR page images via GPT Vision."""
    api_key = resolve_api_key(user_api_key)
    if not api_key:
        raise RuntimeError(WARN_NO_API_KEY)
    if not page_images:
        return []

    client = _build_openai_client(api_key)
    content: list[dict] = [{"type": "text", "text": VISION_OCR_PROMPT}]
    for img_bytes, mime in page_images:
        b64 = base64.b64encode(img_bytes).decode()
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:{mime};base64,{b64}"},
        })

    response = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": content}],
    )

    choices = getattr(response, "choices", None)
    if not choices:
        raise RuntimeError("OpenAI 응답에 choices 필드가 없습니다. 잠시 후 다시 시도해 주세요.")

    raw = choices[0].message.content or "{}"
    parsed = json.loads(_strip_fences(raw))
    vision_pages = parsed.get("pages") or []

    result: list[dict[str, Any]] = []
    for idx, item in enumerate(vision_pages):
        page_no = item.get("page", idx + 1)
        try:
            page_no = int(page_no)
        except (TypeError, ValueError):
            page_no = idx + 1
        result.append({
            "page": page_no,
            "text": str(item.get("text", "")).strip(),
            "method": "vision",
        })

    if len(result) < len(page_images):
        existing = {r["page"] for r in result}
        for i in range(len(page_images)):
            page_no = i + 1
            if page_no not in existing:
                result.append({"page": page_no, "text": "", "method": "vision"})
        result.sort(key=lambda r: r["page"])

    return result[: len(page_images)]


def _google_vision_ocr_image(img_bytes: bytes) -> str:
    """Run Google Cloud Vision ``text_detection`` on a single image."""
    client = _get_vision_client()
    image = vision.Image(content=img_bytes)

    try:
        response = client.text_detection(
            image=image,
            timeout=GOOGLE_VISION_REQUEST_TIMEOUT,
        )
    except (Unauthenticated, PermissionDenied) as exc:
        detail = str(exc)
        if "billing" in detail.lower() or "BILLING_DISABLED" in detail:
            raise GoogleVisionAuthError(
                "Google Cloud **결제(Billing)가 활성화되지 않았습니다.** "
                "Vision API를 사용하려면 Google Cloud Console에서 결제 계정을 연결해야 합니다. "
                f"(프로젝트: math-ocr-app-497906) "
                f"https://console.cloud.google.com/billing"
            ) from exc
        raise GoogleVisionAuthError(
            f"Google Vision API 권한 오류: {detail[:500]}"
        ) from exc
    except GoogleAPIError as exc:
        msg = str(exc).lower()
        if any(token in msg for token in ("permission", "auth", "credential", "401", "403")):
            raise GoogleVisionAuthError(GOOGLE_VISION_AUTH_USER_MESSAGE) from exc
        raise RuntimeError(f"Google Vision OCR 오류: {exc}") from exc

    if response.error.message:
        err = response.error.message
        lowered = err.lower()
        if any(token in lowered for token in ("permission", "auth", "credential", "denied")):
            raise GoogleVisionAuthError(GOOGLE_VISION_AUTH_USER_MESSAGE)
        raise RuntimeError(f"Google Vision OCR 오류: {err}")

    annotations = response.text_annotations
    if annotations:
        return (annotations[0].description or "").strip()
    return ""


def extract_text_google_vision(
    file_bytes: bytes,
    *,
    filename: str = "",
    max_pages: int = DEFAULT_MAX_PAGES,
    dpi: int = DEFAULT_DPI,
) -> dict[str, Any]:
    """Extract raw exam text via Google Cloud Vision (images + PDF page renders)."""
    if not has_google_vision_credentials():
        raise GoogleVisionAuthError(WARN_NO_GOOGLE_VISION)

    if _is_pdf(file_bytes, filename):
        rendered = pdf_to_images(file_bytes, dpi=dpi, max_pages=max_pages)
        pages: list[dict[str, Any]] = []
        for idx, (img_bytes, _mime) in enumerate(rendered):
            try:
                text = _google_vision_ocr_image(img_bytes)
            except GoogleVisionAuthError:
                raise
            pages.append({"page": idx + 1, "text": text, "method": "google_vision"})
        status: ExtractionStatus = "ok" if any(p["text"].strip() for p in pages) else "empty"
        return {
            "source": "pdf",
            "pages": pages,
            "status": status,
            "warning": None if status == "ok" else "Google Vision에서 읽을 수 있는 텍스트가 없습니다.",
        }

    text = _google_vision_ocr_image(file_bytes)
    pages = [{"page": 1, "text": text, "method": "google_vision"}]
    status = "ok" if text else "empty"
    return {
        "source": "image",
        "pages": pages,
        "status": status,
        "warning": None if text else "Google Vision에서 읽을 수 있는 텍스트가 없습니다.",
    }


def _is_openai_auth_error(exc: Exception) -> bool:
    name = type(exc).__name__.lower()
    if "auth" in name:
        return True
    msg = str(exc).lower()
    return any(
        token in msg
        for token in ("401", "403", "invalid api key", "incorrect api key", "authentication")
    )


def refine_ocr_text_with_gpt(
    raw_text: str,
    *,
    user_api_key: str = "",
    model: str = GPT_REFINE_MODEL,
) -> str:
    """Post-process OCR text into clean LaTeX math formatting via GPT-4o."""
    text = (raw_text or "").strip()
    if not text:
        return raw_text or ""

    api_key = resolve_api_key(user_api_key)
    if not api_key:
        raise OpenAIAuthError(WARN_NO_API_KEY)

    client = _build_openai_client(api_key)
    try:
        response = client.chat.completions.create(
            model=model,
            max_tokens=GPT_REFINE_MAX_TOKENS,
            temperature=0.1,
            messages=[
                {"role": "system", "content": LATEX_REFINE_SYSTEM_PROMPT},
                {"role": "user", "content": text},
            ],
        )
    except Exception as exc:
        if _is_openai_auth_error(exc):
            raise OpenAIAuthError(OPENAI_AUTH_USER_MESSAGE) from exc
        raise RuntimeError(f"GPT-4o 수식 정제 오류: {exc}") from exc

    choices = getattr(response, "choices", None)
    if not choices:
        raise RuntimeError("OpenAI 응답에 choices 필드가 없습니다. 잠시 후 다시 시도해 주세요.")

    refined = (choices[0].message.content or "").strip()
    return _strip_fences(refined) if refined else text


def refine_ocr_pages_with_gpt(
    pages: list[dict[str, Any]],
    *,
    user_api_key: str = "",
    model: str = GPT_REFINE_MODEL,
) -> list[dict[str, Any]]:
    """Refine each OCR page with GPT-4o LaTeX post-processing."""
    refined: list[dict[str, Any]] = []
    for page in pages:
        raw = str(page.get("text") or "")
        cleaned = refine_ocr_text_with_gpt(raw, user_api_key=user_api_key, model=model)
        refined.append({
            "page": page.get("page", len(refined) + 1),
            "text": cleaned,
            "raw_text": raw,
            "method": "google_vision+gpt4o",
        })
    return refined


def assemble_exam_extraction(
    raw: dict[str, Any],
    refined_pages: list[dict[str, Any]],
) -> dict[str, Any]:
    status: ExtractionStatus = raw.get("status", "ok")
    if status == "ok" and not any(p.get("text", "").strip() for p in refined_pages):
        status = "empty"
    result = _result(
        source=raw["source"],
        pages=refined_pages,
        status=status,
        needs_vision=False,
        warning=raw.get("warning"),
    )
    result["raw_pages"] = raw.get("pages", [])
    return result


def extract_text_ocr(
    file_bytes: bytes,
    *,
    filename: str = "",
    user_api_key: str = "",
    max_pages: int = DEFAULT_MAX_PAGES,
    dpi: int = DEFAULT_DPI,
    min_embedded_chars: int = MIN_EMBEDDED_CHARS,
    use_vision: bool = False,
) -> dict[str, Any]:
    """Extract text via PyMuPDF (+ optional GPT Vision). Current production OCR."""
    if _is_pdf(file_bytes, filename):
        return _extract_from_pdf(
            file_bytes,
            user_api_key=user_api_key,
            max_pages=max_pages,
            dpi=dpi,
            min_embedded_chars=min_embedded_chars,
            use_vision=use_vision,
        )
    return _extract_from_image(
        file_bytes,
        filename=filename,
        user_api_key=user_api_key,
        use_vision=use_vision,
    )


def run_ocr_latex_pipeline(
    file_bytes: bytes,
    *,
    filename: str = "",
    user_api_key: str = "",
    max_pages: int = DEFAULT_MAX_PAGES,
    dpi: int = DEFAULT_DPI,
) -> dict[str, Any]:
    """Google Vision OCR → GPT-4o LaTeX refinement pipeline.

    1. ``service-account-key.json`` → ``ImageAnnotatorClient(credentials=...)``
    2. 이미지/PDF 페이지에서 텍스트 추출
    3. GPT-4o로 수학 수식을 LaTeX 형식으로 정제
    """
    if not has_google_vision_credentials():
        raise GoogleVisionAuthError(WARN_NO_GOOGLE_VISION)
    if not resolve_api_key(user_api_key):
        raise OpenAIAuthError(WARN_NO_API_KEY)

    raw = extract_text_google_vision(
        file_bytes,
        filename=filename,
        max_pages=max_pages,
        dpi=dpi,
    )
    refined_pages = refine_ocr_pages_with_gpt(
        raw["pages"],
        user_api_key=user_api_key,
    )
    return assemble_exam_extraction(raw, refined_pages)


def extract_exam_text(
    file_bytes: bytes,
    *,
    filename: str = "",
    user_api_key: str = "",
    max_pages: int = DEFAULT_MAX_PAGES,
    dpi: int = DEFAULT_DPI,
    min_embedded_chars: int = MIN_EMBEDDED_CHARS,
    use_vision: bool = False,
) -> dict[str, Any]:
    """Extract exam text: Google Vision OCR → GPT-4o LaTeX refinement."""
    del min_embedded_chars, use_vision
    return run_ocr_latex_pipeline(
        file_bytes,
        filename=filename,
        user_api_key=user_api_key,
        max_pages=max_pages,
        dpi=dpi,
    )


def _extract_from_image(
    file_bytes: bytes,
    *,
    filename: str,
    user_api_key: str,
    use_vision: bool,
) -> dict[str, Any]:
    mime = _mime_from_filename(filename)
    placeholder = [{"page": 1, "text": "", "method": "none"}]

    if not use_vision:
        warning = WARN_IMAGE
        if not resolve_api_key(user_api_key):
            warning = f"{WARN_IMAGE}\n\n{WARN_NO_API_KEY}"
        return _result(
            source="image",
            pages=placeholder,
            status="needs_vision",
            needs_vision=True,
            warning=warning,
        )

    vision_pages = vision_extract_pages([(file_bytes, mime)], user_api_key=user_api_key)
    if not vision_pages:
        vision_pages = [{"page": 1, "text": "", "method": "vision"}]
    return _result(
        source="image",
        pages=vision_pages,
        status="ok",
        needs_vision=False,
    )


def _extract_from_pdf(
    pdf_bytes: bytes,
    *,
    user_api_key: str,
    max_pages: int,
    dpi: int,
    min_embedded_chars: int,
    use_vision: bool,
) -> dict[str, Any]:
    embedded_pages = pdf_extract_pages(pdf_bytes, max_pages=max_pages)
    total_chars = _embedded_char_count(embedded_pages)

    # ── Step 1: enough embedded text on all pages ─────────────────
    # 글자수가 충분하더라도 실제 문제 내용이 없는 PDF(매쓰플랫 등)는 OCR 실행
    if total_chars >= min_embedded_chars and _has_meaningful_question_content(embedded_pages):
        empty_indices = [i for i, p in enumerate(embedded_pages) if not p["text"].strip()]
        if not empty_indices:
            return _result(
                source="pdf",
                pages=embedded_pages,
                status="ok",
                needs_vision=False,
            )

        if not use_vision:
            warning = (
                f"일부 페이지({len(empty_indices)}쪽)에서 텍스트를 읽지 못했습니다. "
                "해당 페이지는 스캔 이미지일 수 있습니다. GPT Vision OCR을 사용하세요."
            )
            return _result(
                source="pdf",
                pages=embedded_pages,
                status="needs_vision",
                needs_vision=True,
                warning=warning,
            )

        return _merge_pdf_hybrid(
            pdf_bytes, embedded_pages, empty_indices,
            user_api_key=user_api_key, max_pages=max_pages, dpi=dpi,
        )

    # ── Step 2: scan / no text layer ──────────────────────────────
    if not use_vision:
        warning = WARN_PDF_SCAN
        if not resolve_api_key(user_api_key):
            warning = f"{WARN_PDF_SCAN}\n\n{WARN_NO_API_KEY}"
        return _result(
            source="pdf",
            pages=embedded_pages,
            status="needs_vision",
            needs_vision=True,
            warning=warning,
        )

    rendered = pdf_to_images(pdf_bytes, dpi=dpi, max_pages=max_pages)
    vision_pages = vision_extract_pages(rendered, user_api_key=user_api_key)
    return _result(
        source="pdf",
        pages=vision_pages,
        status="ok",
        needs_vision=False,
    )


def _merge_pdf_hybrid(
    pdf_bytes: bytes,
    embedded_pages: list[dict[str, Any]],
    empty_indices: list[int],
    *,
    user_api_key: str,
    max_pages: int,
    dpi: int,
) -> dict[str, Any]:
    rendered = pdf_to_images(pdf_bytes, dpi=dpi, max_pages=max_pages)
    need_vision = [rendered[i] for i in empty_indices if i < len(rendered)]
    if not need_vision:
        return _result(
            source="pdf",
            pages=embedded_pages,
            status="ok",
            needs_vision=False,
        )

    vision_result = vision_extract_pages(need_vision, user_api_key=user_api_key)
    vision_by_page = {
        embedded_pages[empty_indices[j]]["page"]: vision_result[j]
        for j in range(min(len(vision_result), len(empty_indices)))
    }
    merged: list[dict[str, Any]] = []
    for p in embedded_pages:
        if not p["text"].strip() and p["page"] in vision_by_page:
            vr = vision_by_page[p["page"]]
            merged.append({
                "page": p["page"],
                "text": vr.get("text", ""),
                "method": "vision",
            })
        else:
            merged.append(p)

    return _result(
        source="pdf",
        pages=merged,
        status="ok",
        needs_vision=False,
    )


# ── Question parsing (1–20) ─────────────────────────────────────

# Line-start: "1."/ "1)"/ "1．"/ "문1."(numbers 1–20)
_QUESTION_HEADER_RE = re.compile(
    r"(?m)^\s*(?:문\s*)?0?([1-9]|1[0-9]|20)\s*[\.\)．、]\s*",
)
# Inline breaks: "\n2. "style
_QUESTION_INLINE_RE = re.compile(
    r"(?<=\n)\s*(?:문\s*)?0?([1-9]|1[0-9]|20)\s*[\.\)．、]\s*",
)
# 매쓰플랫 등: "01", "02" 처럼 구분자 없이 줄 시작에 오는 두자리 번호
_ZEROPAD_HEADER_RE = re.compile(
    r"(?m)^\s*0([1-9])\s*$",
)
# 서술형/서답형/논술형/주관식 N번 패턴 (예: "서술형 1번", "서답형1", "[논술형] 2")
_SUBJECTIVE_HEADER_RE = re.compile(
    r"(?m)^\s*(?:\[?\s*(?:서술형|서답형|논술형|주관식|단답형|서술)\s*\]?\s*)([1-9]|1[0-9]|20)?\s*번?\s*",
)
_PAGE_MARKER_RE = re.compile(r"\[페이지\s+\d+\]\s*\n?", re.IGNORECASE)


def _collect_question_matches(text: str) -> list[re.Match[str]]:
    """Gather question-number headers from OCR text.
    서술형/서답형/논술형/주관식 패턴도 함께 인식합니다.
    매쓰플랫 등 01~09 형태(앞에 0이 붙는 두자리)도 인식합니다.
    """
    seen: set[int] = set()
    found: list[re.Match[str]] = []
    for pattern in (_QUESTION_HEADER_RE, _QUESTION_INLINE_RE, _ZEROPAD_HEADER_RE, _SUBJECTIVE_HEADER_RE):
        for match in pattern.finditer(text):
            if match.start() in seen:
                continue
            seen.add(match.start())
            found.append(match)
    found.sort(key=lambda m: m.start())
    return found


def parse_questions_from_text(
    text: str,
    *,
    max_question: int = 20,
) -> dict[str, Any]:
    """Split OCR text into numbered questions (1..max_question).

    Detects line-start patterns like ``1.`` or ``2)``.

    Returns:
        {
            "questions": [{"number", "text", "found", "line_count"}, ...],
            "by_number": {1: "...", ...},
            "slots": [{"number", "text", "found"}, ...],  # 1..max_question
            "detected_count": int,
            "unparsed_prefix": str,
            "raw_text": str,
        }
    """
    raw_text = (text or "").strip()
    empty_slots = [
        {"number": n, "text": "", "found": False, "line_count": 0}
        for n in range(1, max_question + 1)
    ]
    if not raw_text:
        return {
            "questions": [],
            "by_number": {},
            "slots": empty_slots,
            "detected_count": 0,
            "unparsed_prefix": "",
            "raw_text": "",
        }

    cleaned = _PAGE_MARKER_RE.sub("", raw_text).strip()
    matches = _collect_question_matches(cleaned)

    by_number: dict[int, str] = {}
    question_types: dict[int, str] = {}
    unparsed_prefix = cleaned[: matches[0].start()].strip() if matches else cleaned

    if not matches:
        return {
            "questions": [],
            "by_number": {},
            "slots": empty_slots,
            "detected_count": 0,
            "unparsed_prefix": unparsed_prefix,
            "raw_text": raw_text,
        }

    for i, m in enumerate(matches):
        grp = m.group(1)
        if grp is None:
            continue  # 번호 없는 서술형 헤더 → 건너뜀
        num = int(grp)
        if num < 1 or num > max_question:
            continue

        # 서술형 패턴 여부 확인
        matched_text = m.group(0)
        is_subjective = bool(re.search(r"서술형|서답형|논술형|주관식|단답형", matched_text))

        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(cleaned)
        body = cleaned[start:end].strip()
        if body:
            by_number[num] = body
            question_types[num] = "서술형" if is_subjective else "객관식"

    questions: list[dict[str, Any]] = []
    for num in sorted(by_number):
        body = by_number[num]
        questions.append({
            "number": num,
            "text": body,
            "found": True,
            "line_count": len(body.splitlines()),
            "question_type": question_types.get(num, "객관식"),
        })

    slots: list[dict[str, Any]] = []
    for n in range(1, max_question + 1):
        body = by_number.get(n, "")
        slots.append({
            "number": n,
            "text": body,
            "found": bool(body.strip()),
            "line_count": len(body.splitlines()) if body else 0,
            "question_type": question_types.get(n, "객관식"),
        })

    return {
        "questions": questions,
        "by_number": by_number,
        "slots": slots,
        "detected_count": len(questions),
        "unparsed_prefix": unparsed_prefix,
        "raw_text": raw_text,
    }


WRONG_CHECK_KEY_PREFIX = "ocr_wrong_"


def get_selected_questions(
    check_states: dict[int, bool] | None = None,
    *,
    max_question: int = 100,
) -> list[int]:
    """Return sorted question numbers marked as wrong (checkbox checked)."""
    if not check_states:
        return []
    # check_states에 있는 키 기준으로 처리 (max_question 제한 제거)
    return sorted(n for n, v in check_states.items() if v)


def build_check_states(
    check_values: dict[int, bool],
    *,
    max_question: int = 100,
) -> dict[int, bool]:
    """Normalize checkbox values into ``{n: True/False, ...}``."""
    # 전달된 check_values 키 기준으로 처리 (range 고정 제거)
    return {n: bool(v) for n, v in check_values.items()}


def filter_parsed_by_numbers(
    parsed: dict[str, Any],
    question_numbers: list[int],
) -> dict[str, Any]:
    """Keep only the given question numbers for AI report generation."""
    nums = sorted({int(n) for n in question_numbers if int(n) >= 1})
    by_number = parsed.get("by_number") or {}

    slots: list[dict[str, Any]] = []
    questions: list[dict[str, Any]] = []
    filtered_by: dict[int, str] = {}

    for n in nums:
        body = (by_number.get(n) or "").strip()
        filtered_by[n] = body
        slot = {
            "number": n,
            "text": body,
            "found": bool(body),
            "line_count": len(body.splitlines()) if body else 0,
        }
        slots.append(slot)
        if body:
            questions.append({
                "number": n,
                "text": body,
                "found": True,
                "line_count": slot["line_count"],
            })

    return {
        **parsed,
        "questions": questions,
        "by_number": filtered_by,
        "slots": slots,
        "detected_count": len(questions),
        "selected_numbers": nums,
        "selection_mode": "user_selected",
    }


def collect_selected_questions(
    parsed: dict[str, Any],
    check_states: dict[int, bool],
) -> dict[str, Any]:
    """Gather checkbox-selected question numbers and their OCR text.

    Returns:
        {
            "selected_numbers": [2, 5, ...],
            "items": [{"number": 2, "text": "..."}, ...],
            "parsed_filtered": {...} | None,
        }
    """
    numbers = get_selected_questions(check_states)
    if not numbers:
        return {"selected_numbers": [], "items": [], "parsed_filtered": None}

    filtered = filter_parsed_by_numbers(parsed, numbers)
    by_number = filtered.get("by_number") or {}
    items = [
        {"number": n, "text": by_number.get(n, "")}
        for n in numbers
    ]
    return {
        "selected_numbers": numbers,
        "items": items,
        "parsed_filtered": filtered,
    }


def infer_topic_from_text(text: str, question_number: int) -> tuple[str, str]:
    """Return (topic_name, source) where source is 'keyword'| 'map'| 'unknown'."""
    lowered = text.lower()
    for topic, keywords in MATH_TOPIC_KEYWORDS:
        for kw in keywords:
            if kw.lower() in lowered:
                return topic, "keyword"
    mapped = DEFAULT_QUESTION_TOPIC_MAP.get(question_number)
    if mapped:
        return mapped, "map"
    return "미분류", "unknown"


def enrich_parsed_with_topics(parsed: dict[str, Any]) -> dict[str, Any]:
    """Attach unit/topic labels to each question using map + keyword heuristics."""
    topic_by_number: dict[int, str] = {}
    topic_source_by_number: dict[int, str] = {}
    by_number = parsed.get("by_number") or {}

    for n in parsed.get("selected_numbers") or []:
        text = by_number.get(n, "")
        topic, source = infer_topic_from_text(text, n)
        topic_by_number[n] = topic
        topic_source_by_number[n] = source

    enriched_slots: list[dict[str, Any]] = []
    for slot in parsed.get("slots") or []:
        n = slot["number"]
        enriched_slots.append({
            **slot,
            "topic": topic_by_number.get(n, DEFAULT_QUESTION_TOPIC_MAP.get(n, "미분류")),
            "topic_source": topic_source_by_number.get(n, "map"),
        })

    return {
        **parsed,
        "slots": enriched_slots,
        "topic_by_number": topic_by_number,
        "topic_source_by_number": topic_source_by_number,
    }


TOPIC_ANALYSIS_SYSTEM_PROMPT = """당신은 수학 시험지 OCR 텍스트를 분석하는 전문 교사입니다.
시험지 전체 OCR 텍스트가 주어집니다. 아래 작업을 수행하세요.

[작업 1] 모든 문항을 찾아내세요.
- 객관식: "1.", "2)", "문1." 등 숫자+구분자 패턴
  → 매쓰플랫 등 시험지는 "01", "02", "03" 형태(앞에 0이 붙는 두자리) 사용 — 반드시 인식할 것
- 주관식/서술형: "서술형1", "서답형 1번", "논술형1.", "단답형 1번" 등
  → 이런 문항은 question_type을 "서술형"으로 표시
  → 번호는 앞 객관식 마지막 번호에 이어서 순번 부여
    (예: 객관식이 16번까지면 서술형1→17, 서술형2→18)

[작업 2] 각 문항의 단원명을 분석하세요.
- 중학: 다항식 연산, 인수분해, 일차방정식, 연립방정식, 이차방정식, 함수와 그래프, 피타고라스, 도형의 닮음, 원의 성질, 확률, 통계
- 고1: 다항식, 나머지정리, 인수분해, 방정식과 부등식, 도형의 방정식, 집합과 명제, 함수
- 고2: 지수함수, 로그함수, 삼각함수, 수열, 극한, 미분, 적분
- 고3(수능): 극한, 미분법, 적분법, 수열의 극한, 지수·로그, 삼각함수의 활용

[작업 3] 각 문항의 풀이유형을 구체적으로 작성하세요.
- 나쁜 예: "조건 추론", "계산"
- 좋은 예: "사인·코사인 부등식 동시 조건 추론", "로그 진수 조건 + 연립방정식 풀이", "지수방정식 치환 후 근의 개수 분석"
- 문항 텍스트를 읽고 핵심 풀이 과정을 15자 내외로 구체적으로 작성

[작업 4] 난이도를 분석하세요.
- A: 킬러문항 (최상, 복합개념+고난도 추론, 배점 5~6점)
- B: 준킬러 (상, 복합개념 적용, 배점 4~5점)
- C: 표준 (중, 개념 직접 적용, 배점 3~4점)
- D: 기본 (하, 공식 대입, 배점 2~3점)
- E: 쉬움 (최하, 단순 계산, 배점 2점 이하)

반드시 아래 JSON 형식만 반환하세요 (마크다운 펜스·설명 절대 금지):
{
  "questions": [
    {
      "number": 1,
      "topic": "삼각함수",
      "method": "사인·코사인 부등식 동시 조건 추론",
      "difficulty": "C",
      "question_type": "객관식"
    }
  ]
}"""


# ── 통합 프롬프트: 수식 정제 + 문항 분석 한 번에 ──────────────────────
COMBINED_REFINE_ANALYZE_PROMPT = """당신은 수학 시험지 OCR 전문가이자 수학 교사입니다.
Google Vision OCR로 추출된 시험지 원문 텍스트가 주어집니다.
아래 두 가지 작업을 한 번에 수행하세요.

[작업 A] 수식 정제
- 수식·분수·지수·근호·부등식을 LaTeX로 표기 (인라인: $...$, 블록: $$...$$)
- OCR 오타만 최소한으로 교정 (내용 추가·삭제 금지)
- 문항 번호, 한글 지문, 선택지 구조는 원문 그대로 유지

[작업 B] 문항 분석
모든 문항을 찾아 단원·풀이유형·난이도·유형을 분석하세요.
- 객관식: "1.", "2)", "01", "02" 등 숫자+구분자 또는 두자리 앞자리0 형태 모두 포함
  (매쓰플랫 등 시험지는 "01", "02" 형태 사용 — 반드시 인식할 것)
- 서술형: "서술형1", "서답형1번", "논술형1." 등 → question_type="서술형"
  → 서술형 번호는 객관식 마지막 번호에 이어서 순번 부여
- 단원: 중학/고1/고2/고3 교육과정 기준
- 풀이유형: "사인·코사인 부등식 동시 조건 추론" 수준으로 구체적으로
- 난이도: A(킬러)~E(쉬움) 5단계

반드시 아래 JSON 형식만 반환하세요 (마크다운 펜스 절대 금지):
{
  "refined_text": "수식 정제된 전체 텍스트",
  "questions": [
    {
      "number": 1,
      "topic": "삼각함수",
      "method": "사인·코사인 부등식 동시 조건 추론",
      "difficulty": "C",
      "question_type": "객관식"
    }
  ]
}"""


def refine_and_analyze_with_gpt(
    raw_pages: list[dict[str, Any]],
    *,
    user_api_key: str = "",
    model: str = "gpt-4o",
) -> tuple[list[dict[str, Any]], list[dict]]:
    """수식 정제 + 문항 분석을 GPT 호출 1번으로 처리.

    Returns:
        (refined_pages, gpt_questions)
    """
    import json as _json

    api_key = resolve_api_key(user_api_key)
    if not api_key:
        raise OpenAIAuthError(WARN_NO_API_KEY)

    full_text = "\n\n".join(
        str(p.get("text") or "") for p in raw_pages
    ).strip()

    if not full_text:
        return raw_pages, []

    client = _build_openai_client(api_key)
    try:
        response = client.chat.completions.create(
            model=model,
            max_tokens=8192,
            temperature=0,
            messages=[
                {"role": "system", "content": COMBINED_REFINE_ANALYZE_PROMPT},
                {"role": "user", "content": full_text},
            ],
        )
    except Exception as exc:
        if _is_openai_auth_error(exc):
            raise OpenAIAuthError(OPENAI_AUTH_USER_MESSAGE) from exc
        raise RuntimeError(f"GPT 통합 분석 오류: {exc}") from exc

    raw_resp = (response.choices[0].message.content or "").strip()
    raw_resp = raw_resp.replace("```json", "").replace("```", "").strip()

    # JSON 잘림 복구
    if not raw_resp.endswith("}"):
        last_brace = raw_resp.rfind("},")
        if last_brace != -1:
            raw_resp = raw_resp[:last_brace + 1] + "\n  ]\n}"

    try:
        result = _json.loads(raw_resp)
    except Exception:
        return raw_pages, []

    refined_text = result.get("refined_text", full_text)
    gpt_questions = result.get("questions", [])

    refined_pages = [{
        "page": 1,
        "text": refined_text,
        "raw_text": full_text,
        "method": "google_vision+gpt4o_combined",
    }]

    return refined_pages, gpt_questions


def analyze_topics_with_gpt(
    parsed: dict[str, Any],
    *,
    user_api_key: str = "",
    model: str = "gpt-4o",
    _preanalyzed_questions: list[dict] | None = None,
) -> dict[str, Any]:
    """GPT로 문항 분리 + 단원·풀이유형·난이도·서술형 여부를 한번에 분석.

    _preanalyzed_questions가 있으면 GPT 재호출 없이 바로 반영.
    """
    import json as _json

    # 이미 분석된 결과가 있으면 GPT 호출 생략
    if _preanalyzed_questions is not None:
        gpt_questions: list[dict] = _preanalyzed_questions
    else:
        api_key = resolve_api_key(user_api_key)
        if not api_key:
            return parsed

        raw_text = (parsed.get("raw_text") or "").strip()
        if not raw_text:
            parts = []
            for s in (parsed.get("slots") or []):
                t = (s.get("text") or "").strip()
                if t:
                    parts.append(f"{s.get('number')}. {t}")
            raw_text = "\n\n".join(parts)

        if not raw_text:
            return parsed

        try:
            client = _build_openai_client(api_key)
            response = client.chat.completions.create(
                model=model,
                max_tokens=8192,
                temperature=0,
                messages=[
                    {"role": "system", "content": TOPIC_ANALYSIS_SYSTEM_PROMPT},
                    {"role": "user", "content": raw_text},
                ],
            )
            raw_resp = (response.choices[0].message.content or "").strip()
            raw_resp = raw_resp.replace("```json", "").replace("```", "").strip()

            if not raw_resp.endswith("}"):
                last_brace = raw_resp.rfind("},")
                if last_brace != -1:
                    raw_resp = raw_resp[:last_brace + 1] + "\n  ]\n}"
                else:
                    raw_resp = raw_resp + '"]}'

            result = _json.loads(raw_resp)
            gpt_questions = result.get("questions", [])
        except Exception as _e:
            st.session_state["_topic_debug_log"] = [f"❌ GPT 오류: {type(_e).__name__}: {_e}"]
            return parsed

    if not gpt_questions:
        return parsed

    # GPT 결과로 questions / slots / by_number 전면 재구성
    new_questions: list[dict[str, Any]] = []
    new_by_number: dict[int, str] = {}
    old_by_number: dict[int, str] = parsed.get("by_number") or {}

    for q in gpt_questions:
        try:
            n = int(q["number"])
        except (KeyError, ValueError, TypeError):
            continue
        text = old_by_number.get(n, "")
        new_by_number[n] = text
        new_questions.append({
            "number": n,
            "text": text,
            "found": True,
            "line_count": len(text.splitlines()) if text else 0,
            "topic": str(q.get("topic") or "미분류").strip() or "미분류",
            "question_method": str(q.get("method") or "").strip(),
            "difficulty": str(q.get("difficulty") or "C").strip(),
            "question_type": str(q.get("question_type") or "객관식").strip(),
        })

    # 번호 순 정렬
    new_questions.sort(key=lambda x: x["number"])

    # slots 재구성 (1 ~ max_number)
    max_number = max((q["number"] for q in new_questions), default=20)
    q_map = {q["number"]: q for q in new_questions}
    new_slots: list[dict[str, Any]] = []
    for n in range(1, max_number + 1):
        q = q_map.get(n)
        if q:
            new_slots.append({**q, "found": True})
        else:
            new_slots.append({
                "number": n, "text": "", "found": False,
                "topic": "", "question_method": "",
                "difficulty": "C", "question_type": "객관식",
            })

    # topic 인접 보완 (미분류 → 앞뒤 문항 단원 참고)
    for i, slot in enumerate(new_slots):
        if not slot.get("topic") or slot["topic"] == "미분류":
            for j in range(i - 1, -1, -1):
                t = new_slots[j].get("topic", "")
                if t and t != "미분류":
                    slot["topic"] = t
                    break
            if not slot.get("topic") or slot["topic"] == "미분류":
                for j in range(i + 1, len(new_slots)):
                    t = new_slots[j].get("topic", "")
                    if t and t != "미분류":
                        slot["topic"] = t
                        break

    st.session_state["_topic_debug_log"] = [
        f"✅ GPT 문항분석 완료 — {len(new_questions)}개 문항 인식",
        f"문항 번호: {[q['number'] for q in new_questions]}",
    ]

    return {
        **parsed,
        "questions": new_questions,
        "slots": new_slots,
        "by_number": new_by_number,
        "detected_count": len(new_questions),
    }


def parse_questions_from_extraction(extraction: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
    """Parse ``raw_combined`` (or page texts) from an :func:`extract_exam_text` result."""
    combined = (extraction.get("raw_combined") or "").strip()
    if not combined:
        parts: list[str] = []
        for pg in extraction.get("pages") or []:
            t = (pg.get("text") or "").strip()
            if t:
                parts.append(f"[페이지 {pg.get('page', '?')}]\n{t}")
        combined = "\n\n".join(parts)
    parsed = parse_questions_from_text(combined, **kwargs)
    parsed["extraction_status"] = extraction.get("status")
    return parsed


# ── Workbook / question-bank OCR ───────────────────────────────────

WORKBOOK_MAX_PAGES = 40

WORKBOOK_STRUCTURE_SYSTEM_PROMPT = """당신은 수학 문제집 OCR 텍스트를 구조화하는 전문가입니다.
한 페이지 텍스트에서 개별 문항을 분리해 JSON 배열만 반환하세요 (마크다운·설명 금지).

각 원소 형식:
{
  "question_number": 1,
  "question": "문제 본문",
  "answer": "정답",
  "explanation": "해설 (없으면 빈 문자열)",
  "topic": "단원명 (한국어)",
  "difficulty": "A" | "B" | "C" | "D" | "E",
  "question_type": "객관식" | "서술형"
}

난이도 기준 (A가 가장 어려움):
- A: 최상 (킬러문항, 고난도 추론)
- B: 상 (준킬러, 복합 개념 적용)
- C: 중 (표준 응용)
- D: 하 (기본 개념 적용)
- E: 최하 (단순 계산, 기초)

규칙:
- 1. / 2) / ③ 등 번호 패턴으로 문항을 나눕니다.
- "서술형", "서답형", "논술형", "주관식" 등은 모두 question_type="서술형"으로 통일.
- 정답·해설이 본문에 있으면 question에서 분리합니다.
- 단원을 추정할 수 없으면 "미분류".
- difficulty는 문제 난이도 추정 (기본 C)."""


_ANSWER_LABEL_RE = re.compile(
    r"(?:\[?\s*(?:정답|답)\s*\]?|정답|답)\s*[:：]\s*",
    re.IGNORECASE,
)
_EXPLANATION_LABEL_RE = re.compile(
    r"(?:\[?\s*해설\s*\]?|해설|풀이)\s*[:：]\s*",
    re.IGNORECASE,
)


def _split_workbook_block_fields(body: str) -> dict[str, str]:
    """Split OCR block into question / answer / explanation (regex fallback)."""
    text = (body or "").strip()
    question = text
    answer = ""
    explanation = ""

    m_expl = _EXPLANATION_LABEL_RE.search(text)
    if m_expl:
        explanation = text[m_expl.end() :].strip()
        text = text[: m_expl.start()].strip()

    m_ans = _ANSWER_LABEL_RE.search(text)
    if m_ans:
        answer_block = text[m_ans.end() :].strip()
        question = text[: m_ans.start()].strip()
        if answer_block:
            answer = answer_block.splitlines()[0].strip()

    return {
        "question": question.strip(),
        "answer": answer.strip(),
        "explanation": explanation.strip(),
    }


def _normalize_workbook_row(
    row: dict[str, Any],
    *,
    page_number: int,
    source_workbook: str,
) -> dict[str, Any] | None:
    """Validate and normalize one workbook question row."""
    question = str(row.get("question") or "").strip()
    if not question:
        return None
    qnum = int(row.get("question_number") or row.get("number") or 0)
    topic = str(row.get("topic") or "").strip()
    if not topic or topic == "미분류":
        topic, _ = infer_topic_from_text(question, max(qnum, 1))
    diff_raw = str(row.get("difficulty") or row.get("level") or "C").strip()
    # High/Mid/Low → A~E 변환 (하위 호환)
    _diff_legacy_map = {"High": "A", "Mid": "C", "Low": "E", "high": "A", "mid": "C", "low": "E"}
    diff = _diff_legacy_map.get(diff_raw, diff_raw)
    if diff not in ("A", "B", "C", "D", "E"):
        diff = "C"
    return {
        "question_number": qnum,
        "question": question,
        "answer": str(row.get("answer") or "").strip(),
        "explanation": str(row.get("explanation") or "").strip(),
        "topic": topic or "미분류",
        "difficulty": diff,
        "page_number": int(page_number),
        "source_workbook": source_workbook,
    }


def parse_workbook_page_questions_regex(
    page_text: str,
    *,
    page_number: int,
    source_workbook: str = "",
    max_question: int = 100,
) -> list[dict[str, Any]]:
    """Regex-based per-page question split (no GPT structure pass)."""
    parsed = parse_questions_from_text(page_text, max_question=max_question)
    rows: list[dict[str, Any]] = []
    for item in parsed.get("questions") or []:
        fields = _split_workbook_block_fields(str(item.get("text") or ""))
        if not fields["question"]:
            continue
        normalized = _normalize_workbook_row(
            {
                "question_number": int(item.get("number") or 0),
                **fields,
            },
            page_number=page_number,
            source_workbook=source_workbook,
        )
        if normalized:
            rows.append(normalized)
    return rows


def parse_workbook_page_with_gpt(
    page_text: str,
    *,
    page_number: int,
    source_workbook: str = "",
    user_api_key: str = "",
    model: str = GPT_REFINE_MODEL,
) -> list[dict[str, Any]]:
    """Use GPT-4o to split one workbook page into structured question rows."""
    text = (page_text or "").strip()
    if not text:
        return []

    api_key = resolve_api_key(user_api_key)
    if not api_key:
        return parse_workbook_page_questions_regex(
            text,
            page_number=page_number,
            source_workbook=source_workbook,
        )

    client = _build_openai_client(api_key)
    user_msg = (
        f"문제집명: {source_workbook or '미지정'}\n"
        f"페이지: {page_number}\n\n"
        f"--- OCR 텍스트 ---\n{text}"
    )
    try:
        response = client.chat.completions.create(
            model=model,
            max_tokens=4096,
            temperature=0.1,
            messages=[
                {"role": "system", "content": WORKBOOK_STRUCTURE_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
        )
    except Exception as exc:
        if _is_openai_auth_error(exc):
            raise OpenAIAuthError(OPENAI_AUTH_USER_MESSAGE) from exc
        return parse_workbook_page_questions_regex(
            text,
            page_number=page_number,
            source_workbook=source_workbook,
        )

    raw = (response.choices[0].message.content or "").strip()
    try:
        payload = json.loads(_strip_fences(raw))
    except json.JSONDecodeError:
        return parse_workbook_page_questions_regex(
            text,
            page_number=page_number,
            source_workbook=source_workbook,
        )

    if isinstance(payload, dict):
        payload = payload.get("questions") or payload.get("items") or []
    if not isinstance(payload, list):
        return parse_workbook_page_questions_regex(
            text,
            page_number=page_number,
            source_workbook=source_workbook,
        )

    rows: list[dict[str, Any]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        normalized = _normalize_workbook_row(
            item,
            page_number=page_number,
            source_workbook=source_workbook,
        )
        if normalized:
            rows.append(normalized)
    if rows:
        return rows
    return parse_workbook_page_questions_regex(
        text,
        page_number=page_number,
        source_workbook=source_workbook,
    )


def parse_workbook_questions_from_extraction(
    extraction: dict[str, Any],
    *,
    source_workbook: str = "",
    use_gpt_structure: bool = True,
    user_api_key: str = "",
) -> list[dict[str, Any]]:
    """Parse all OCR pages into flat question-bank rows."""
    rows: list[dict[str, Any]] = []
    for pg in extraction.get("pages") or []:
        page_num = int(pg.get("page") or 0)
        text = str(pg.get("text") or "").strip()
        if not text:
            continue
        if use_gpt_structure and has_openai_api_key(user_api_key):
            page_rows = parse_workbook_page_with_gpt(
                text,
                page_number=page_num,
                source_workbook=source_workbook,
                user_api_key=user_api_key,
            )
        else:
            page_rows = parse_workbook_page_questions_regex(
                text,
                page_number=page_num,
                source_workbook=source_workbook,
            )
        rows.extend(page_rows)
    return rows


# ── Wrong-answer report (OpenAI) ──────────────────────────────────

WRONG_ANSWER_REPORT_PROMPT = """당신은 중등·고등 수학 전문 교사입니다.
아래는 시험지 OCR로 추출한 텍스트를 문항 번호(1. / 2) 형식)별로 나눈 결과입니다.
{selection_note}

[매우 중요] 단원 분류 규칙:
- 반드시 시험지 텍스트 내용을 직접 읽고 단원을 판단하세요.
- 중학교 시험이면 "이차방정식", "일차함수" 등 중학교 단원으로.
- 고등학교 시험이면 "지수함수", "로그함수", "삼각함수", "수열", "미분", "적분" 등 고등학교 단원으로.
- 문제 번호 순서나 위치로 단원을 추정하지 마세요. 반드시 문제 내용을 보고 판단하세요.
- 판단이 어려우면 "미분류"로 두세요. 절대 임의로 단원을 만들지 마세요.

[중요] 서술형 문항 처리 규칙:
- "서술형", "서답형", "논술형", "주관식", "단답형" 등 다양한 이름은 모두 "서술형"으로 통일하세요.
- "서술형 1번", "서술형1", "[서술형] 2번" 등 다양한 형식을 모두 인식하세요.
- 서술형 문항은 question_type 을 "서술형"으로 표시하세요.
- 객관식 문항은 question_type 을 "객관식"으로 표시하세요.

[중요] 난이도 기준 (A가 가장 어려움):
- A: 최상 (킬러문항, 고난도 추론)
- B: 상 (준킬러, 복합 개념 적용)
- C: 중 (표준 응용)
- D: 하 (기본 개념 적용)
- E: 최하 (단순 계산, 기초)

각 문항을 읽고:
  - 학생이 적은 풀이·답을 파악하세요.
  - 정답 여부를 Correct / Partial / Incorrect 로 판정하세요.
  - 틀리거나 부분 점수인 문항은 mistake_pattern, correct_approach, study_tip 을 작성하세요.

문항이 비어 있거나 OCR이 불완전하면 result 를 "Unknown"으로 두고 ai_comment 에 이유를 적으세요.

{questions_block}

아래 JSON 형식으로만 반환하세요 (순수 JSON, 마크다운 펜스 금지):

{{
  "mode": "ai",
  "questions": [
    {{
      "number": 1,
      "topic": "단원명 (한국어, 예: 이차방정식)",
      "question_method": "풀이유형 (한국어, 예: 근의공식, 인수분해 활용, 그래프 해석)",
      "question_type": "객관식 | 서술형",
      "difficulty": "A | B | C | D | E",
      "result": "Correct | Incorrect | Partial | Unknown",
      "student_answer": "학생 답·풀이 요약",
      "ai_comment": "한 문장 피드백 (한국어)"
    }}
  ],
  "wrong_count": 0,
  "summary": "2~3문장 종합 평가 (한국어)",
  "wrong_analysis": [
    {{
      "number": 4,
      "mistake_pattern": "오류 유형",
      "correct_approach": "올바른 풀이 요약",
      "study_tip": "보완 학습 제안"
    }}
  ],
  "strengths": ["잘한 점"],
  "improvement_areas": ["보완점"],
  "teacher_notes": "교사용 2~3문장 메모",
  "suggested_practice": ["추천 연습"]
}}"""


def _format_questions_block(parsed: dict[str, Any]) -> str:
    """OCR text only — unit/topic classification is left to the AI."""
    lines: list[str] = [
        "[지시] 각 문항의 문제 내용·학생 풀이를 읽고 단원명을 직접 분류하세요. "
        "별도 단원 DB는 없습니다.\n",
    ]
    user_selected = parsed.get("selection_mode") == "user_selected"

    for slot in parsed.get("slots") or []:
        body = (slot.get("text") or "").strip()
        header = f"--- {slot['number']}번 (틀린 문항) ---"
        if user_selected:
            lines.append(
                f"{header}\n{body or '(OCR 텍스트 없음 — 번호만 오답 지정됨)'}"
            )
        elif slot.get("found") and body:
            lines.append(f"{header}\n{body}")
    if lines:
        return "\n\n".join(lines)
    prefix = (parsed.get("unparsed_prefix") or "").strip()
    raw = (parsed.get("raw_text") or "").strip()
    if prefix:
        return f"(문항 번호 미감지 — 전체 텍스트)\n\n{raw}"
    return raw or "(추출된 텍스트 없음)"


def mock_wrong_answer_report(parsed: dict[str, Any]) -> dict[str, Any]:
    """Simulation when no API key is configured."""
    detected = parsed.get("detected_count", 0)
    selected = parsed.get("selected_numbers")
    if selected:
        sample_wrong = list(selected)
    else:
        nums = [q["number"] for q in parsed.get("questions", [])[:5]]
        sample_wrong = nums[2:4] if len(nums) > 2 else [3, 4]
    report_nums = sample_wrong if selected else list(range(1, min(6, 21)))
    questions = []
    for n in report_nums:
        is_wrong = True if selected else (n in sample_wrong)
        questions.append({
            "number": n,
            "topic": "이차방정식" if n % 2 else "일차방정식",
            "result": "Incorrect" if is_wrong else "Correct",
            "student_answer": "x = 2 (오류)" if is_wrong else "x = 5",
            "ai_comment": "계산 실수가 있습니다." if is_wrong else "정확합니다.",
        })
    wrong_analysis = [
        {
            "number": n,
            "mistake_pattern": "부호·대입 오류",
            "correct_approach": "식을 정리한 뒤 대입하여 해를 구합니다.",
            "study_tip": "유사 유형 5문제 반복 연습",
        }
        for n in sample_wrong
    ]
    return {
        "mode": "mock",
        "questions": questions,
        "wrong_count": len(sample_wrong),
        "summary": (
            f"OCR에서 {detected}개 문항이 감지되었습니다 (시뮬레이션). "
            "API 키를 설정하면 실제 오답 분석 리포트가 생성됩니다."
        ),
        "wrong_analysis": wrong_analysis,
        "strengths": ["기본 개념 이해는 양호"],
        "improvement_areas": ["계산 정확도", "문장제 변수 설정"],
        "teacher_notes": "설정 탭에서 OpenAI API 키를 입력하면 GPT-4o 분석이 실행됩니다.",
        "suggested_practice": ["오답 유형별 유사 문제 풀이"],
    }


def analyze_wrong_answer_report(
    text_or_parsed: str | dict[str, Any],
    user_api_key: str = "",
    *,
    model: str = "gpt-4o",
    max_tokens: int = 4096,
) -> dict[str, Any]:
    """Generate a wrong-answer analysis report from structured OCR text.

    Args:
        text_or_parsed: Raw OCR string or output of :func:`parse_questions_from_text`.
        user_api_key: OpenAI API key (falls back to env). Empty → :func:`mock_wrong_answer_report`.

    Returns:
        Report dict with ``questions``, ``wrong_analysis``, ``summary``, etc.
    """
    if isinstance(text_or_parsed, str):
        parsed = parse_questions_from_text(text_or_parsed)
    else:
        parsed = text_or_parsed

    api_key = resolve_api_key(user_api_key)
    if not api_key:
        return mock_wrong_answer_report(parsed)

    if parsed.get("selection_mode") == "user_selected" and parsed.get("selected_numbers"):
        nums = ", ".join(str(n) for n in parsed["selected_numbers"])
        selection_note = (
            f"\n▶ 교사/학생이 오답으로 지정한 문항 번호만 포함되어 있습니다: {nums}번\n"
            "이 문항들에 대해서만 집중적으로 오답 분석을 작성하세요.\n"
        )
    else:
        selection_note = "\n"

    block = _format_questions_block(parsed)
    prompt = WRONG_ANSWER_REPORT_PROMPT.format(
        selection_note=selection_note,
        questions_block=block,
    )

    client = _build_openai_client(api_key)
    response = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )

    choices = getattr(response, "choices", None)
    if not choices:
        raise RuntimeError("OpenAI 응답에 choices 필드가 없습니다. 잠시 후 다시 시도해 주세요.")

    raw = choices[0].message.content or "{}"
    result = json.loads(_strip_fences(raw))
    result.setdefault("mode", "ai")
    result["parsed_meta"] = {
        "detected_count": parsed.get("detected_count", 0),
        "unparsed_prefix": parsed.get("unparsed_prefix", ""),
        "selected_numbers": parsed.get("selected_numbers"),
    }
    return result


# ── Professional grade analysis report (OpenAI) ───────────────────

LEARNING_ANALYSIS_REPORT_PROMPT = """너는 **20년 경력의 수학 전문 학원 원장**이다.
학부모 상담용 **전문 성적 분석표**를 작성한다. 글을 길게 늘어놓지 말고,
학부모가 읽자마자 아이의 **취약점**을 파악할 수 있게 핵심만 명확히 쓴다.

대상 학생: {student_name}
오답 지정 문항: {question_numbers}

[틀린 문항 OCR 텍스트 — 단원은 문제 내용을 보고 직접 분류할 것]
{questions_block}

반드시 아래 **3개 섹션**으로 JSON을 채워라. 단원명은 OCR 문제·풀이 내용을 분석해 AI가 직접 판단한다.

**섹션 1 — 총평 및 성취도 (section_1_overview + score_comparison)**
- 2~4문장 총평, strengths 2개, weaknesses 2~3개 (취약점 중심)
- score_comparison 은 **반드시 숫자**로 작성 (문자열 금지):
  - student_score: 학생 추정 점수 (0~100, number)
  - class_average: 반 전체 평균 (0~100, number)
  - gap_comment: 격차 설명 (한국어)

**섹션 2 — 단원별 오답 상세 분석 (section_2_wrong_analysis)**
- 표에 넣을 행 배열. 각 행: topic, wrong_numbers, wrong_reason, concept_to_review
- 같은 단원은 한 행으로 묶어도 되고 문항별로 나눠도 됨

**섹션 3 — 맞춤형 학습 처방전 (section_3_prescription)**
- intro 1문장
- parent_action_rules: 학부모가 **집에서 할 수 있는 구체적 행동** 정확히 **3가지** (문장으로)
- weekly_focus: 이번 주 집중 학습 한 줄

순수 JSON만 반환 (마크다운 펜스 금지):

{{
  "mode": "ai",
  "student_name": "{student_name}",
  "selected_numbers": {question_numbers_json},
  "title": "전문 성적 분석표",
  "section_1_overview": {{
    "headline": "한 줄 총평 제목",
    "summary": "2~4문장 종합",
    "strengths": ["강점1", "강점2"],
    "weaknesses": ["취약점1", "취약점2"]
  }},
  "score_comparison": {{
    "student_score": 0,
    "class_average": 0,
    "gap_comment": "평균 대비 격차 설명 (점수는 숫자만, 반 평균은 추정하지 말 것)"
  }},
  "section_2_wrong_analysis": [
    {{
      "topic": "이차방정식",
      "wrong_numbers": [9, 10],
      "wrong_reason": "근의 공식 대입 시 부호 혼동",
      "concept_to_review": "인수분해와 판별식"
    }}
  ],
  "section_3_prescription": {{
    "intro": "처방 소개 1문장",
    "parent_action_rules": ["행동 강령 1", "행동 강령 2", "행동 강령 3"],
    "weekly_focus": "이번 주 집중 단원·분량"
  }}
}}"""


def _normalize_wrong_analysis_rows(report: dict[str, Any]) -> list[dict[str, Any]]:
    """Unify section_2 and legacy topic_wrong_table."""
    rows = report.get("section_2_wrong_analysis") or []
    if rows:
        return rows
    legacy = report.get("topic_wrong_table") or []
    return [
        {
            "topic": r.get("topic", "—"),
            "wrong_numbers": r.get("wrong_numbers", []),
            "wrong_reason": r.get("wrong_reason") or r.get("error_type", "—"),
            "concept_to_review": r.get("concept_to_review") or r.get("action", "—"),
        }
        for r in legacy
    ]


def _wrong_analysis_table_markdown(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "_분석할 오답 데이터가 없습니다._"
    lines = [
        "| **단원명** | **틀린 문항** | **틀린 이유** | **보완할 개념** |",
        "| :--- | :--- | :--- | :--- |",
    ]
    for row in rows:
        nums = row.get("wrong_numbers") or []
        num_str = ", ".join(f"**{n}번**" for n in nums) if nums else "—"
        lines.append(
            f"| **{row.get('topic', '—')}** | {num_str} | "
            f"{row.get('wrong_reason', '—')} | **{row.get('concept_to_review', '—')}** |"
        )
    return "\n".join(lines)


def format_section1_overview_md(report: dict[str, Any]) -> str:
    """Section 1: overview text (graph rendered separately in UI)."""
    student = report.get("student_name") or "학생"
    s1 = report.get("section_1_overview") or {}
    sc = report.get("score_comparison") or {}
    nums = report.get("selected_numbers") or []
    num_str = ", ".join(f"{n}번" for n in nums) if nums else "—"

    parts = [
        f"### {s1.get('headline') or '종합 총평'}",
        "",
        f"**학생:** {student} · **분석 오답:** {num_str}",
        "",
        s1.get("summary") or "",
        "",
    ]
    strengths = s1.get("strengths") or []
    if strengths:
        parts.append("**강점**")
        for s in strengths:
            parts.append(f"-  {s}")
        parts.append("")

    weaknesses = s1.get("weaknesses") or []
    if weaknesses:
        parts.append("**취약점 (학부모 확인 포인트)**")
        for w in weaknesses:
            parts.append(f"-  **{w}**")
        parts.append("")

    if sc:
        parts += [
            "---",
            "",
            "**성취도 수치 (100점 만점 추정)**",
            "",
            f"| 구분 | 점수 |",
            f"| :--- | ---: |",
            f"| **{student}** | **{sc.get('student_score', '—')}점** |",
            f"| **반 전체 평균** | {sc.get('class_average', '—')}점 |",
            "",
            f"*{sc.get('gap_comment', '')}*",
            "",
            "**아래 막대 그래프**에서 학생과 반 평균을 비교해 보세요.",
        ]
    return "\n".join(parts).strip()


def format_section2_detail_md(report: dict[str, Any]) -> str:
    """Section 2: unit-wise wrong answer analysis table."""
    rows = _normalize_wrong_analysis_rows(report)
    parts = [
        "### 단원별 오답 상세 분석",
        "",
        "문제 **내용·풀이**를 바탕으로 AI가 단원을 분류했습니다.",
        "",
        _wrong_analysis_table_markdown(rows),
    ]
    return "\n".join(parts).strip()


def format_section3_prescription_md(report: dict[str, Any]) -> str:
    """Section 3: learning prescription with 3 parent action rules."""
    s3 = report.get("section_3_prescription") or {}
    rx = report.get("learning_prescription") or {}

    intro = s3.get("intro") or rx.get("intro") or ""
    rules = s3.get("parent_action_rules") or rx.get("parent_action_rules") or []
    if not rules:
        rules = (rx.get("parent_tips") or [])[:3]
    weekly = s3.get("weekly_focus") or ""
    if not weekly and rx.get("weekly_plan"):
        weekly = rx["weekly_plan"][0] if isinstance(rx["weekly_plan"], list) else str(rx["weekly_plan"])

    parts = [
        "### 선생님의 맞춤형 학습 처방전",
        "",
        intro,
        "",
        "#### 학부모님 가정 지원 **행동 강령 3가지**",
        "",
    ]
    display_rules = (rules + ["", "", ""])[:3]
    for i, rule in enumerate(display_rules, 1):
        if rule:
            parts.append(f"{i}. **{rule}**")
        else:
            parts.append(f"{i}. _(처방 데이터 없음)_")

    if weekly:
        parts += ["", f"**이번 주 집중:** {weekly}"]

    priority = s3.get("priority_topics") or rx.get("priority_topics") or []
    if priority:
        parts += ["", "**우선 보완 단원:** "+ ", ".join(f"**{t}**" for t in priority)]

    return "\n".join(parts).strip()


def format_full_report_markdown(report: dict[str, Any]) -> str:
    """Full report for copy/export."""
    title = report.get("title") or "전문 성적 분석표"
    return "\n\n---\n\n".join([
        f"# {title}",
        format_section1_overview_md(report),
        format_section2_detail_md(report),
        format_section3_prescription_md(report),
    ])


def format_learning_analysis_markdown(report: dict[str, Any]) -> str:
    return format_full_report_markdown(report)


def format_parent_report_markdown(report: dict[str, Any]) -> str:
    return format_full_report_markdown(report)


def _parse_score_value(value: Any) -> float | None:
    """Parse AI/session score to float (handles 72, '72', '72점')."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        v = float(value)
        return v if 0 <= v <= 100 else None
    s = str(value).strip()
    m = re.search(r"(\d+(?:\.\d+)?)", s)
    if not m:
        return None
    v = float(m.group(1))
    return v if 0 <= v <= 100 else None


def estimate_scores_from_wrong_answers(
    selected_numbers: list[int],
    *,
    total_questions: int = 20,
    class_average: float | None = None,
) -> dict[str, Any]:
    """Fallback: estimate student score from wrong-answer count."""
    n_wrong = len(selected_numbers)
    points_per_q = 100.0 / max(total_questions, 1)
    student = max(35.0, min(98.0, 100.0 - n_wrong * points_per_q * 1.1))
    result: dict[str, Any] = {
        "student_score": round(student, 1),
        "is_estimated": True,
    }
    if class_average is not None:
        gap = student - class_average
        result["class_average"] = round(class_average, 1)
        result["gap_comment"] = (
            f"오답 {n_wrong}문항 기준 추정 · "
            f"반 평균 {class_average:.0f}점 대비 {gap:+.0f}점"
        )
    else:
        result["gap_comment"] = (
            f"오답 {n_wrong}문항 / {total_questions}문항 기준 **추정 점수** "
            f"{student:.0f}점 (반 평균 기록 없음)"
        )
    return result


def ensure_score_comparison(
    report: dict[str, Any],
    *,
    parsed_filtered: dict[str, Any] | None = None,
    total_questions: int = 20,
    class_average: float | None = None,
) -> dict[str, Any]:
    """Ensure ``score_comparison`` has numeric student_score (& class_average when known)."""
    sc = dict(report.get("score_comparison") or {})
    s1 = report.get("section_1_overview") or {}

    student = _parse_score_value(sc.get("student_score"))
    if student is None:
        student = _parse_score_value(s1.get("student_score"))
    average = _parse_score_value(sc.get("class_average"))
    if average is None:
        average = _parse_score_value(s1.get("class_average"))
    if average is None and class_average is not None:
        average = float(class_average)

    nums = list(report.get("selected_numbers") or [])
    if parsed_filtered:
        nums = nums or list(parsed_filtered.get("selected_numbers") or [])
    detected = int((parsed_filtered or {}).get("detected_count") or total_questions)
    tq = detected if detected > 0 else total_questions

    if student is not None and average is not None:
        sc["student_score"] = student
        sc["class_average"] = average
        sc.setdefault("is_estimated", False)
        if not sc.get("gap_comment"):
            sc["gap_comment"] = f"평균 대비 {student - average:+.0f}점"
    elif student is not None:
        sc["student_score"] = student
        sc.setdefault("is_estimated", False)
        if not sc.get("gap_comment"):
            sc["gap_comment"] = f"학생 {student:.0f}점"
    elif nums:
        sc.update(estimate_scores_from_wrong_answers(nums, total_questions=tq, class_average=average))
        sc["source"] = "estimated_wrong_count"
    else:
        sc.setdefault("gap_comment", "점수 데이터 없음")
        sc["is_estimated"] = True
        sc["source"] = "no_data"

    report["score_comparison"] = sc
    return report


def get_chart_scores(
    report: dict[str, Any],
    *,
    parsed_filtered: dict[str, Any] | None = None,
    class_average: float | None = None,
) -> tuple[float | None, float | None, dict[str, Any]]:
    """Return (student_score, class_average, score_comparison dict) for Plotly."""
    report = ensure_score_comparison(
        report,
        parsed_filtered=parsed_filtered,
        class_average=class_average,
    )
    sc = report["score_comparison"]
    student = _parse_score_value(sc.get("student_score"))
    average = _parse_score_value(sc.get("class_average"))
    return student, average, sc


def build_score_comparison_figure(
    report: dict[str, Any],
    *,
    parsed_filtered: dict[str, Any] | None = None,
    student_score: float | None = None,
    class_average: float | None = None,
):
    """Plotly bar chart: student vs class average (class average optional)."""
    if student_score is None or class_average is None:
        student_f, average_f, sc = get_chart_scores(
            report,
            parsed_filtered=parsed_filtered,
            class_average=class_average,
        )
        is_estimated = sc.get("is_estimated", False)
        if student_score is not None:
            student_f = float(student_score)
        if class_average is not None:
            average_f = float(class_average)
    else:
        student_f = float(student_score)
        average_f = float(class_average)
        is_estimated = False
        sc = report.get("score_comparison") or {}

    if student_f is None:
        return None

    student_name = report.get("student_name") or "학생"

    if average_f is None:
        subtitle = "(반 평균 기록 없음)" if is_estimated else ""
        fig = go.Figure(
            data=[
                go.Bar(
                    x=[student_name],
                    y=[student_f],
                    text=[f"<b>{student_f:.0f}점</b>"],
                    textposition="outside",
                    marker_color=["#1d4ed8"],
                    marker_line_color=["#1e40af"],
                    marker_line_width=2,
                    width=0.45,
                )
            ]
        )
        fig.update_layout(
            title=dict(
                text=f"학생 성취도{subtitle}",
                font=dict(size=18),
            ),
            yaxis_title="점수 (100점 만점)",
            yaxis=dict(range=[0, max(105, student_f + 12)], gridcolor="#e2e8f0", dtick=10),
            xaxis=dict(title=""),
            plot_bgcolor="#f8fafc",
            paper_bgcolor="white",
            height=440,
            margin=dict(t=70, b=48, l=48, r=24),
            bargap=0.35,
        )
        return fig

    gap = student_f - average_f
    subtitle = "(오답 문항 기준 추정)" if is_estimated else ""

    fig = go.Figure(
        data=[
            go.Bar(
                x=[student_name, "반 전체 평균"],
                y=[student_f, average_f],
                text=[f"<b>{student_f:.0f}점</b>", f"<b>{average_f:.0f}점</b>"],
                textposition="outside",
                marker_color=["#1d4ed8", "#94a3b8"],
                marker_line_color=["#1e40af", "#64748b"],
                marker_line_width=2,
                width=0.45,
            )
        ]
    )
    fig.update_layout(
        title=dict(
            text=f"성취도 비교 (학생 vs 반 평균){subtitle}",
            font=dict(size=18),
        ),
        yaxis_title="점수 (100점 만점)",
        yaxis=dict(range=[0, max(105, average_f + 12)], gridcolor="#e2e8f0", dtick=10),
        xaxis=dict(title=""),
        plot_bgcolor="#f8fafc",
        paper_bgcolor="white",
        height=440,
        margin=dict(t=70, b=48, l=48, r=24),
        bargap=0.35,
        annotations=[
            dict(
                text=f"격차: <b>{gap:+.0f}점</b>",
                xref="paper",
                yref="paper",
                x=0.5,
                y=1.12,
                showarrow=False,
                font=dict(size=14, color="#334155"),
            )
        ],
    )
    return fig


def build_class_score_distribution_figure(
    scores_df: pd.DataFrame,
    class_average: float | None,
    *,
    test_name: str = "",
    test_date: str = "",
    class_name: str = "",
) -> go.Figure:
    """Plotly bar chart: each student's score vs dashed class-average line."""
    display = scores_df.copy()
    display = display.sort_values("score", ascending=False, na_position="last")
    names = display["student_name"].tolist()
    values = [
        float(v) if pd.notna(v) else 0.0
        for v in display["score"].tolist()
    ]
    has_col = "has_record" in display.columns
    colors = [
        "#1d4ed8" if (not has_col or bool(rec)) and pd.notna(sc) else "#cbd5e1"
        for rec, sc in zip(
            display.get("has_record", pd.Series([True] * len(display))),
            display["score"],
        )
    ]
    labels = [
        f"{float(v):.0f}" if pd.notna(v) else "—"
        for v in display["score"].tolist()
    ]

    scored = [v for v in values if v > 0]
    ymax_parts = [v for v in scored]
    if class_average is not None:
        ymax_parts.append(float(class_average))
    ymax = max(ymax_parts or [0]) + 12
    title_bits = [bit for bit in (class_name, test_name, test_date) if bit]
    title = "· ".join(title_bits) if title_bits else "반별 점수 분포"

    fig = go.Figure(
        data=[
            go.Bar(
                x=names,
                y=values,
                text=labels,
                textposition="outside",
                marker_color=colors,
                marker_line_color="#1e40af",
                marker_line_width=1,
                name="학생 점수",
            )
        ]
    )
    if class_average is not None:
        fig.add_hline(
            y=class_average,
            line_dash="dash",
            line_color="#dc2626",
            line_width=2,
            annotation_text=f"반 평균 {class_average:.1f}점",
            annotation_position="top right",
            annotation_font=dict(size=13, color="#dc2626"),
        )
    fig.update_layout(
        title=dict(
            text=f"{title} — 학생 점수 vs 반 평균",
            font=dict(size=18),
        ),
        yaxis_title="점수 (100점 만점)",
        yaxis=dict(range=[0, max(105, ymax)], gridcolor="#e2e8f0", dtick=10),
        xaxis=dict(title="", tickangle=-30 if len(names) > 6 else 0),
        plot_bgcolor="#f8fafc",
        paper_bgcolor="white",
        height=460,
        margin=dict(t=80, b=72, l=48, r=24),
        bargap=0.28,
        showlegend=False,
    )
    return fig


def _mock_topics_from_ocr_text(parsed: dict[str, Any]) -> dict[str, list[int]]:
    """Mock: infer topics from OCR text only (no fixed question map)."""
    by_number = parsed.get("by_number") or {}
    topics_seen: dict[str, list[int]] = {}
    for n in parsed.get("selected_numbers") or []:
        text = by_number.get(n, "")
        topic, _ = infer_topic_from_text(text, n)
        if topic == "미분류":
            topic = "수학 종합"
        topics_seen.setdefault(topic, []).append(n)
    return topics_seen


def mock_learning_analysis_report(
    parsed: dict[str, Any],
    *,
    student_name: str = "학생",
) -> dict[str, Any]:
    """Simulation when OPENAI_API_KEY is not set in .env."""
    nums = parsed.get("selected_numbers") or [3, 5]
    topics_seen = _mock_topics_from_ocr_text(parsed)

    section_2 = [
        {
            "topic": t,
            "wrong_numbers": ns,
            "wrong_reason": "풀이 과정에서 계산·대입 실수",
            "concept_to_review": f"{t} 핵심 개념 재정리",
        }
        for t, ns in topics_seen.items()
    ]

    report: dict[str, Any] = {
        "mode": "mock",
        "student_name": student_name,
        "selected_numbers": nums,
        "title": "전문 성적 분석표 (시뮬레이션)",
        "section_1_overview": {
            "headline": "계산력은 양호, 응용·검산에서 점수 손실",
            "summary": (
                f"{student_name} 학생은 기본 개념 이해는 되어 있으나, "
                f"선택 오답 {len(nums)}문항에서 **마무리 검산**과 **식 정리** 실수가 반복됩니다."
            ),
            "strengths": ["풀이 시도와 과정 작성 습관", "기본 공식 인지"],
            "weaknesses": ["계산 실수", "문장제 조건 해석", "시간 관리"],
        },
        "section_2_wrong_analysis": section_2,
        "section_3_prescription": {
            "intro": "가정에서 아래 3가지만 꾸준히 실천해 주시면 단기간에 개선 가능합니다.",
            "parent_action_rules": [
                "매일 15분, 틀린 문항 풀이를 **소리 내어** 설명하게 하기",
                "최종 답을 구한 뒤 **식에 대입해 검산**하는 습관 붙이기",
                "주 1회, 오답 노트에서 **같은 유형** 3문제만 다시 풀기",
            ],
            "weekly_focus": f"{', '.join(list(topics_seen.keys())[:2])} 유사 유형 10문제",
        },
    }
    return ensure_score_comparison(report, parsed_filtered=parsed)


def generate_learning_analysis_report(
    parsed_filtered: dict[str, Any],
    user_api_key: str = "",
    *,
    student_name: str = "학생",
    model: str = "gpt-4o",
    max_tokens: int = 4096,
) -> dict[str, Any]:
    """Generate a professional parent consultation grade analysis report."""
    nums = parsed_filtered.get("selected_numbers") or []
    api_key = resolve_api_key(user_api_key)
    if not api_key:
        return mock_learning_analysis_report(parsed_filtered, student_name=student_name)

    block = _format_questions_block(parsed_filtered)
    prompt = LEARNING_ANALYSIS_REPORT_PROMPT.format(
        student_name=student_name,
        question_numbers=", ".join(f"{n}번" for n in nums) if nums else "—",
        question_numbers_json=json.dumps(nums, ensure_ascii=False),
        questions_block=block,
    )

    client = _build_openai_client(api_key)
    response = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )

    choices = getattr(response, "choices", None)
    if not choices:
        raise RuntimeError("OpenAI 응답에 choices 필드가 없습니다. 잠시 후 다시 시도해 주세요.")

    raw = choices[0].message.content or "{}"
    result = json.loads(_strip_fences(raw))
    result.setdefault("mode", "ai")
    result.setdefault("student_name", student_name)
    result.setdefault("selected_numbers", nums)
    result.setdefault("title", "전문 성적 분석표")
    return ensure_score_comparison(result, parsed_filtered=parsed_filtered)


def generate_parent_feedback_report(
    parsed_filtered: dict[str, Any],
    user_api_key: str = "",
    **kwargs: Any,
) -> dict[str, Any]:
    """Backward-compatible alias for :func:`generate_learning_analysis_report`."""
    return generate_learning_analysis_report(
        parsed_filtered, user_api_key, **kwargs
    )


def mock_parent_feedback_report(parsed: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
    return mock_learning_analysis_report(parsed, **kwargs)