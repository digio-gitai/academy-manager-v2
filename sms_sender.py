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

BRAND_PREFIX = "[사과나무 정재훈T]"  # 문자 맨 앞에 붙는 발신 표시. 여기만 바꾸면 전체 반영됨

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


def shorten_url(long_url: str) -> str:
    """TinyURL로 링크를 짧게 줄여줍니다 (문자 글자수를 아끼기 위함).
    실패하면 원래 링크를 그대로 반환합니다."""
    try:
        res = requests.get(
            "https://tinyurl.com/api-create.php",
            params={"url": long_url},
            timeout=5,
        )
        if res.status_code == 200 and res.text.startswith("http"):
            return res.text.strip()
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
    text = f"{BRAND_PREFIX} {student_name} 학생 {report_type} 도착\n{short_url}"

    message = RequestMessage(
        from_=clean_phone(SOLAPI_SENDER),
        to=cleaned,
        text=text,
    )

    try:
        service = _get_service()
        response = service.send(message)
        return {
            "success": True,
            "message": f"발송 완료 (성공 {response.group_info.count.registered_success}건)",
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
