"""abc 과제 인증 — 과제 자료(PDF) 업로드 + 사진↔페이지 이미지 대조 (2026-08-13 추가).

배경: hw_photo_review.py의 텍스트 기반 페이지번호 인식(AI가 사진 속 인쇄된
작은 숫자를 읽어서 페이지를 추정)은 세 차례 프롬프트를 다듬었는데도
인식률이 충분히 오르지 않았다(사용자가 실사용에서 반복 확인). 근본 원인은
"작게 인쇄된 숫자 하나를 정확히 읽어내야 하는" 과제 자체가 비전 모델에게도
어려운 일이라는 것 — 손글씨/인쇄 구분, 사진 회전, 문제번호와의 혼동 등
여러 실패 모드가 있었다.

이 모듈은 다른 접근을 쓴다: 선생님이 문제집/프린트 PDF 원본을 미리
업로드해두면, 학생이 인증샷을 올렸을 때 "사진 속 작은 숫자를 읽는" 대신
"이 사진이 몇 개의 후보 페이지 이미지 중 어느 것과 같은 문제인가"를 AI에게
직접 비교시킨다 — 이미지끼리 비교하는 게 이미지 속 숫자 하나를 정확히
읽는 것보다 훨씬 쉬운 작업이라는 아이디어(사용자 제안, 2026-08-13).
문제집이 끝나면 선생님이 그 자료를 삭제하고 새 PDF로 교체하는 식으로 쓴다.

참조 자료가 등록 안 된 항목(material_name이 이 반에 없는 경우)은 자동으로
hw_photo_review.py의 기존 텍스트 인식 방식으로 대체된다(fallback) — 이
모듈은 순수 추가 기능이라 참조 자료를 안 올려도 기존처럼 그대로 동작한다.

⚠️ 완전히 새로 추가된 모듈입니다. 기존 hw_assign.py / hw_upload.py의 함수는
   하나도 수정하지 않았습니다. hw_photo_review.py의 run_ai_page_check()에는
   참조 자료 유무를 먼저 확인해서 있으면 이 모듈로, 없으면 기존 방식으로
   갈아타는 부분만 추가했습니다. database.py에는 ensure_hw_reference_table()
   (새 테이블 hw_reference_materials 생성)만 추가했습니다.

[2026-08-13 추가] page_offset 보정: PDF에 표지·목차 등이 앞에 있으면 "문제집에
인쇄된 페이지 번호"와 "PDF 파일 내 실제 장 번호"가 어긋난다(예: 인쇄 10페이지가
PDF 파일로는 15번째 장). 이걸 material마다 page_offset 값으로 저장해서 보정한다.

[2026-08-13 추가] page_offset 자동 감지: 처음엔 이 숫자를 선생님이 직접 세어서
입력해야 했는데, "AI가 이것도 못 알아내냐"는 지적을 받고 자동 감지를 추가했다.
학생이 찍은 사진과 달리 PDF 원본 페이지는 회전·손글씨·가려짐이 없는 깨끗한
이미지라, AI가 각 장에 인쇄된 페이지 번호를 읽는 게 훨씬 쉽다(사진 인식이
어려웠던 것과는 다른 상황) — 그래서 자동 감지가 실무적으로 잘 통한다.
자동 감지가 실패하거나(페이지 번호가 없는 특이한 PDF 등) 결과가 미심쩍을 때만
수동 입력이 fallback으로 남아있다.

Public API:
  - save_reference_pdf(class_id, material_name, pdf_bytes, page_offset=0) -> dict
  - update_reference_offset(class_id, material_name, page_offset) -> None
  - get_reference_materials(class_id) -> list[dict]
  - get_reference_material(class_id, material_name) -> dict | None
  - delete_reference_material(class_id, material_name) -> None
  - get_reference_page_images(class_id, material_name, page_start, page_end) -> list[(페이지번호, PNG바이트)]
  - auto_detect_page_offset(pdf_bytes) -> dict  # {"offset": int|None, "detail": str}
  - run_ai_page_check_with_reference(photo_url, class_id, material_name, page_start, page_end)
        -> dict | None   # 참조 자료가 없으면 None (호출한 쪽에서 기존 방식으로 폴백)
  - render_reference_upload_section(class_id) -> None   # Streamlit UI
"""

