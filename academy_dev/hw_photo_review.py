"""abc 과제 인증 — 제출 사진 검증 (2026-08-11 추가).

배경: 지금까지는 "오늘 신고한 페이지 수 = 올린 사진 장수"만 기계적으로
맞춰봤을 뿐, 사진 속에 실제로 몇 쪽이 찍혀 있는지는 전혀 확인하지
않았다. 그래서 학생이 1~4쪽을 해야 하는데 21~24쪽 사진을 올리고 "다
했어요"라고 해도 시스템은 못 걸러냈다(사용자가 실사용 관점에서 직접
지적한 허점). 이 모듈은 2단 장치로 이 문제를 보완한다.

  1. GPT-4o Vision이 사진 속에 손으로 적힌 페이지번호를 1차로 읽어서,
     그 항목의 페이지 범위(page_start~page_end) 밖이면 "⚠️ 불일치 의심"
     배지를 붙인다. 어디까지나 참고용이다 — 손글씨 오인식 가능성이 있고,
     페이지 번호가 학생 풀이 내용에 가려서 안 보일 수도 있다(사용자가
     직접 지적한 리스크).
  2. 최종 판단은 항상 선생님 몫이다 — 사진을 화면에서 직접 보고
     "✅ 선생님 확인" 버튼을 눌러야 그 사진이 확인된 것으로 기록된다.
     AI가 "일치"라고 판단해도 그것만으로 자동 확정되지 않는다.

⚠️ 완전히 새로 추가된 모듈입니다. hw_assign.py / hw_upload.py / database.py의
   기존 함수는 하나도 수정하지 않았습니다(database.py에는 hw_photos에 새
   컬럼 4개를 추가하는 마이그레이션만 더했습니다 — ensure_hw_tables() 참고).

Public API:
  - get_photos(item_submission_id) -> list[dict]
  - run_ai_page_check(photo_id, photo_url, page_start, page_end) -> dict
  - mark_teacher_verified(photo_id, verified=True) -> None
  - render_photo_review(assignment_id, submission_id, student_name) -> None
"""

from __future__ import annotations

import base64
from datetime import datetime

import streamlit as st

from database import ensure_hw_tables
from db_connect import get_conn
from hw_upload import get_items_with_state


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def get_photos(item_submission_id: int) -> list[dict]:
    """이 항목 제출 건에 딸린 사진들(여러 날짜에 걸쳐 누적될 수 있음)을 가져온다."""
    ensure_hw_tables()
    conn = get_conn()
    rows = conn.execute(
        """
        SELECT id, photo_url, uploaded_at, ai_page_guess, ai_flag,
               teacher_verified, teacher_verified_at
        FROM hw_photos
        WHERE item_submission_id = ?
        ORDER BY uploaded_at, id
        """,
        (item_submission_id,),
    ).fetchall()
    conn.close()
    return [
        {
            "id": int(r[0]),
            "photo_url": r[1],
            "uploaded_at": r[2],
            "ai_page_guess": r[3],
            "ai_flag": r[4],
            "teacher_verified": bool(r[5]),
            "teacher_verified_at": r[6],
        }
        for r in rows
    ]


def _data_uri_to_bytes(data_uri: str) -> bytes:
    if "," in data_uri:
        data_uri = data_uri.split(",", 1)[1]
    return base64.b64decode(data_uri)


_PAGE_CHECK_PROMPT = (
    "이 사진은 학생이 수학 문제집/프린트를 푼 뒤 제출한 인증샷입니다. "
    "이 문제집/프린트에 '인쇄되어' 있는 페이지 번호를 찾아서 숫자만 답하세요. "
    "페이지 번호는 보통 학생이 손으로 쓴 숫자가 아니라, 인쇄소에서 찍어낸 작은 "
    "활자로 되어 있고, 페이지 맨 아래쪽(하단)에 있습니다 — 하단 왼쪽 구석, "
    "하단 정중앙, 하단 오른쪽 구석 이 세 위치를 특히 꼼꼼히 확인하세요. "
    "이 '인쇄된 하단 페이지 번호'를 최우선으로 찾아서 답하세요. "
    "하단에 인쇄된 번호가 정말 안 보일 때만, 학생이 손으로 적어둔 페이지 "
    "번호가 있는지 참고하세요(이 경우는 확신이 낮으면 쓰지 마세요). "
    "여러 페이지가 한 사진에 보이면 가장 명확하게 읽히는 인쇄 번호 하나만 "
    "고르세요. 페이지 번호가 안 보이거나 확신할 수 없으면 반드시 '모름'이라고만 "
    "답하세요. 다른 설명 없이 숫자 하나 또는 '모름'만 출력하세요."
)


