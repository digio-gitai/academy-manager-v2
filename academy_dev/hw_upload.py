"""abc 과제 인증 시스템 — 3단계: 학생용 업로드 페이지.

⚠️ 완전히 새로 추가된 모듈입니다. 기존 app.py / hw_assign.py의 어떤 함수도
   수정하지 않습니다. hw_* 테이블은 1단계에서 database.py의 ensure_hw_tables()로
   만들어 둔 것을 그대로 씁니다 (페이지 체크리스트용 completed_pages 컬럼만
   ensure_hw_tables()에 마이그레이션으로 추가했습니다 — report_links와 동일한
   "컬럼 존재 확인 후 ALTER" 패턴).

이 모듈이 하는 일 (3단계 범위, 2026-08-03 2차 구현 — 페이지 입력 방식 변경)
  - 학생이 로그인 없이, 문자로 받은 전용 링크(?hw=토큰)로 접속
  - **페이지 범위형** 항목(예: "쎈 수학 1~8쪽")은 낱장 체크박스 대신 "오늘 시작
    페이지 / 마지막 페이지"를 스크롤 버튼(숫자 입력, ±버튼)으로 지정하는 방식.
    과제가 몇십 쪽이어도 버튼 두 번이면 끝나서, 낱장을 하나하나 체크하는 것보다
    빠르다. 오늘 입력한 범위는 이전에 인증한 페이지와 합쳐져서 누적되고, 전체
    범위를 다 채워야 그 항목이 "완료"로 계산된다.
  - **사진은 필수다.** 오늘 인증하는 페이지 수만큼 사진을 정확히 올려야
    제출된다(예: 오늘 1~3쪽을 새로 인증하면 사진 3장 필요). 오답정리형(페이지
    구분 없는) 항목은 완료 체크 시 최소 1장 이상. 개수가 안 맞으면 제출을
    막고 몇 장이 더 필요한지 알려준다.
  - 페이지 번호를 AI가 자동 인식하지는 않음(손글씨 오차 위험) — 지금은 "신고한
    페이지 수 = 올린 사진 수"까지만 기계적으로 검증한다. 사진 속 페이지 번호가
    실제로 맞는지, 문제 수만큼 답이 채워져 있는지를 AI로 보조 검증하는 건
    다음 업그레이드 후보로 남겨둠(요청받은 아이디어).
  - 제출하면: 항목별 완료현황(hw_item_submissions) + 사진(hw_photos) 저장,
    전체 제출현황(hw_submissions.status)을 done/partial/pending으로 자동 갱신.
  - 제출 직후 "제출 완료" 안내가 화면에 남아 보이도록 session_state로 처리
    (예전엔 성공 메시지를 띄운 직후 바로 rerun을 해서 안 보이고 사라지는
    버그가 있었음 — 실사용 테스트에서 발견해서 수정함).
  - 사진 위젯은 저장 성공 시 key의 "세대" 번호를 올려 초기화한다 — 안 그러면
    같은 사진이 선택된 채로 다시 제출할 때마다 사진이 중복으로 쌓인다
    (실사용 테스트에서 발견한 문제).

아직 안 만든 것 (다음 단계)
  - AI로 사진 속 페이지 번호·답 개수를 보조 검증하는 기능 (정확도 이슈로
    지금은 "사진 장수 = 신고 페이지 수" 기계적 검증까지만 함)
  - 제출기한 지남 처리, 미열람 자동 감지 (4단계 몫)
  - 학부모 자동 SMS 발송 (5단계 몫)

Public API:
  - render_hw_upload_page(token)
"""

from __future__ import annotations

import base64
import io
from datetime import datetime
from typing import Any

import pandas as pd
import streamlit as st

from branding import ACADEMY_NAME
from database import ensure_hw_tables
from db_connect import get_conn

_STATUS_LABELS = {"pending": "⏳ 미완료", "partial": "🟡 일부완료", "done": "✅ 완료"}