from __future__ import annotations

import base64
import json
import re
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

import streamlit as st

from db_connect import get_conn

_REFERENCE_DIR = Path(__file__).resolve().parent / "hw_reference_files"

_HW_REFERENCE_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS hw_reference_materials (
    id             SERIAL PRIMARY KEY,
    class_id       INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    material_name  TEXT NOT NULL,
    file_path      TEXT NOT NULL,
    page_count     INTEGER NOT NULL DEFAULT 0,
    page_offset    INTEGER NOT NULL DEFAULT 0,
    uploaded_at    TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    UNIQUE (class_id, material_name)
)
"""

_ENSURED = False


def _ensure_table() -> None:
    """database.ensure_hw_reference_table()과 별개로, 이 모듈만 단독으로 써도
    안전하도록 자체 캐시로 한 번만 실행한다(패턴은 database.py의 다른
    ensure_* 함수들과 동일)."""
    global _ENSURED
    if _ENSURED:
        return
    conn = get_conn()
    try:
        conn.execute(_HW_REFERENCE_TABLE_DDL)
        # 마이그레이션 [2026-08-13]: page_offset 컬럼 — 표지·목차 등이 앞에
        # 있어서 "문제집에 인쇄된 1페이지"가 PDF 파일 자체의 첫 장이 아닌
        # 경우를 보정하는 값. 이 컬럼이 없던 이전 버전 DB에도 안전하게
        # 추가되도록 "컬럼 존재 확인 후 ALTER" 패턴을 그대로 씀.
        cols = [
            row[1] for row in conn.execute(
                "SELECT ordinal_position, column_name FROM information_schema.columns "
                "WHERE table_name = 'hw_reference_materials'"
            ).fetchall()
        ]
        if "page_offset" not in cols:
            conn.execute(
                "ALTER TABLE hw_reference_materials ADD COLUMN page_offset INTEGER NOT NULL DEFAULT 0"
            )
        conn.commit()
        _ENSURED = True
    finally:
        conn.close()


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def _safe_filename(class_id: int, material_name: str) -> str:
    """파일명에 못 쓰는 문자를 걸러내고 class_id를 붙여 반끼리 이름이 겹쳐도
    파일이 안 섞이게 한다."""
    cleaned = re.sub(r"[^0-9A-Za-z가-힣_\-]+", "_", material_name.strip()) or "material"
    return f"{int(class_id)}_{cleaned}.pdf"


def save_reference_pdf(
    class_id: int,
    material_name: str,
    pdf_bytes: bytes,
    *,
    page_offset: int = 0,
) -> dict[str, Any]:
    """PDF를 로컬 폴더에 저장하고 DB에 등록한다.

    같은 반 + 같은 이름으로 다시 올리면 기존 파일을 덮어쓴다(= 문제집 교체).

    page_offset [2026-08-13 추가]: 표지·목차 등이 앞에 있어서 "문제집에
    인쇄된 1페이지"가 PDF 파일의 첫 장이 아닌 경우를 보정하는 값 —
    (PDF 파일에서 인쇄된 1페이지가 위치한 장 번호) - 1. 0이면 보정 없음
    (PDF 1장 = 인쇄 1페이지, 지금까지의 기본 동작과 동일).
    """
    _ensure_table()
    import fitz  # PyMuPDF — ocr_extract.py도 이미 쓰고 있는 의존성

    material_name = material_name.strip()
    if not material_name:
        raise ValueError("문제집/프린트 이름을 입력해주세요.")
    if not pdf_bytes:
        raise ValueError("PDF 내용이 비어 있습니다.")

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        page_count = len(doc)
    finally:
        doc.close()
    if page_count < 1:
        raise ValueError("PDF에서 페이지를 찾을 수 없습니다.")

    _REFERENCE_DIR.mkdir(parents=True, exist_ok=True)
    filename = _safe_filename(class_id, material_name)
    (_REFERENCE_DIR / filename).write_bytes(pdf_bytes)

    ts = _now()
    conn = get_conn()
    try:
        conn.execute(
            """
            INSERT INTO hw_reference_materials
                (class_id, material_name, file_path, page_count, page_offset, uploaded_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (class_id, material_name) DO UPDATE
               SET file_path = EXCLUDED.file_path,
                   page_count = EXCLUDED.page_count,
                   page_offset = EXCLUDED.page_offset,
                   updated_at = EXCLUDED.updated_at
            """,
            (int(class_id), material_name, filename, page_count, int(page_offset), ts, ts),
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "class_id": int(class_id),
        "material_name": material_name,
        "page_count": page_count,
        "page_offset": int(page_offset),
    }


def update_reference_offset(class_id: int, material_name: str, page_offset: int) -> None:
    """PDF 재업로드 없이 오프셋 값만 고친다 — 이미 등록해봤는데 "어라, 밀려
    있었네" 하고 나중에 깨달았을 때 쓰는 용도."""
    _ensure_table()
    conn = get_conn()
    try:
        conn.execute(
            "UPDATE hw_reference_materials SET page_offset = ?, updated_at = ? "
            "WHERE class_id = ? AND material_name = ?",
            (int(page_offset), _now(), int(class_id), (material_name or "").strip()),
        )
        conn.commit()
    finally:
        conn.close()


def get_reference_materials(class_id: int) -> list[dict[str, Any]]:
    """이 반에 등록된 모든 참조 자료 목록(이름순)."""
    _ensure_table()
    conn = get_conn()
    try:
        rows = conn.execute(
            """
            SELECT material_name, file_path, page_count, page_offset, uploaded_at, updated_at
            FROM hw_reference_materials
            WHERE class_id = ?
            ORDER BY material_name
            """,
            (int(class_id),),
        ).fetchall()
    finally:
        conn.close()
    return [
        {
            "material_name": str(r[0]),
            "file_path": str(r[1]),
            "page_count": int(r[2] or 0),
            "page_offset": int(r[3] or 0),
            "uploaded_at": str(r[4] or ""),
            "updated_at": str(r[5] or ""),
        }
        for r in rows
    ]


def get_reference_material(class_id: int, material_name: str) -> dict[str, Any] | None:
    """반 + 이름으로 등록된 자료 하나를 찾는다(hw_items.material_name과 매칭용)."""
    _ensure_table()
    conn = get_conn()
    try:
        row = conn.execute(
            """
            SELECT material_name, file_path, page_count, page_offset
            FROM hw_reference_materials
            WHERE class_id = ? AND material_name = ?
            """,
            (int(class_id), (material_name or "").strip()),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return None
    return {
        "material_name": str(row[0]),
        "file_path": str(row[1]),
        "page_count": int(row[2] or 0),
        "page_offset": int(row[3] or 0),
    }


def delete_reference_material(class_id: int, material_name: str) -> None:
    """DB 등록과 실제 PDF 파일을 함께 지운다(문제집이 끝났을 때 사용)."""
    _ensure_table()
    material = get_reference_material(class_id, material_name)
    conn = get_conn()
    try:
        conn.execute(
            "DELETE FROM hw_reference_materials WHERE class_id = ? AND material_name = ?",
            (int(class_id), (material_name or "").strip()),
        )
        conn.commit()
    finally:
        conn.close()
    if material:
        try:
            (_REFERENCE_DIR / material["file_path"]).unlink(missing_ok=True)
        except Exception:
            pass


def get_reference_page_images(
    class_id: int,
    material_name: str,
    page_start: int,
    page_end: int,
    *,
    dpi: int = 150,
    max_candidate_pages: int = 15,
) -> list[tuple[int, bytes]]:
    """등록된 PDF에서 page_start~page_end 범위(인쇄된 페이지 번호 기준)만
    PNG로 렌더링해서 반환한다.

    [(페이지번호, PNG바이트), ...] 형태 — 페이지번호는 학생/선생님이 보는
    "인쇄된 페이지 번호"이고, PDF 파일 내 실제 장 번호와는 다를 수 있다
    (표지·목차 등으로 밀려 있는 경우 material의 page_offset으로 보정됨 —
    [2026-08-13 추가]).

    범위가 너무 넓으면(예: 통째로 낸 경우) AI 호출 이미지 수·비용이 커지므로
    max_candidate_pages로 상한을 둔다 — 넘으면 빈 리스트를 돌려줘 호출한
    쪽이 기존 텍스트 인식 방식으로 자동 폴백하게 한다.
    """
    material = get_reference_material(class_id, material_name)
    if not material:
        return []
    offset = int(material.get("page_offset", 0))

    page_start = max(1, int(page_start))
    page_end = max(page_start, int(page_end))
    if (page_end - page_start + 1) > max_candidate_pages:
        return []

    file_path = _REFERENCE_DIR / material["file_path"]
    if not file_path.exists():
        return []

    import fitz

    doc = fitz.open(str(file_path))
    images: list[tuple[int, bytes]] = []
    try:
        total = len(doc)
        for page_num in range(page_start, page_end + 1):
            # 인쇄된 페이지 번호 → PDF 파일 내 0-based 장 인덱스로 변환.
            # offset=0이면 "PDF 1장 = 인쇄 1페이지"(기존 동작과 동일).
            idx = page_num - 1 + offset
            if idx < 0 or idx >= total:
                continue
            mat = fitz.Matrix(dpi / 72, dpi / 72)
            pix = doc[idx].get_pixmap(matrix=mat, alpha=False)
            images.append((page_num, pix.tobytes("png")))
    finally:
        doc.close()
    return images


_REFERENCE_MATCH_INTRO = (
    "첫 번째 사진은 학생이 수학 문제집/프린트를 푼 뒤 찍어서 올린 인증샷입니다. "
    "이어서 같은 문제집의 실제 페이지 원본 이미지들이 '페이지 N:' 라벨과 함께 "
    "차례로 나옵니다.\n\n"
    "학생 사진이 이 페이지 원본들 중 어느 페이지와 같은 문제인지 찾아주세요. "
    "학생 사진은 각도가 기울어져 있거나(회전·거꾸로), 손으로 푼 풀이·낙서·"
    "형광펜 표시가 덧붙여져 있거나, 일부만 잘려서 찍혔을 수 있습니다 — 그런 "
    "차이는 무시하고, 인쇄된 문제 텍스트·그림·문제 번호 배치가 같은 페이지를 "
    "찾으면 됩니다.\n\n"
    "가장 일치하는 페이지의 번호만 숫자로 답하세요. 100% 확신이 없어도 가장 "
    "비슷한 페이지 번호로 답하는 쪽을 우선하세요(최종 확인은 선생님이 사진을 "
    "직접 보고 하므로, 이건 참고용 1차 판단일 뿐입니다). 어떤 페이지와도 전혀 "
    "안 비슷하다면(완전히 다른 문제집처럼 보이면) '모름'이라고만 답하세요. "
    "다른 설명은 하지 말고 숫자 하나 또는 '모름'만 출력하세요."
)


def run_ai_page_check_with_reference(
    photo_url: str,
    class_id: int,
    material_name: str,
    page_start: int,
    page_end: int,
) -> dict[str, Any] | None:
    """참조 PDF가 등록돼 있으면 사진↔페이지 이미지 대조로 페이지를 추정한다.

    참조 자료가 없거나(미등록) 범위가 너무 넓으면 None을 반환한다 — 호출한
    쪽(hw_photo_review.run_ai_page_check)이 이때 기존 텍스트 인식 방식으로
    자동 전환(fallback)한다. 반환 dict는 기존 함수와 같은 모양
    ({"guess", "flag", "message"}) + "method": "reference" 를 추가로 담는다.
    """
    candidates = get_reference_page_images(class_id, material_name, page_start, page_end)
    if not candidates:
        return None

    from ocr_extract import _build_openai_client, resolve_api_key

    api_key = resolve_api_key()
    if not api_key:
        return {
            "guess": None,
            "flag": "no_api_key",
            "message": "OPENAI_API_KEY가 설정되지 않았습니다 (.env 확인).",
            "method": "reference",
        }

    client = _build_openai_client(api_key)

    content: list[dict[str, Any]] = [
        {"type": "text", "text": _REFERENCE_MATCH_INTRO},
        {"type": "text", "text": "학생이 올린 사진:"},
        {"type": "image_url", "image_url": {"url": photo_url, "detail": "high"}},
    ]
    for page_num, png_bytes in candidates:
        b64 = base64.b64encode(png_bytes).decode("ascii")
        content.append({"type": "text", "text": f"페이지 {page_num}:"})
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{b64}", "detail": "low"},
        })

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=20,
            messages=[{"role": "user", "content": content}],
        )
        raw = (response.choices[0].message.content or "").strip()
    except Exception as e:  # noqa: BLE001
        return {"guess": None, "flag": "error", "message": f"검증 중 오류: {e}", "method": "reference"}

    digits = "".join(ch for ch in raw if ch.isdigit())
    if not digits:
        guess, flag = None, "unclear"
    else:
        guess_num = int(digits)
        guess = str(guess_num)
        flag = "match" if page_start <= guess_num <= page_end else "mismatch"

    return {"guess": guess, "flag": flag, "message": raw, "method": "reference"}