def run_ai_page_check(photo_id: int, photo_url: str, page_start: int, page_end: int) -> dict:
    """GPT-4o Vision으로 사진 속 페이지번호를 1차로 읽어서 항목 범위 안인지
    확인하고 결과를 hw_photos에 기록한다.

    ocr_extract.py가 이미 같은 방식(GPT-4o Vision, base64 data URI)으로
    시험지 OCR을 하고 있어서 그 helper(resolve_api_key, _build_openai_client)를
    그대로 재사용한다 — 새 API 키·새 인프라 필요 없음.

    반환값의 "flag"는 참고용 배지일 뿐 확정이 아니다 — 최종 확인은 선생님이
    mark_teacher_verified()로 직접 눌러야 한다.
    """
    from ocr_extract import _build_openai_client, resolve_api_key

    ensure_hw_tables()
    api_key = resolve_api_key()
    if not api_key:
        return {
            "guess": None,
            "flag": "no_api_key",
            "message": "OPENAI_API_KEY가 설정되지 않았습니다 (.env 확인).",
        }

    client = _build_openai_client(api_key)
    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=20,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": _PAGE_CHECK_PROMPT},
                    {"type": "image_url", "image_url": {"url": photo_url}},
                ],
            }],
        )
        raw = (response.choices[0].message.content or "").strip()
    except Exception as e:  # noqa: BLE001
        return {"guess": None, "flag": "error", "message": f"검증 중 오류: {e}"}

    digits = "".join(ch for ch in raw if ch.isdigit())
    if not digits:
        guess, flag = None, "unclear"
    else:
        guess_num = int(digits)
        guess = str(guess_num)
        flag = "match" if page_start <= guess_num <= page_end else "mismatch"

    conn = get_conn()
    conn.execute(
        "UPDATE hw_photos SET ai_page_guess = ?, ai_flag = ? WHERE id = ?",
        (guess, flag, photo_id),
    )
    conn.commit()
    conn.close()
    return {"guess": guess, "flag": flag, "message": raw}


def mark_teacher_verified(photo_id: int, verified: bool = True) -> None:
    """선생님이 사진을 직접 보고 확인했다고 기록한다 — 이 함수가 호출돼야만
    '확인됨' 상태가 된다(AI 판정만으로는 절대 자동으로 확정되지 않음)."""
    ensure_hw_tables()
    conn = get_conn()
    conn.execute(
        "UPDATE hw_photos SET teacher_verified = ?, teacher_verified_at = ? WHERE id = ?",
        (verified, _now() if verified else None, photo_id),
    )
    conn.commit()
    conn.close()


_FLAG_LABELS = {
    "match": "✅ AI: 범위 일치",
    "mismatch": "⚠️ AI: 페이지 불일치 의심",
    "unclear": "❔ AI: 못 읽음(직접 확인 필요)",
    "error": "❌ AI 검증 오류",
    "no_api_key": "❌ API 키 없음",
}