def _read_sql_df(query: str, params: tuple | list = ()) -> pd.DataFrame:
    """pd.read_sql_query(query, conn, ...) 대신 쓰는 안전한 대체 함수.

    [버그 수정 2026-08-08] db_connect._CompatConnection은 pandas가 인식하는
    정식 커넥션이 아니라서, pandas가 legacy 파서로 처리하다가 SQL NULL을
    문자열 "nan"으로 잘못 바꿔버리는 버그가 있었다(hw_assign.py 쪽 "미완료
    학생" 화면에서 실사용 테스트로 발견 — 한 번도 안 열어본 과제가 "열람
    후 미완료"로 잘못 표시됨). conn.execute()로 직접 fetchall()해서
    DataFrame을 만들면 이 legacy 파서를 거치지 않아 NULL이 그대로 유지된다.
    hw_assign.py에 있는 동일한 이름의 함수와 내용이 같다 — 두 모듈이 서로
    import하면 순환참조가 생겨서(hw_assign이 hw_upload를 이미 import함)
    각자 모듈에 독립적으로 둔다.
    """
    conn = get_conn()
    cur = conn.execute(query, tuple(params))
    rows = cur.fetchall()
    cols = [d[0] for d in cur.description]
    conn.close()
    # dtype=object 강제 지정 이유는 hw_assign.py의 동일한 함수 주석 참고 —
    # 사용자 환경 pandas의 future.infer_string 옵션 때문에 지정 안 하면
    # NULL이 문자열 "nan"으로 둔갑해서 참/거짓 검사가 잘못될 수 있다.
    return pd.DataFrame(rows, columns=cols, dtype=object)


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def compute_display_status(
    *, status: str, viewed_at: str | None, due_date: str | None, today: str | None = None
) -> str:
    """선생님이 보기 좋은 상태 라벨을 계산한다.

    "미완료"만으로는 학생이 링크를 아예 안 열어본 건지, 열어봤는데 안 한
    건지 구분이 안 된다는 피드백을 받아서 나눴다:
      완료 / 일부완료 / 열람 후 미완료 / 미열람 — 그리고 기한이 지났으면
      뒤에 "· 기한초과"를 붙인다(완료는 기한이 지나도 그냥 완료로 둔다).
    과제인증(교사용) 화면과 학생 업로드 화면 양쪽에서 재사용한다.
    """
    today = today or _today()
    if status == "done":
        return "✅ 완료"
    overdue = bool(due_date) and due_date < today
    if status == "partial":
        base = "🟡 일부완료"
    elif viewed_at:
        base = "👀 열람 후 미완료"
    else:
        base = "⛔ 미열람"
    return base + " · 기한초과" if overdue else base


def mark_viewed(submission_id: int) -> None:
    """학생이 업로드 링크를 열었을 때 최초 1회만 열람 시각을 기록한다.

    COALESCE로 이미 값이 있으면 덮어쓰지 않으므로, 페이지를 새로고침해도
    "처음 연 시각"이 그대로 유지된다 — "미열람 vs 열람했지만 미완료"를
    구분하는 데 쓴다.
    """
    ensure_hw_tables()
    conn = get_conn()
    conn.execute(
        "UPDATE hw_submissions SET viewed_at = COALESCE(viewed_at, ?) WHERE id = ?",
        (_now(), submission_id),
    )
    conn.commit()
    conn.close()


def parse_completed_pages(raw: Any) -> set[int]:
    if raw is None or (isinstance(raw, float) and pd.isna(raw)):
        return set()
    text = str(raw).strip()
    if not text:
        return set()
    result: set[int] = set()
    for token in text.split(","):
        token = token.strip()
        if token.isdigit():
            result.add(int(token))
    return result


def format_page_ranges(pages: list[int] | set[int]) -> str:
    """[1,2,3,5,6,9] 같은 페이지 목록을 "1~3, 5~6, 9쪽"처럼 읽기 좋게 묶는다.

    몇 페이지부터 몇 페이지까지 인증됐는지 학생·선생님이 한눈에 보이도록
    쓴다 (사진 장수만 보여주면 실제로 어디까지 했는지 알 수가 없다는
    피드백을 받아서 추가함).
    """
    pages_sorted = sorted(set(int(p) for p in pages))
    if not pages_sorted:
        return "없음"
    groups: list[list[int]] = []
    for p in pages_sorted:
        if groups and p == groups[-1][-1] + 1:
            groups[-1].append(p)
        else:
            groups.append([p])
    # "~"를 그대로 쓰면 Streamlit 마크다운이 이걸 취소선(~~글자~~) 문법의
    # 일부로 잘못 해석해서, 같은 캡션 안에 물결표가 두 번 이상 나올 때
    # 물결표가 사라지고 그 사이 글자에 줄이 그어지는 버그가 있었다
    # (실사용 테스트에서 발견 — "1~2쪽"이 "12쪽"처럼 붙어 보이던 문제).
    # "\~"로 이스케이프해서 항상 글자 그대로 보이게 한다.
    parts = [f"{g[0]}\\~{g[-1]}" if len(g) > 1 else f"{g[0]}" for g in groups]
    return ", ".join(parts) + "쪽"