def auto_detect_page_offset(
    pdf_bytes: bytes,
    *,
    max_scan_pages: int = 15,
    dpi: int = 110,
) -> dict[str, Any]:
    """PDF 앞부분 장들을 렌더링해서, 각 장에 인쇄된 페이지 번호를 AI로 읽어
    page_offset(= 인쇄 1페이지가 위치한 PDF 장 번호 - 1)을 자동으로 추정한다.

    학생이 찍은 사진이 아니라 PDF 원본을 그대로 읽는 것이라 회전·손글씨·
    가려짐이 없어 훨씬 잘 읽힌다. 그래도 표지·목차처럼 페이지 번호가 아예
    없는 장이 섞여 있을 수 있어서, 앞부분 여러 장을 한 번에 보여주고 각각
    판독한 뒤 다수결(mode)로 최종 offset을 정한다 — 한두 장의 오독에
    흔들리지 않게 하기 위함.

    반환: {"offset": int | None, "detail": str}
      offset이 None이면 자동 감지 실패 — 호출한 쪽이 수동 입력으로 안내해야 함.
    """
    import fitz

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        total = len(doc)
        scan_n = min(total, max_scan_pages)
        page_images: list[tuple[int, bytes]] = []
        for i in range(scan_n):
            mat = fitz.Matrix(dpi / 72, dpi / 72)
            pix = doc[i].get_pixmap(matrix=mat, alpha=False)
            page_images.append((i + 1, pix.tobytes("png")))  # 1-based 파일 장 번호
    finally:
        doc.close()

    if not page_images:
        return {"offset": None, "detail": "PDF에서 페이지를 찾을 수 없습니다."}

    from ocr_extract import _build_openai_client, resolve_api_key

    api_key = resolve_api_key()
    if not api_key:
        return {"offset": None, "detail": "OPENAI_API_KEY가 설정되지 않았습니다 (.env 확인)."}

    client = _build_openai_client(api_key)

    intro = (
        f"지금부터 문제집/프린트 PDF의 앞부분 {len(page_images)}개 장을 순서대로 "
        "보여드립니다(각각 '장 N:' 라벨이 붙어 있음 — 이건 PDF 파일 자체의 장 "
        "순서이지, 문제집에 인쇄된 페이지 번호가 아닙니다). 각 장 하단(또는 상단) "
        "여백에 인쇄된 '페이지 번호'를 찾아서 읽어주세요 — 표지·목차·속표지처럼 "
        "페이지 번호가 아예 인쇄되어 있지 않은 장도 있을 수 있으니, 그런 장은 "
        "null로 표시하세요.\n\n"
        "JSON 배열로만 답하세요. 예시:\n"
        '[{"장": 1, "페이지번호": null}, {"장": 2, "페이지번호": null}, '
        '{"장": 3, "페이지번호": 1}, {"장": 4, "페이지번호": 2}]\n'
        "다른 설명 없이 이 JSON 배열만 출력하세요."
    )
    content: list[dict[str, Any]] = [{"type": "text", "text": intro}]
    for file_page, png_bytes in page_images:
        b64 = base64.b64encode(png_bytes).decode("ascii")
        content.append({"type": "text", "text": f"장 {file_page}:"})
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{b64}", "detail": "low"},
        })

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=800,
            messages=[{"role": "user", "content": content}],
        )
        raw = (response.choices[0].message.content or "").strip()
    except Exception as e:  # noqa: BLE001
        return {"offset": None, "detail": f"자동 감지 중 오류: {e}"}

    cleaned = re.sub(r"```json|```", "", raw).strip()
    try:
        data = json.loads(cleaned)
    except Exception:
        return {"offset": None, "detail": "AI 응답을 이해하지 못했습니다. 아래에서 직접 입력해주세요."}

    offsets: list[int] = []
    for item in data if isinstance(data, list) else []:
        try:
            file_page = int(item.get("장"))
            printed = item.get("페이지번호")
            if printed is None:
                continue
            printed_num = int(printed)
            if printed_num < 1:
                continue
            offsets.append(file_page - printed_num)
        except Exception:
            continue

    if not offsets:
        return {
            "offset": None,
            "detail": "인쇄된 페이지 번호를 찾지 못했습니다. 아래에서 직접 입력해주세요.",
        }

    counts = Counter(offsets)
    best_offset, best_count = counts.most_common(1)[0]
    confidence_detail = f"앞부분 {len(offsets)}개 장 중 {best_count}개가 이 결과와 일치했습니다."
    if best_count / len(offsets) < 0.5:
        return {
            "offset": None,
            "detail": f"판독이 일관되지 않습니다 ({confidence_detail}). 아래에서 직접 확인해주세요.",
        }
    return {"offset": max(0, best_offset), "detail": confidence_detail}


