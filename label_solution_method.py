"""question_bank 문제에 "풀이 기법(solution_label)" 라벨을 붙이는 스크립트.

관련 계획: PLAN_문제은행_유사문제매칭.md 의 "② 문제은행에 풀이유형 라벨 채우기" 단계.

왜 필요한가
-----------
지금 question_bank의 topic("[중3] 삼각비" 등)은 큰 단원 이름일 뿐이라, 같은 단원 안에도
풀이 방법이 전혀 다른 문제가 섞여 있다(예: "수선의 발을 이용한 닮음" vs "중선의 성질" vs
"일반 선분+피타고라스" — 겉모습은 비슷해 보여도 푸는 방법은 다름). 이 스크립트는 문제
이미지 + 해설 이미지를 GPT-4o-mini에게 보여주고, 실제로 어떤 풀이 기법을 쓰는지 짧은
라벨로 요약해서 question_bank.solution_label 컬럼에 저장한다.

실행 전 준비 (한 번만)
-----------------------
1. Supabase SQL Editor에서 아래 컬럼이 이미 추가되어 있어야 함 (2026-07-25 완료 확인됨):
     ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS solution_label TEXT DEFAULT '';
2. .env 파일에 OPENAI_API_KEY 가 이미 등록되어 있어야 함 (OCR용으로 이미 등록돼 있음).

실행 방법 (CMD에서, zokbo_import.py 돌리던 것과 동일한 방식)
------------------------------------------------------------
    cd /d "G:\app 개발\Academy-Manager\Academy-Manager\streamlit-app"

    # 1) 먼저 5문항만 테스트 (비용 거의 0원, 결과 확인용)
    python label_solution_method.py --limit 5

    # 2) 문제 없으면 삼각비 전체(약 1,501문항) 라벨링
    python label_solution_method.py

다시 실행해도 이미 라벨이 붙은 문항은 건너뛰므로(재개 가능), 중간에 멈춰도 안전합니다.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from dotenv import load_dotenv

# zokbo_import.py / wake_db.py 와 동일한 이유: 단독 실행 시 .env가 자동으로 안 읽힘.
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

_MODULE_DIR = os.path.dirname(os.path.abspath(__file__))
_DATA_DIR = os.path.join(_MODULE_DIR, "data")

# 이번 파일럿 대상: 삼각비 단원 4개 소단원 (총 약 1,501문항).
# 나중에 다른 단원으로 넓힐 땐 이 리스트만 바꾸거나 --topics 옵션으로 넘기면 됨.
DEFAULT_TOPICS = [
    "[중3] 삼각비",
    "[중3] 삼각비의 값",
    "[중3] 길이 구하기",
    "[중3] 넓이 구하기",
]

MODEL = "gpt-4o-mini"

# 2026-07 기준 OpenAI 공개 단가 (달러/100만 토큰). 나중에 가격이 바뀌면 이 값만 수정.
PRICE_PER_1M_INPUT = 0.15
PRICE_PER_1M_OUTPUT = 0.60

SYSTEM_PROMPT = """당신은 중학교 수학 문제은행을 정리하는 조교입니다.
주어진 문제 이미지와 해설 이미지를 보고, 이 문제를 실제로 풀 때 사용하는
"구체적인 풀이 기법"을 10~15자 내외의 한국어 명사구 한 줄로 요약하세요.

규칙:
- "삼각비를 이용한다", "직각삼각형 문제" 처럼 너무 일반적인 설명은 금지합니다.
  같은 단원 안에도 실제 풀이 방법이 다르면 서로 다른 라벨을 붙여야 합니다.
- 문제만 보지 말고 해설 이미지를 같이 보고, 실제로 어떤 성질/공식/구조를 썼는지
  파악해서 쓰세요.
- 아래는 참고용 예시 라벨입니다 (그대로 써도 되고, 더 적절한 표현이 있으면 새로
  만들어도 됩니다):
  수선의 발(고도)-닮음삼각형, 중선/중점 활용, 일반 선분+피타고라스, 각의 이등분선,
  겹친 도형의 넓이, 삼각비 표 활용, 특수각(30·45·60도) 계산,
  삼각비 항등식(sin²+cos²=1 등), 좌표평면 직선의 기울기, 원에 내접한 삼각형,
  원과 접선, 입체도형 대각선/단면, 이등변삼각형의 성질, 정다각형의 넓이,
  사분원/부채꼴 활용