# ═══════════════════════════════════════════════════════════════
# 조회
# ═══════════════════════════════════════════════════════════════


def get_submission_by_token(token: str) -> dict[str, Any] | None:
    """업로드 토큰으로 과제·학생·반 정보를 한 번에 조회한다."""
    ensure_hw_tables()
    conn = get_conn()
    row = conn.execute(
        """
        SELECT s.id, s.assignment_id, s.student_id, s.status, s.submitted_at,
               a.title, a.due_date, a.assigned_date, c.name,
               st.name, s.viewed_at
        FROM hw_submissions s
        JOIN hw_assignments a ON a.id = s.assignment_id
        LEFT JOIN classes c ON c.id = a.class_id
        JOIN students st ON st.id = s.student_id
        WHERE s.upload_token = ?
        """,
        (token,),
    ).fetchone()
    conn.close()
    if not row:
        return None
    return {
        "submission_id": int(row[0]),
        "assignment_id": int(row[1]),
        "student_id": int(row[2]),
        "status": row[3],
        "submitted_at": row[4],
        "title": row[5],
        "due_date": row[6] or "",
        "assigned_date": row[7],
        "class_name": row[8] or "",
        "student_name": row[9],
        "viewed_at": row[10],
    }


def get_items_with_state(assignment_id: int, submission_id: int) -> pd.DataFrame:
    """과제 항목 목록 + 이 학생이 그동안 체크·저장해둔 상태를 함께 가져온다."""
    ensure_hw_tables()
    return _read_sql_df(
        """
        SELECT i.id AS item_id, i.item_type, i.material_name, i.page_start, i.page_end,
               i.description, i.sort_order,
               isub.id AS item_submission_id, isub.status AS sub_status,
               isub.completed_pages, isub.student_note
        FROM hw_items i
        LEFT JOIN hw_item_submissions isub
               ON isub.item_id = i.id AND isub.submission_id = %s
        WHERE i.assignment_id = %s
        ORDER BY i.sort_order, i.id
        """,
        (submission_id, assignment_id),
    )


def get_photo_count(item_submission_id: int) -> int:
    conn = get_conn()
    row = conn.execute(
        "SELECT COUNT(*) FROM hw_photos WHERE item_submission_id = ?",
        (item_submission_id,),
    ).fetchone()
    conn.close()
    return int(row[0]) if row else 0


# ═══════════════════════════════════════════════════════════════
# 저장
# ═══════════════════════════════════════════════════════════════


def _compress_photo_to_data_uri(raw_bytes: bytes, max_dim: int = 1600, quality: int = 70) -> str:
    """사진을 적당히 줄여서(긴 변 1600px, JPEG 70%) DB에 바로 저장 가능한
    데이터 URI로 바꾼다.

    별도 클라우드 저장소(Supabase Storage 등)를 새로 연결하지 않고, 기존
    report_links가 보고서 HTML 전체를 DB 컬럼에 저장하는 것과 동일한 방식으로
    사진도 DB 안에 둔다 — 학생 수(25명 내외) 규모에서는 이 편이 설정할 것이
    없어 훨씬 단순하다.
    """
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(raw_bytes))
        img = img.convert("RGB")
        img.thumbnail((max_dim, max_dim))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        encoded = base64.b64encode(buf.getvalue()).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}"
    except Exception:
        # 압축 실패(손상된 파일 등) 시 원본이라도 그대로 저장
        encoded = base64.b64encode(raw_bytes).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}"


