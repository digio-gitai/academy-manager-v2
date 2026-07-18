"""Similar-question lookup from ``question_bank`` (workbook OCR DB)."""

from __future__ import annotations

from typing import Any

from database import fetch_similar_questions_from_bank, get_question_bank_stats
from pdf_math_render import clean_math_text

SIMILAR_DB_UNAVAILABLE_MSG = (
    "문제은행에 등록된 유사문제가 없습니다. 「문제 은행」 탭에서 문제집을 등록해 주세요."
)


def _print_debug(line: str) -> None:
    text = f"[similar-q] {line}"
    try:
        print(text, flush=True)
    except UnicodeEncodeError:
        import sys
        sys.stdout.buffer.write((text + "\n").encode("utf-8", errors="replace"))
        sys.stdout.flush()


def fetch_similar_questions_for_wrong_numbers(
    *,
    wrong_numbers: list[int],
    topic_by_number: dict[int, dict[str, str]] | None = None,
    count_per_question: int = 1,
    test_id: int | None = None,
    debug: bool = True,
) -> dict[str, Any]:
    """Return similar questions from ``question_bank`` for each wrong number."""
    topic_by_number = topic_by_number or {}
    count_per_question = max(1, min(int(count_per_question), 3))
    _ = test_id  # reserved for future source-test filtering

    debug_logs: list[str] = []
    if debug:
        stats = get_question_bank_stats()
        debug_logs.append(
            f"=== 유사문제 추출 시작 (오답 {len(wrong_numbers)}문항 × {count_per_question}개) ==="
        )
        debug_logs.append(
            f"문제은행 현황: 총 {stats['total']}건 · "
            f"단원 {len(stats['topics'])}종 · DB={stats['db_path']}"
        )
        if stats["topics"]:
            top3 = list(stats["topics"].items())[:5]
            debug_logs.append(f"  등록 단원 샘플: {top3}")
        if stats["levels"]:
            debug_logs.append(f"  등록 난이도 분포: {stats['levels']}")
        if stats["invalid_level_count"] or stats["empty_topic_count"]:
            debug_logs.append(
                f"   무결성: invalid_level={stats['invalid_level_count']}, "
                f"empty_topic={stats['empty_topic_count']}"
            )
        for line in debug_logs:
            _print_debug(line)

    items: list[dict[str, Any]] = []
    used_problem_ids: set[int] = set()
    any_found = False

    for num in sorted({int(n) for n in wrong_numbers if int(n) > 0}):
        meta = topic_by_number.get(num, {})
        topic = str(meta.get("topic") or "미분류").strip() or "미분류"
        difficulty = str(meta.get("difficulty") or "Mid").strip() or "Mid"

        if debug:
            header = f"--- {num}번 오답: 단원={topic!r}, 난이도={difficulty} ---"
            debug_logs.append(header)
            _print_debug(header)

        similar_problems: list[dict[str, Any]] = []

        for pick_idx in range(count_per_question):
            batch = fetch_similar_questions_from_bank(
                topic=topic,
                difficulty=difficulty,
                limit=1,
                exclude_ids=used_problem_ids,
                debug_logs=debug_logs if debug else None,
            )
            if not batch:
                if debug:
                    msg = f"{num}번: 유사문제 {pick_idx + 1} — 매칭 0건"
                    debug_logs.append(msg)
                    _print_debug(msg)
                break
            prob = batch[0]
            pid = prob.get("problem_id")
            if pid is not None:
                used_problem_ids.add(int(pid))
            similar_problems.append({
                "problem_id": prob.get("problem_id"),
                "stem": prob.get("stem", ""),
                "answer": prob.get("answer", ""),
                "explanation": prob.get("explanation", ""),
                "matched_topic": prob.get("topic", ""),
                "matched_difficulty": prob.get("difficulty", ""),
            })
            any_found = True
            if debug:
                msg = (
                    f"{num}번: 유사문제 {pick_idx + 1} - ID={pid}, "
                    f"단원={prob.get('topic')!r}, 난이도={prob.get('difficulty')}"
                )
                debug_logs.append(msg)
                _print_debug(msg)

        items.append({
            "question_number": num,
            "topic": topic,
            "difficulty": difficulty,
            "similar_problems": similar_problems,
        })

    if debug:
        summary = f"=== 유사문제 추출 완료: {'성공'if any_found else '매칭 실패'} ==="
        debug_logs.append(summary)
        _print_debug(summary)

    if not items:
        return {
            "status": "empty",
            "message": "오답 문항이 없습니다.",
            "count_per_question": count_per_question,
            "wrong_numbers": [],
            "items": [],
            "debug_logs": debug_logs,
        }

    return {
        "status": "ok" if any_found else "db_not_ready",
        "message": "" if any_found else SIMILAR_DB_UNAVAILABLE_MSG,
        "count_per_question": count_per_question,
        "wrong_numbers": [it["question_number"] for it in items],
        "items": items,
        "debug_logs": debug_logs,
    }


def flatten_similar_items_for_pdf(extract_result: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Flatten ``fetch_similar_questions_for_wrong_numbers`` result for PDF rendering."""
    if not extract_result or extract_result.get("status") != "ok":
        return []
    flat: list[dict[str, Any]] = []
    for item in extract_result.get("items") or []:
        wrong_num = int(item.get("question_number") or 0)
        for idx, prob in enumerate(item.get("similar_problems") or [], start=1):
            stem = str(prob.get("stem") or "").strip()
            if not stem:
                continue
            flat.append({
                "related_wrong_number": wrong_num,
                "index": idx,
                "stem": stem,
                "answer": str(prob.get("answer") or "").strip(),
                "explanation": str(prob.get("explanation") or "").strip(),
                "topic": str(
                    prob.get("matched_topic") or item.get("topic") or "미분류"
                ).strip(),
                "difficulty": str(
                    prob.get("matched_difficulty") or item.get("difficulty") or "Mid"
                ).strip(),
                "problem_id": prob.get("problem_id"),
            })
    return flat


def clean_similar_question_item(item: dict[str, Any]) -> dict[str, Any]:
    """Clean LaTeX + line breaks in one similar-question record for PDF display."""
    return {
        **item,
        "stem": clean_math_text(str(item.get("stem") or "")),
        "answer": clean_math_text(str(item.get("answer") or "")),
        "explanation": clean_math_text(str(item.get("explanation") or "")),
    }


def prepare_similar_items_for_pdf(
    extract_result: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Extract → flatten → clean LaTeX for PDF rendering."""
    flat = flatten_similar_items_for_pdf(extract_result)
    prepared = [clean_similar_question_item(it) for it in flat]
    status = extract_result.get("status") if isinstance(extract_result, dict) else None
    print(
        f"[similar-q] prepare_similar_items_for_pdf: "
        f"status={status!r} flat={len(flat)} prepared={len(prepared)}",
        flush=True,
    )
    return prepared


def prepare_similar_items_for_weasy(
    extract_result: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Flatten extract result; keep LaTeX intact for WeasyPrint + SVG math."""
    flat = flatten_similar_items_for_pdf(extract_result)
    print(
        f"[similar-q] prepare_similar_items_for_weasy: flat={len(flat)} (LaTeX preserved)",
        flush=True,
    )
    return flat


def prepare_similar_items_list(
    items: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Clean an already-flattened similar-question list."""
    out = [
        clean_similar_question_item(it)
        for it in (items or [])
        if str(it.get("stem") or "").strip()
    ]
    print(
        f"[similar-q] prepare_similar_items_list: input={len(items or [])} output={len(out)}",
        flush=True,
    )
    return out