def has_unverified_photos(assignment_id: int, submission_id: int) -> bool:
    """이 제출건에 딸린 사진 중 선생님이 아직 확인 안 한 게 하나라도 있으면 True.

    [2026-08-11] 문자 발송(수동 버튼·야간 자동발송 둘 다) 전에 이 함수로
    게이트를 건다 — "AI가 불일치 의심으로 판정했는데도 선생님이 미처
    안 보고 그냥 '완료' 문자가 나가는" 사고를 막기 위해서. 사용자 요청:
    "선생님이 확인 안 한 건 미발송(미완료 아님)" — 즉 검증 안 된 상태는
    "미완료"로 잘못 단정하지 않고, 아예 그 학생에게는 오늘 밤 문자를
    보내지 않고 다음 확인 때까지 미룬다.
    """
    item_states_df = get_items_with_state(assignment_id, submission_id)
    for _, irow in item_states_df.iterrows():
        item_submission_id = irow.get("item_submission_id")
        if item_submission_id is None:
            continue
        photos = get_photos(int(item_submission_id))
        if any(not p["teacher_verified"] for p in photos):
            return True
    return False


def render_photo_review(assignment_id: int, submission_id: int, student_name: str) -> None:
    """이 학생의 이 과제 제출 사진을 항목별로 보여주고, AI 1차 검증 +
    선생님 최종 확인 버튼을 제공한다. hw_assign.py의 과제별 expander 안에서
    호출한다.
    """
    item_states_df = get_items_with_state(assignment_id, submission_id)
    if item_states_df.empty:
        st.caption("항목이 없습니다.")
        return

    any_photo = False
    for _, irow in item_states_df.iterrows():
        item_submission_id = irow.get("item_submission_id")
        if item_submission_id is None:
            continue  # 이 항목은 아직 한 번도 제출 안 함 → 사진 없음
        photos = get_photos(int(item_submission_id))
        if not photos:
            continue
        any_photo = True

        st.markdown(f"**{irow['material_name']}** — 사진 {len(photos)}장")
        is_page_range = irow["item_type"] == "page_range" and irow["page_start"] and irow["page_end"]
        page_start = int(irow["page_start"]) if is_page_range else None
        page_end = int(irow["page_end"]) if is_page_range else None

        n_cols = min(len(photos), 4)
        cols = st.columns(n_cols)
        for i, photo in enumerate(photos):
            with cols[i % n_cols]:
                try:
                    st.image(_data_uri_to_bytes(photo["photo_url"]), width="stretch")
                except Exception:
                    st.caption("(사진 표시 실패)")

                # [2026-08-11] AI 1차 검증은 이제 학생이 사진을 올리는 순간
                # hw_upload.save_submission()에서 자동으로 실행된다(선생님이
                # 버튼을 눌러야만 검증되던 방식에서 변경). 그래서 여기 있는
                # 건 자동 검증이 안 됐거나(오답정리형 — 비교할 페이지 범위가
                # 없음) 실패했을 때만 쓰는 "다시 확인" 버튼이다.
                if photo["ai_flag"]:
                    label = _FLAG_LABELS.get(photo["ai_flag"], photo["ai_flag"])
                    guess_txt = f" ({photo['ai_page_guess']}쪽)" if photo["ai_page_guess"] else ""
                    st.caption(f"{label}{guess_txt}")
                elif page_start is None:
                    st.caption("오답정리형 — AI 페이지 검증 대상 아님")
                else:
                    st.caption("⏳ 자동 검증 대기/실패 — 아래 버튼으로 다시 확인 가능")

                btn_key_base = f"hwphoto_{photo['id']}"
                if page_start is not None:
                    btn_label = "🔄 AI 다시 확인" if photo["ai_flag"] else "🤖 AI 페이지 확인"
                    if st.button(btn_label, key=f"{btn_key_base}_ai", width="stretch"):
                        with st.spinner("사진 확인 중..."):
                            result = run_ai_page_check(
                                photo["id"], photo["photo_url"], page_start, page_end
                            )
                        if result["flag"] in ("error", "no_api_key"):
                            st.error(result["message"])
                        st.rerun()

                if photo["teacher_verified"]:
                    st.caption(f"👍 선생님 확인함 ({photo['teacher_verified_at']})")
                else:
                    if st.button("✅ 선생님 확인", key=f"{btn_key_base}_verify", width="stretch"):
                        mark_teacher_verified(photo["id"], True)
                        st.rerun()
        st.divider()

    if not any_photo:
        st.caption(f"{student_name} 학생이 아직 올린 사진이 없습니다.")