def save_submission(
    *,
    submission_id: int,
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    """항목별 완료 체크(또는 페이지 체크)·메모·새 사진을 저장하고,
    전체 제출 상태를 갱신한다.

    items: [{item_id, done, note, new_photos: [bytes, ...], completed_pages: [int, ...]}, ...]
    반환값: {"overall": "done"|"partial"|"pending", "done_count": int, "total": int}
    """
    ensure_hw_tables()
    conn = get_conn()
    ts = _now()
    try:
        any_done = False
        all_done = True
        done_count = 0
        for it in items:
            done = bool(it.get("done"))
            status = "done" if done else "not_done"
            any_done = any_done or done
            all_done = all_done and done
            if done:
                done_count += 1

            completed_pages_str = ",".join(
                str(p) for p in sorted(set(it.get("completed_pages") or []))
            )

            cur = conn.execute(
                """
                INSERT INTO hw_item_submissions
                    (submission_id, item_id, status, completed_pages, student_note, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (submission_id, item_id) DO UPDATE
                   SET status = EXCLUDED.status,
                       completed_pages = EXCLUDED.completed_pages,
                       student_note = EXCLUDED.student_note,
                       updated_at = EXCLUDED.updated_at
                RETURNING id
                """,
                (submission_id, it["item_id"], status, completed_pages_str, (it.get("note") or "").strip(), ts),
            )
            item_submission_id = int(cur.fetchone()[0])

            new_photo_bytes_list = it.get("new_photos") or []
            if new_photo_bytes_list:
                item_row = conn.execute(
                    "SELECT item_type, page_start, page_end FROM hw_items WHERE id = ?",
                    (it["item_id"],),
                ).fetchone()
                item_type = item_row[0] if item_row else None
                page_start = item_row[1] if item_row else None
                page_end = item_row[2] if item_row else None

            for photo_bytes in new_photo_bytes_list:
                data_uri = _compress_photo_to_data_uri(photo_bytes)
                photo_cur = conn.execute(
                    "INSERT INTO hw_photos (item_submission_id, photo_url, uploaded_at) "
                    "VALUES (?, ?, ?) RETURNING id",
                    (item_submission_id, data_uri, ts),
                )
                photo_id = int(photo_cur.fetchone()[0])

                # [2026-08-11] 학생이 사진을 올리는 즉시 AI 1차 페이지번호
                # 검증을 무조건 실행한다(선생님이 버튼을 눌러야 하던 방식에서
                # 변경 — 사용자 요청). 페이지 범위형 항목에만 적용(오답정리형은
                # 비교할 범위 자체가 없음). hw_photo_review를 여기서 import하면
                # 모듈 최상단에서 순환참조가 생기므로(hw_photo_review가
                # hw_upload.get_items_with_state를 이미 가져다 씀) 함수 안에서
                # 그때그때 가져온다. AI 호출이 실패해도(키 없음, 네트워크 등)
                # 학생 제출 자체는 그대로 성공 처리되도록 예외를 감싼다 — 이
                # 검증은 선생님을 위한 참고용이지 제출을 막는 조건이 아니다.
                if item_type == "page_range" and page_start and page_end:
                    try:
                        from hw_photo_review import run_ai_page_check

                        run_ai_page_check(photo_id, data_uri, int(page_start), int(page_end))
                    except Exception:
                        pass

        if not items:
            overall = "pending"
        elif all_done:
            overall = "done"
        elif any_done:
            overall = "partial"
        else:
            overall = "pending"

        conn.execute(
            "UPDATE hw_submissions SET status = ?, submitted_at = ? WHERE id = ?",
            (overall, ts, submission_id),
        )
        conn.commit()
        return {"overall": overall, "done_count": done_count, "total": len(items)}
    finally:
        conn.close()


# ═══════════════════════════════════════════════════════════════
# Streamlit UI (로그인 없음 — 링크로만 접속)
# ═══════════════════════════════════════════════════════════════


def _render_page_range_item(row: pd.Series, prev_completed: set[int]) -> dict[str, Any]:
    """페이지 범위형 항목 — "오늘 시작 페이지 / 마지막 페이지"를 숫자 입력(±버튼,
    이른바 다이얼 버튼)으로 지정하는 방식.

    낱장 체크박스는 페이지가 몇십 쪽이면 누르는 것 자체가 힘들다는 피드백을
    받아서, 버튼 두 번(시작·끝)으로 범위를 지정하는 방식으로 바꿨다. 오늘
    지정한 범위는 이전에 인증해둔 페이지와 합쳐져서 누적된다.

    체크박스로 먼저 "오늘 진행했어요"를 켜야 버튼이 나타나던 예전 방식은
    버튼이 안 보인다는 오해를 사서(체크 전엔 아예 안 그려짐) 없앴다 — 지금은
    숫자 입력 두 개가 처음부터 항상 보이고, 기본값은 "오늘 아직 아무것도
    안 함"에 해당하는 마지막 페이지(시작-1)로 잡아서 아무것도 안 건드리면
    자동으로 완료 처리되는 일이 없게 했다.

    이 두 숫자 입력도 사진 위젯처럼 key에 "세대" 번호를 붙인다 — 안 그러면
    항목 A를 오늘 저장한 뒤, 나중에 항목 B만 새로 제출할 때도 항목 A의
    입력칸에 저장 전 값이 그대로 남아 있어서 "이미 낸 페이지를 또 새로
    낸 것"처럼 다시 요구하는 문제가 생긴다(실사용 테스트에서 발견).
    저장에 성공하면 그 항목만 세대를 올려 다음 로드 때 값을 "오늘 아직
    아무것도 안 함" 상태로 되돌린다.

    반환 dict의 photo_rule: ("exact", n) → 사진이 정확히 n장이어야 저장 가능.
    None → 사진 개수 제한 없음(오늘 새로 인증하는 페이지가 없는 경우).
    """
    item_id = int(row["item_id"])
    range_gen = st.session_state.get(f"hw_up_pgrange_gen_{item_id}", 0)
    page_start, page_end = int(row["page_start"]), int(row["page_end"])
    total_pages = page_end - page_start + 1
    full_range = set(range(page_start, page_end + 1))

    st.markdown(f"**{row['material_name']} ({page_start}\\~{page_end}쪽)**")
    if row["description"]:
        st.caption(str(row["description"]))

    already_full = full_range.issubset(prev_completed)
    if prev_completed:
        st.caption(
            f"지금까지 완료: {format_page_ranges(prev_completed & full_range)} "
            f"({len(prev_completed & full_range)}/{total_pages}쪽)"
        )

    if already_full:
        st.caption("✅ 이 항목은 이미 전체 완료했어요. (더 인증할 필요 없음)")
        return {
            "item_id": item_id,
            "done": True,
            "completed_pages": sorted(prev_completed & full_range),
            "photo_rule": None,
            "new_page_count": 0,
            "range_gen_key": f"hw_up_pgrange_gen_{item_id}",
        }

    # 오늘 시작 페이지 = 지금까지 완료한 다음 쪽부터(이어하기 기본값).
    suggested_start = min(
        max(page_start, (max(prev_completed) + 1) if prev_completed else page_start),
        page_end,
    )
    c1, c2 = st.columns(2)
    with c1:
        start_val = st.number_input(
            "오늘 시작 페이지",
            min_value=page_start,
            max_value=page_end,
            value=int(suggested_start),
            step=1,
            key=f"hw_up_pgstart_{item_id}_{range_gen}",
        )
    with c2:
        # 기본값을 "시작-1"로 잡아 아무것도 안 누르면 0쪽(오늘 진행 없음)이
        # 되게 한다. min_value도 시작-1까지 허용해서, 끝이 시작보다 작으면
        # "오늘은 안 함"으로 자연스럽게 해석한다(에러가 아니라 정상 상태).
        end_val = st.number_input(
            "오늘 마지막 페이지",
            min_value=page_start - 1,
            max_value=page_end,
            value=int(start_val) - 1,
            step=1,
            key=f"hw_up_pgend_{item_id}_{range_gen}",
        )

    if int(end_val) >= int(start_val):
        new_range = list(range(int(start_val), int(end_val) + 1))
        st.caption(f"📷 오늘 {len(new_range)}쪽 인증 → 사진 {len(new_range)}장이 필요해요.")
    else:
        new_range = []
        st.caption("오늘은 이 항목 진행 안 함으로 처리됩니다.")

    merged = sorted(prev_completed | set(new_range))
    done = full_range.issubset(set(merged))
    if not done and new_range:
        remaining = sorted(full_range - set(merged))
        st.caption(f"⏳ 남은 페이지: {format_page_ranges(remaining)}")

    photo_rule = ("exact", len(new_range)) if new_range else None
    return {
        "item_id": item_id,
        "done": done,
        "completed_pages": merged,
        "photo_rule": photo_rule,
        "new_page_count": len(new_range),
        "range_gen_key": f"hw_up_pgrange_gen_{item_id}",
    }


def _render_simple_item(row: pd.Series, prev_done: bool) -> dict[str, Any]:
    """오답정리형(또는 페이지 번호를 안 넣은) 항목 — 체크박스 1개 + 완료 시 사진 최소 1장.

    페이지 범위형인데 부여 시 페이지 번호를 안 넣은 예외 케이스도 여기로
    빠지므로, item_type을 보고 라벨을 다르게 붙인다 (그런 경우까지 "오답정리"
    라고 잘못 표시하면 학생이 헷갈린다).
    """
    item_id = int(row["item_id"])
    suffix = " — 오답정리" if row["item_type"] == "wrong_note" else ""
    st.markdown(f"**{row['material_name']}{suffix}**")
    if row["description"]:
        st.caption(str(row["description"]))
    done = st.checkbox("완료했어요", value=prev_done, key=f"hw_up_done_{item_id}")
    photo_rule = ("at_least", 1) if done else None
    return {"item_id": item_id, "done": done, "completed_pages": [], "photo_rule": photo_rule}


def render_hw_upload_page(token: str) -> None:
    """학생용 과제 인증 업로드 페이지. 로그인·사이드바·메뉴 없이 이 화면만 표시합니다."""
    ensure_hw_tables()

    st.markdown(
        """
        <style>
        #MainMenu {visibility: hidden;}
        header {visibility: hidden;}
        footer {visibility: hidden;}
        div[data-testid="stToolbar"] {visibility: hidden;}
        div[data-testid="stDecoration"] {visibility: hidden;}
        div[data-testid="stStatusWidget"] {visibility: hidden;}
        .block-container {padding-top: 2rem !important; max-width: 640px !important;}
        </style>
        """,
        unsafe_allow_html=True,
    )

    meta = get_submission_by_token(token)
    if not meta:
        st.error("링크를 찾을 수 없거나 잘못된 링크입니다. 학원으로 문의해 주세요.")
        return

    # 학생이 링크를 열었다는 걸 최초 1회 기록 — "미열람"과 "열람했지만
    # 미완료"를 구분하는 데 쓴다(교사용 화면에서 표시).
    mark_viewed(meta["submission_id"])

    st.markdown(f"#### {ACADEMY_NAME} · 과제 인증")
    st.caption(f"{meta['student_name']} 학생 · {meta['class_name']}")

    due_txt = f" · 제출기한 {meta['due_date']}" if meta["due_date"] else ""
    st.markdown(f"**{meta['title']}**{due_txt}")

    # 제출 직후 화면에서 사라지지 않는 확인 배너.
    # (예전 버전은 st.success() 직후 바로 st.rerun()을 해서, 리런되며 화면이
    #  통째로 다시 그려지는 바람에 성공 메시지가 학생 눈에 보이지도 않고
    #  사라지는 버그가 있었다 — session_state에 결과를 담아뒀다가 리런 후
    #  이 자리에서 한 번 보여주고 지우는 방식으로 고쳤다.)
    last_result = st.session_state.pop("hw_upload_last_result", None)
    if last_result:
        st.success(
            f"제출이 저장됐어요! ({_STATUS_LABELS.get(last_result['overall'], last_result['overall'])} "
            f"· 항목 {last_result['done_count']}/{last_result['total']}개 완료)"
        )
    else:
        st.caption(_STATUS_LABELS.get(meta["status"], meta["status"]))

    items_df = get_items_with_state(meta["assignment_id"], meta["submission_id"])
    if items_df.empty:
        st.info("등록된 과제 항목이 없습니다. 학원으로 문의해 주세요.")
        return

    st.divider()
    st.caption(
        "문제집/프린트는 오늘 시작~마지막 페이지를 버튼으로 정해주세요. "
        "사진은 필수예요 — 오늘 인증하는 페이지 수만큼 정확히 올려야 제출됩니다."
    )

    with st.form("hw_upload_form"):
        item_states: list[dict[str, Any]] = []
        for _, row in items_df.iterrows():
            item_id = int(row["item_id"])
            has_page_range = (
                row["item_type"] == "page_range"
                and pd.notna(row["page_start"])
                and pd.notna(row["page_end"])
                and int(row["page_start"]) <= int(row["page_end"])
            )
            with st.container(border=True):
                if has_page_range:
                    prev_completed = parse_completed_pages(row["completed_pages"])
                    state = _render_page_range_item(row, prev_completed)
                else:
                    state = _render_simple_item(row, prev_done=row["sub_status"] == "done")

                note = st.text_input(
                    "메모 (선택)",
                    value=str(row["student_note"] or ""),
                    key=f"hw_up_note_{item_id}",
                    placeholder="예: 3번 문제 어려웠어요",
                )

                if pd.notna(row["item_submission_id"]):
                    photo_count = get_photo_count(int(row["item_submission_id"]))
                    if photo_count:
                        st.caption(f"📎 이미 올린 사진 {photo_count}장")

                # 사진 위젯 key에 "세대" 번호를 붙여서, 저장에 성공하면 세대를
                # 올려 위젯을 초기화한다 — 안 그러면 같은 사진이 선택된 채로
                # 다시 제출할 때마다 사진이 계속 중복으로 쌓인다(실사용 테스트에서
                # 발견한 문제).
                gen_key = f"hw_up_photo_gen_{item_id}"
                gen = st.session_state.get(gen_key, 0)
                photo_rule = state.get("photo_rule")
                photo_label = "인증 사진 첨부 (필수)" if photo_rule else "인증 사진 첨부 (오늘 진행 안 하면 비워두세요)"
                photos = st.file_uploader(
                    photo_label,
                    type=["png", "jpg", "jpeg"],
                    accept_multiple_files=True,
                    key=f"hw_up_photo_{item_id}_{gen}",
                )

                item_states.append(
                    {
                        **state,
                        "material_name": row["material_name"],
                        "note": note,
                        "photos": photos or [],
                        "gen_key": gen_key,
                    }
                )

        submit = st.form_submit_button("제출하기", width="stretch", type="primary")

    if submit:
        # 사진 개수 검증 — "오늘 인증하는 페이지 수 = 올린 사진 수"가 원칙.
        # (완료 여부는 이미 위에서 페이지 범위/체크박스로 계산해뒀고, 여기서는
        # 그 계산과 사진 개수가 실제로 맞는지만 확인한다.)
        errors: list[str] = []
        for s in item_states:
            rule = s.get("photo_rule")
            if not rule:
                continue
            kind, need = rule
            have = len(s["photos"])
            if kind == "exact" and have != need:
                errors.append(
                    f"· {s['material_name']}: 사진 {need}장이 필요한데 {have}장 올리셨어요."
                )
            elif kind == "at_least" and have < need:
                errors.append(f"· {s['material_name']}: 인증 사진을 최소 {need}장 올려주세요.")

        if errors:
            st.error("사진 개수를 확인해 주세요.\n" + "\n".join(errors))
        else:
            items_payload = [
                {
                    "item_id": s["item_id"],
                    "done": s["done"],
                    "note": s["note"],
                    "completed_pages": s["completed_pages"],
                    "new_photos": [f.getvalue() for f in s["photos"]],
                }
                for s in item_states
            ]
            result = save_submission(submission_id=meta["submission_id"], items=items_payload)
            st.session_state["hw_upload_last_result"] = result
            # 사진을 새로 첨부했던 항목만 위젯 세대를 올려 다음 제출 때 비워둔다.
            for s in item_states:
                if s["photos"]:
                    st.session_state[s["gen_key"]] = st.session_state.get(s["gen_key"], 0) + 1
            # 오늘 새로 페이지를 인증한 항목도 시작/마지막 페이지 입력을 초기화한다.
            # (안 그러면 이 항목을 안 건드린 다음 제출에서도 방금 낸 페이지를
            # "오늘 새로 인증하는 범위"로 또 잡아서 사진을 다시 요구하는 문제가
            # 생긴다 — 실사용 테스트에서 발견한 문제.)
            for s in item_states:
                if s.get("new_page_count") and s.get("range_gen_key"):
                    gk = s["range_gen_key"]
                    st.session_state[gk] = st.session_state.get(gk, 0) + 1
            st.rerun()
