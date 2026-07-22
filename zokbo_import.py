"""족보닷컴 "[수준별_기본/발전/최다오답/최다빈출]" 형식 PDF → question_bank 자동 등록.

설계 원칙 (PLAN_문제은행_유사문제매칭.md 참고):
- 학생에게 다시 보여줄 실제 내용은 OCR 텍스트가 아니라 **원본에서 잘라낸 이미지**로 저장한다.
  문제 번호("1." "2." ...)는 일반 폰트라 위치를 정확히 잡을 수 있지만, 수식 자체는 이미지처럼
  렌더링돼 있어서 OCR을 거치면 깨진다 — 그래서 아예 OCR 없이 위치 계산만으로 자른다.
- question(텍스트) 컬럼은 검색/식별용 짧은 설명만 채우고, 실제 내용은 question_image_path가 담당한다.

자료 형식별 등록기(adapter) 패턴의 첫 구현체. 나중에 다른 형식(숨마쿰라우데류 개념서 등)이
추가되면 별도 모듈로 만들고, 이 모듈처럼 "파일 하나 -> row 리스트" 인터페이스만 맞추면 된다.
"""
from __future__ import annotations

import os
import re
from typing import Any

import fitz

from topics_curriculum import ALL_TOPIC_OPTIONS, UNCLASSIFIED

_MODULE_DIR = os.path.dirname(os.path.abspath(__file__))
IMAGE_DIR = os.path.join(_MODULE_DIR, "data", "question_bank_images")

FILENAME_RE = re.compile(
    r'^\[수준별_(?P<tier>[^\]]+)\]\s*(?:(?P<style>\S*유형)\s+)?'
    r'(?P<code>\d+(?:-\d+)*)\.\s*(?P<unit>.+?)\s*_\s*(?P<grade>중\d)\s*수학\s*'
    r'\((?P<round>\d+)회\)\s*\[(?P<count>\d+)문제\]\s*\[(?P<qtype>[A-Za-z])\]\.pdf$'
)
Q_MARKER_RE = re.compile(r'^(\d{1,3})\.$')
A_MARKER_RE = re.compile(r'^(\d{1,3})\)\s*\[정답\]\s*(.*)$')

# 폴더/파일명의 등급(기본/발전/최다오답/최다빈출) -> DB 난이도(High/Mid/Low).
# 근거(원장님 확인): 기본≈최다빈출 (쉬움), 발전≈최다오답 (그보다 어려움).
TIER_DIFFICULTY = {
    "기본": "Low",
    "최다빈출": "Low",
    "발전": "Mid",
    "최다오답": "Mid",
}

PAGE_W = 595.2
PAGE_H = 841.92
SPLIT_X = PAGE_W / 2
TOP_MARGIN = 55
BOTTOM_MARGIN = 60
PAD_TOP = 8
ZOOM = 2.5


def parse_filename(filename: str) -> dict[str, Any]:
    m = FILENAME_RE.match(filename)
    if not m:
        raise ValueError(f"족보닷컴 [수준별] 형식이 아닙니다: {filename}")
    d = m.groupdict()
    d["count"] = int(d["count"])
    d["round"] = int(d["round"])
    d["style"] = d["style"] or "기본"
    d["unit"] = d["unit"].strip()
    return d


def difficulty_for_tier(tier: str) -> str:
    """파일명 속 등급(기본/발전/최다오답/최다빈출) 문자열 -> High/Mid/Low."""
    for key, val in TIER_DIFFICULTY.items():
        if key in tier:
            return val
    return "Mid"


def match_topic(grade: str, unit_raw: str) -> str:
    """단원 원문 -> 고정 태그("[학년] 소단원명"). 정확히 안 맞으면 미분류로 남김."""
    unit_raw = unit_raw.strip()
    exact = f"[{grade}] {unit_raw}"
    if exact in ALL_TOPIC_OPTIONS:
        return exact
    same_grade = [o for o in ALL_TOPIC_OPTIONS if o.startswith(f"[{grade}]")]
    candidates = [o for o in same_grade if unit_raw in o]
    if len(candidates) == 1:
        return candidates[0]
    return UNCLASSIFIED


def _find_markers(page, pattern) -> list[tuple[re.Match, tuple[float, float, float, float]]]:
    d = page.get_text("dict")
    out = []
    for block in d["blocks"]:
        if "lines" not in block:
            continue
        for line in block["lines"]:
            text = "".join(s["text"] for s in line["spans"]).strip()
            m = pattern.match(text)
            if m:
                out.append((m, line["bbox"]))
    return out


def _crop_by_markers(doc, page_indices, marker_pattern, expected_count):
    """번호 마커 위치로 문항별 잘라낼 사각형을 계산 (2단 레이아웃 가정)."""
    results: dict[int, tuple[int, "fitz.Rect", str | None]] = {}
    for page_idx in page_indices:
        if len(results) >= expected_count:
            break
        page = doc[page_idx]
        found = _find_markers(page, marker_pattern)
        if not found:
            continue
        left = sorted([(m, b) for m, b in found if b[0] < SPLIT_X], key=lambda t: t[1][1])
        right = sorted([(m, b) for m, b in found if b[0] >= SPLIT_X], key=lambda t: t[1][1])
        for col, x0, x1 in [(left, 30, SPLIT_X - 5), (right, SPLIT_X + 5, PAGE_W - 20)]:
            for i, (m, bbox) in enumerate(col):
                num = int(m.group(1))
                y0 = max(bbox[1] - PAD_TOP, TOP_MARGIN)
                y1 = (col[i + 1][1][1] - 4) if i + 1 < len(col) else (PAGE_H - BOTTOM_MARGIN)
                rect = fitz.Rect(x0, y0, x1, y1)
                extra = m.group(2) if m.lastindex and m.lastindex >= 2 else None
                results[num] = (page_idx, rect, extra)
    return results


