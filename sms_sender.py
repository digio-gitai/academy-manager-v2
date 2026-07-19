"""
학부모에게 성적표 링크를 문자(SMS)로 보내는 모듈
- 솔라피(SOLAPI) 사용
- 카카오톡 대신 단문(SMS) 발송 (건당 약 18원, VAT별도)
"""

import os
import requests
from dotenv import load_dotenv
from solapi import SolapiMessageService
from solapi.model import RequestMessage

load_dotenv()  # 로컬에서 단독 실행할 때 .env 파일을 읽어옵니다

try:
    import streamlit as st
except ImportError:
    st = None


def _get_secret(key):
    """Streamlit Cloud의 Secrets 또는 로컬 .env 둘 다에서 값을 찾습니다."""
    if st is not None:
        try:
            if key in st.secrets:
                return st.secrets[key]
        except Exception:
            pass
    return os.getenv(key)


SOLAPI_API_KEY = _get_secret("SOLAPI_API_KEY")
SOLAPI_API_SECRET = _get_secret("SOLAPI_API_SECRET")
SOLAPI_SENDER = _get_secret("SOLAPI_SENDER")

# 문자 첫머리 인사말 — 학원명/강사명 변경은 branding.py에서
from branding import SMS_GREETING

_message_service = None


def _get_service():
    global _message_service
    if _message_service is None:
        if not SOLAPI_API_KEY or not SOLAPI_API_SECRET:
            raise RuntimeError(
                "SOLAPI_API_KEY / SOLAPI_API_SECRET이 설정되지 않았습니다. "
                ".env 또는 Streamlit Secrets를 확인하세요."
            )
        _message_service = SolapiMessageService(
            api_key=SOLAPI_API_KEY, api_secret=SOLAPI_API_SECRET
        )
    return _message_service


def _try_tinyurl(long_url: str) -> str | None:
    res = requests.get(
        "https://tinyurl.com/api-create.php",
        params={"url": long_url},
        timeout=8,
    )
    if res.status_code == 200 and res.text.startswith("http"):
        return res.text.strip()
    return None


def _try_isgd(long_url: str) -> str | None:
    res = requests.get(
        "https://is.gd/create.php",
        params={"format": "simple", "url": long_url},
        timeout=8,
    )
    if res.status_code == 200 and res.text.startswith("http"):
        return res.text.strip()
    return None


def shorten_url(long_url: str) -> str:
    """링크를 짧게 줄여줍니다 (단문 90바이트 유지용).

    TinyURL → is.gd 순서로 시도하고, 전부 실패하면 한 번 더 재시도.
    그래도 실패하면 원래 링크를 반환합니다 (이 경우 장문 LMS로 발송될 수 있음).
    """
    for _attempt in range(2):          # 전체 2회 재시도
        for provider in (_try_tinyurl, _try_isgd):
            try:
                short = provider(long_url)
                if short:
                    return short
            except Exception:
                pass
    return long_url


def clean_phone(phone: str) -> str:
    """010-1234-5678 같은 번호에서 숫자만 남깁니다."""
    return "".join(ch for ch in str(phone) if ch.isdigit())


def send_report_sms(
    phone: str, student_name: str, report_url: str, report_type: str = "성적표"
) -> dict:
    """
    학부모 1명에게 성적표 링크 문자를 보냅니다.

    Args:
        phone: 학부모 연락처 (하이픈 있어도 됨)
        student_name: 학생 이름
        report_url: 성적표를 볼 수 있는 웹 링크 (긴 링크도 OK, 자동으로 축약됨)
        report_type: 보고서 종류 문구. 예) "단원평가 성적표", "월말평가 성적표"
                     기본값은 "성적표" → "OOO 학생 성적표 도착"

    Returns:
        {"success": True/False, "message": "결과 설명"}
    """
    if not SOLAPI_SENDER:
        return {"success": False, "message": "발신번호(SOLAPI_SENDER)가 설정되지 않았습니다."}

    cleaned = clean_phone(phone)
    if len(cleaned) < 9:
        return {"success": False, "message": f"연락처가 올바르지 않습니다: {phone!r}"}

    short_url = shorten_url(report_url)
    _shorten_failed = short_url == report_url
    text = (
        f"{SMS_GREETING}\n"
        f"{student_name} 학생 {report_type} 도착\n"
        f"{short_url}"
    )

    message = RequestMessage(
        from_=clean_phone(SOLAPI_SENDER),
        to=cleaned,
        text=text,
    )

    try:
        service = _get_service()
        response = service.send(message)
        _note = " ⚠️ 링크 단축 실패 → 장문(LMS)으로 발송됨" if _shorten_failed else ""
        return {
            "success": True,
            "message": f"발송 완료 (성공 {response.group_info.count.registered_success}건){_note}",
        }
    except Exception as e:
        return {"success": False, "message": f"발송 실패: {str(e)}"}


def send_report_sms_bulk(recipients: list) -> list:
    """
    여러 학부모에게 한 번에 발송합니다.

    Args:
        recipients: [{"phone": "010...", "student_name": "홍길동", "report_url": "https://...",
                      "report_type": "단원평가 성적표"(선택, 생략시 기본값 "성적표")}, ...]

    Returns:
        각 건별 결과가 담긴 리스트
    """
    results = []
    for r in recipients:
        result = send_report_sms(
            r["phone"],
            r["student_name"],
            r["report_url"],
            r.get("report_type", "성적표"),
        )
        result["student_name"] = r["student_name"]
        results.append(result)
    return results


if __name__ == "__main__":
    # 단독 실행 테스트용 (본인 번호로 테스트 발송)
    test_phone = input("테스트로 받을 본인 번호 입력 (예: 01012345678): ").strip()
    result = send_report_sms(
        phone=test_phone,
        student_name="테스트학생",
        report_url="https://example.com/report/test123",
        report_type="단원평가 성적표",
    )
    print(result)