def render_reference_upload_section(class_id: int) -> None:
    """선생님용 UI — 이 반의 문제집/프린트 PDF를 업로드·목록·삭제한다.
    hw_assign.py에서 반을 고른 직후 호출한다.
    """
    _ensure_table()
    with st.expander(
        "📎 과제 자료 업로드 (문제집/프린트 PDF) — 선택 사항, AI 페이지 인식 정확도를 크게 높여줍니다"
    ):
        st.caption(
            "문제집/프린트 PDF를 미리 올려두면, 학생이 인증샷을 올렸을 때 AI가 "
            "손글씨/인쇄 숫자를 읽는 대신 사진을 실제 페이지 이미지와 직접 비교해서 "
            "몇 쪽인지 찾아줍니다 — 훨씬 정확합니다. 아래에서 등록하는 '문제집/프린트 "
            "이름'이 과제 항목의 이름과 정확히 같아야 자동으로 연결됩니다. 문제집이 "
            "끝나면 삭제 후 다음 문제집으로 교체하세요."
        )

        materials = get_reference_materials(class_id)
        if materials:
            st.markdown("**등록된 자료**")
            for m in materials:
                mc1, mc2 = st.columns([4, 1])
                with mc1:
                    offset_txt = (
                        f" · 인쇄 1페이지 = PDF {m['page_offset'] + 1}번째 장"
                        if m["page_offset"]
                        else ""
                    )
                    st.caption(
                        f"📄 {m['material_name']} — {m['page_count']}쪽{offset_txt} "
                        f"(업로드 {m['uploaded_at']})"
                    )
                with mc2:
                    if st.button(
                        "삭제", key=f"hwref_del_{class_id}_{m['material_name']}", width="stretch"
                    ):
                        delete_reference_material(class_id, m["material_name"])
                        st.rerun()

                # [2026-08-13 추가] 표지·목차 등 때문에 "인쇄 1페이지"가 PDF의
                # 첫 장이 아닌 경우를 나중에라도(재업로드 없이) 고칠 수 있게.
                with st.expander(f"⚙️ '{m['material_name']}' 페이지 밀림 보정", expanded=False):
                    st.caption(
                        "표지·목차 등이 앞에 있어서 '인쇄된 1페이지'가 PDF 파일 자체의 "
                        "첫 장이 아니라면 여기서 고치세요. '자동 재감지'를 누르면 AI가 "
                        "다시 읽어서 값을 채워줍니다 — 안 밀려 있으면 그대로 두면 됩니다."
                    )
                    edit_offset_key = f"hwref_offset_edit_{class_id}_{m['material_name']}"
                    if edit_offset_key not in st.session_state:
                        st.session_state[edit_offset_key] = m["page_offset"] + 1

                    if st.button(
                        "🤖 자동 재감지",
                        key=f"hwref_reautodetect_{class_id}_{m['material_name']}",
                    ):
                        file_path = _REFERENCE_DIR / m["file_path"]
                        if not file_path.exists():
                            st.warning("⚠️ 원본 PDF 파일을 찾을 수 없습니다. 다시 업로드해주세요.")
                        else:
                            with st.spinner("PDF 앞부분을 읽는 중..."):
                                detect_result = auto_detect_page_offset(file_path.read_bytes())
                            if detect_result["offset"] is not None:
                                st.session_state[edit_offset_key] = detect_result["offset"] + 1
                                st.success(f"✅ 자동 감지 완료 — {detect_result['detail']}")
                            else:
                                st.warning(f"⚠️ 자동 감지 실패: {detect_result['detail']}")

                    new_first_at = st.number_input(
                        "PDF 파일에서 '인쇄 1페이지'가 실제로 몇 번째 장인가요?",
                        min_value=1,
                        step=1,
                        key=edit_offset_key,
                    )
                    if st.button(
                        "보정값 저장",
                        key=f"hwref_offset_save_{class_id}_{m['material_name']}",
                    ):
                        update_reference_offset(class_id, m["material_name"], int(new_first_at) - 1)
                        st.success("저장했습니다. 다음 페이지 확인부터 적용됩니다.")
                        st.rerun()
        else:
            st.caption(
                "아직 등록된 자료가 없습니다. 등록 안 해도 기존 방식(사진 속 숫자 읽기)으로 "
                "그대로 동작합니다."
            )

        st.markdown("**새 자료 등록**")
        new_name = st.text_input(
            "문제집/프린트 이름 (과제 항목 이름과 똑같이 입력)",
            key=f"hwref_name_{class_id}",
            placeholder="예: 쎈 수학(상)",
        )
        uploaded_pdf = st.file_uploader("PDF 파일", type=["pdf"], key=f"hwref_file_{class_id}")

        # [2026-08-13 추가] "이 숫자를 왜 내가 직접 세어서 넣어야 하냐"는
        # 지적을 받고 자동 감지 버튼을 추가했다 — PDF 원본은 학생 사진과
        # 달리 깨끗해서(회전·손글씨 없음) AI가 페이지 번호를 훨씬 잘 읽는다.
        # 자동 감지가 값을 채워주고, 틀렸을 때만 아래에서 손으로 고치면 된다.
        offset_key = f"hwref_offset_new_{class_id}"
        if offset_key not in st.session_state:
            st.session_state[offset_key] = 1

        if uploaded_pdf and st.button(
            "🤖 페이지 번호 자동 감지 (추천)", key=f"hwref_autodetect_{class_id}"
        ):
            with st.spinner("PDF 앞부분을 읽는 중..."):
                detect_result = auto_detect_page_offset(uploaded_pdf.getvalue())
            if detect_result["offset"] is not None:
                st.session_state[offset_key] = detect_result["offset"] + 1
                st.success(f"✅ 자동 감지 완료 — {detect_result['detail']} 아래 숫자를 확인해보세요.")
            else:
                st.warning(f"⚠️ 자동 감지 실패: {detect_result['detail']}")

        first_page_at = st.number_input(
            "PDF 파일에서 '인쇄된 1페이지'가 실제로 몇 번째 장인가요?",
            min_value=1,
            step=1,
            key=offset_key,
            help=(
                "위 '자동 감지' 버튼을 누르면 AI가 이 값을 채워줍니다. 표지·목차 "
                "등이 PDF 앞부분에 있으면, 문제집에 인쇄된 '1페이지'가 PDF 파일의 "
                "첫 장이 아닐 수 있습니다(예: 표지 1장 + 목차 2장 뒤에 1페이지가 "
                "나오면 '4'). 자동 감지가 안 되거나 틀렸으면 여기서 직접 고치세요 — "
                "등록 후에도 아래 '등록된 자료'에서 나중에 고칠 수 있습니다."
            ),
        )
        if st.button("업로드", key=f"hwref_upload_{class_id}"):
            if not new_name.strip():
                st.error("문제집/프린트 이름을 입력해주세요.")
            elif not uploaded_pdf:
                st.error("PDF 파일을 선택해주세요.")
            else:
                try:
                    result = save_reference_pdf(
                        class_id,
                        new_name,
                        uploaded_pdf.getvalue(),
                        page_offset=int(first_page_at) - 1,
                    )
                    st.success(f"✅ '{result['material_name']}' 등록 완료 ({result['page_count']}쪽)")
                    st.rerun()
                except Exception as e:  # noqa: BLE001
                    st.error(f"업로드 실패: {e}")