def _safe_stem(filename: str) -> str:
    stem = os.path.splitext(filename)[0]
    stem = re.sub(r'[\[\]]', '', stem)
    stem = re.sub(r'[<>:"/\\|?*]', '_', stem)
    stem = re.sub(r'\s+', '_', stem.strip())
    return stem[:80]


def process_file(pdf_path: str, *, image_dir: str = IMAGE_DIR) -> list[dict[str, Any]]:
    """PDF 한 개 -> bulk_insert_question_bank에 바로 넣을 수 있는 row 리스트.

    이미지 파일은 image_dir(기본: data/question_bank_images)에 저장하고,
    DB에는 image_dir 기준 상대경로만 저장한다 (나중에 클라우드로 옮길 때 이 부분만 바꾸면 됨).
    """
    filename = os.path.basename(pdf_path)
    meta = parse_filename(filename)
    doc = fitz.open(pdf_path)
    n_pages = len(doc)
    count = meta["count"]

    q_results = _crop_by_markers(doc, range(n_pages), Q_MARKER_RE, count)
    last_q_page = max((p for p, _, _ in q_results.values()), default=0)
    a_results = _crop_by_markers(doc, range(last_q_page, n_pages), A_MARKER_RE, count)

    missing_q = [n for n in range(1, count + 1) if n not in q_results]
    missing_a = [n for n in range(1, count + 1) if n not in a_results]
    if missing_q or missing_a:
        doc.close()
        raise ValueError(
            f"{filename}: 문제/해설 자르기 실패 (문제 누락 {missing_q}, 해설 누락 {missing_a})"
        )

    os.makedirs(image_dir, exist_ok=True)
    stem = _safe_stem(filename)
    mat = fitz.Matrix(ZOOM, ZOOM)

    topic = match_topic(meta["grade"], meta["unit"])
    difficulty = difficulty_for_tier(meta["tier"])
    workbook_name = f"{meta['unit']} ({meta['style']}, {meta['round']}회)"

    rows: list[dict[str, Any]] = []
    for qnum in range(1, count + 1):
        q_page, q_rect, _ = q_results[qnum]
        a_page, a_rect, answer_letter = a_results[qnum]

        q_img_name = f"{stem}__q{qnum:02d}.png"
        a_img_name = f"{stem}__a{qnum:02d}.png"
        doc[q_page].get_pixmap(matrix=mat, clip=q_rect).save(os.path.join(image_dir, q_img_name))
        doc[a_page].get_pixmap(matrix=mat, clip=a_rect).save(os.path.join(image_dir, a_img_name))

        rows.append({
            "question_number": qnum,
            "topic": topic,
            "difficulty": difficulty,
            "question": f"[{meta['grade']}] {meta['unit']} {meta['round']}회 {qnum}번 (이미지 문제)",
            "answer": (answer_letter or "").strip(),
            "explanation": "",  # 해설은 이미지로만 보존 (explanation_image_path)
            "question_image_path": f"question_bank_images/{q_img_name}",
            "explanation_image_path": f"question_bank_images/{a_img_name}",
            "source_workbook": workbook_name,
            "page_number": q_page + 1,
            "source_format": "zokbo",
        })

    doc.close()
    return rows


def import_folder(
    folder_path: str,
    *,
    limit: int | None = None,
    dry_run: bool = False,
    progress_every: int = 10,
) -> dict[str, Any]:
    """폴더 안 족보닷컴 PDF 전체를 처리해서 DB에 저장.

    dry_run=True 면 DB에 안 넣고 몇 문항이 만들어지는지만 확인 (실제 저장 전 검증용).
    """
    files = sorted(f for f in os.listdir(folder_path) if f.lower().endswith(".pdf"))
    if limit:
        files = files[:limit]

    all_rows: list[dict[str, Any]] = []
    errors: list[tuple[str, str]] = []
    for i, f in enumerate(files):
        try:
            rows = process_file(os.path.join(folder_path, f))
            all_rows.extend(rows)
        except Exception as e:  # noqa: BLE001
            errors.append((f, repr(e)))
        if (i + 1) % progress_every == 0:
            print(f"  {i + 1}/{len(files)} 처리 완료 (누적 문항 {len(all_rows)}개)")

    print(f"총 {len(files)}개 파일 처리, 문항 {len(all_rows)}개 생성, 실패 {len(errors)}개")
    for f, e in errors[:20]:
        print("  실패:", f, e)

    if dry_run:
        return {"rows": all_rows, "errors": errors}

    from database import bulk_insert_question_bank  # 지연 import (실제 DB 연결 필요)

    inserted = bulk_insert_question_bank(all_rows)
    print(f"DB 저장 완료: {inserted}건")
    return {"rows": all_rows, "errors": errors, "inserted": inserted}


if __name__ == "__main__":
    import sys

    folder = sys.argv[1] if len(sys.argv) > 1 else "."
    dry = "--dry-run" in sys.argv
    import_folder(folder, dry_run=dry)