반드시 다음 JSON 형식으로만 답하세요: {"label": "라벨 텍스트"}
"""


def _resolve_api_key() -> str:
    return os.environ.get("OPENAI_API_KEY", "").strip()


def _build_client():
    import openai

    api_key = _resolve_api_key()
    if not api_key:
        print(
            "[오류] .env 파일에 OPENAI_API_KEY가 없습니다. "
            "OCR 기능이 이미 동작 중이면 같은 키가 등록돼 있을 텐데 확인해 주세요.",
            file=sys.stderr,
        )
        sys.exit(1)
    return openai.OpenAI(api_key=api_key)


def _to_data_uri(rel_path: str) -> str:
    """question_image_path("question_bank_images/xxx.png") -> base64 data URI.

    student_report_pdf.py의 _image_to_data_uri와 동일한 경로 규칙(_DATA_DIR 기준).
    """
    full_path = os.path.join(_DATA_DIR, rel_path)
    with open(full_path, "rb") as f:
        raw = f.read()
    ext = os.path.splitext(full_path)[1].lower().lstrip(".") or "png"
    mime = "jpeg" if ext in ("jpg", "jpeg") else ext
    b64 = base64.b64encode(raw).decode("ascii")
    return f"data:image/{mime};base64,{b64}"


def fetch_targets(topics: list[str], limit: int | None) -> list[dict[str, Any]]:
    from database import ensure_question_bank_extended
    from db_connect import get_conn

    ensure_question_bank_extended()
    conn = get_conn()
    placeholders = ",".join("?" * len(topics))
    sql = f"""
        SELECT id, question_image_path, explanation_image_path
        FROM question_bank
        WHERE topic IN ({placeholders})
          AND (solution_label IS NULL OR TRIM(solution_label) = '')
          AND question_image_path != ''
        ORDER BY id
    """
    if limit:
        sql += f" LIMIT {int(limit)}"
    rows = conn.execute(sql, topics).fetchall()
    return [
        {"id": r[0], "question_image_path": r[1], "explanation_image_path": r[2]}
        for r in rows
    ]


def label_one(client, row: dict[str, Any], *, retries: int = 2) -> dict[str, Any]:
    """API 1회 호출 -> {"id", "label", "prompt_tokens", "completion_tokens"} 또는 {"id", "error"}."""
    row_id = row["id"]
    try:
        q_uri = _to_data_uri(row["question_image_path"])
        a_uri = (
            _to_data_uri(row["explanation_image_path"])
            if row["explanation_image_path"]
            else None
        )
    except OSError as e:
        return {"id": row_id, "error": f"이미지 파일을 못 읽음: {e}"}

    content: list[dict[str, Any]] = [
        {"type": "text", "text": "[문제 이미지]"},
        {"type": "image_url", "image_url": {"url": q_uri}},
    ]
    if a_uri:
        content.append({"type": "text", "text": "[해설 이미지]"})
        content.append({"type": "image_url", "image_url": {"url": a_uri}})

    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            response = client.chat.completions.create(
                model=MODEL,
                max_tokens=60,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": content},
                ],
            )
            raw = response.choices[0].message.content or "{}"
            parsed = json.loads(raw)
            label = str(parsed.get("label", "")).strip()[:40]
            if not label:
                raise ValueError("빈 라벨 응답")
            usage = response.usage
            return {
                "id": row_id,
                "label": label,
                "prompt_tokens": getattr(usage, "prompt_tokens", 0) or 0,
                "completion_tokens": getattr(usage, "completion_tokens", 0) or 0,
            }
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
    return {"id": row_id, "error": repr(last_err)}


def save_label(row_id: int, label: str) -> None:
    from db_connect import get_conn

    conn = get_conn()
    conn.execute(
        "UPDATE question_bank SET solution_label = ? WHERE id = ?",
        (label, row_id),
    )


def run(topics: list[str], limit: int | None, workers: int) -> None:
    targets = fetch_targets(topics, limit)
    total = len(targets)
    if total == 0:
        print("라벨링할 문항이 없습니다 (이미 다 라벨링됐거나 대상이 없음).")
        return

    print(f"대상 문항 {total}건 (단원: {', '.join(topics)})")
    print(f"모델: {MODEL} / 동시 실행: {workers}개\n")

    client = _build_client()
    done = 0
    errors: list[tuple[int, str]] = []
    total_prompt_tokens = 0
    total_completion_tokens = 0

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(label_one, client, row): row for row in targets}
        for fut in as_completed(futures):
            result = fut.result()
            done += 1
            if "error" in result:
                errors.append((result["id"], result["error"]))
            else:
                save_label(result["id"], result["label"])
                total_prompt_tokens += result["prompt_tokens"]
                total_completion_tokens += result["completion_tokens"]
            if done % 10 == 0 or done == total:
                print(f"  {done}/{total} 처리 완료 (실패 {len(errors)}건)")

    cost = (
        total_prompt_tokens / 1_000_000 * PRICE_PER_1M_INPUT
        + total_completion_tokens / 1_000_000 * PRICE_PER_1M_OUTPUT
    )
    print(f"\n완료: {total - len(errors)}건 라벨링, 실패 {len(errors)}건")
    print(
        f"토큰 사용량: 입력 {total_prompt_tokens:,} / 출력 {total_completion_tokens:,}"
    )
    print(f"예상 비용: 약 ${cost:.3f} (환율 1,400원 기준 약 {cost * 1400:.0f}원)")
    if errors:
        print("\n실패 목록 (다시 실행하면 이 문항들만 재시도됩니다):")
        for row_id, err in errors[:20]:
            print(f"  id={row_id}: {err}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="question_bank 풀이유형 라벨링")
    parser.add_argument(
        "--limit", type=int, default=None, help="테스트용으로 N문항만 처리"
    )
    parser.add_argument(
        "--workers", type=int, default=4, help="동시 API 호출 개수 (기본 4)"
    )
    parser.add_argument(
        "--topics",
        type=str,
        default=None,
        help="쉼표로 구분한 topic 목록 (기본값: 삼각비 4개 소단원)",
    )
    args = parser.parse_args()

    topic_list = (
        [t.strip() for t in args.topics.split(",")] if args.topics else DEFAULT_TOPICS
    )
    run(topic_list, args.limit, args.workers)
