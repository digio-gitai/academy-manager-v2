"""학원 브랜딩 설정 — 학원명·강사명이 바뀌면 **이 파일만** 수정하면 됩니다.

여기 값들은 학부모에게 나가는 문자, HTML/PDF 보고서, 카카오 공유 문구에
자동으로 반영됩니다. (앱 내부 화면 제목은 APP_TITLE 사용)
"""

# 학부모에게 보이는 학원 이름
ACADEMY_NAME = "사과나무 학원"

# 강사 이름
TEACHER_NAME = "정재훈"

# 앱 내부(크롬 탭 제목 등)용 이름 — 학원이 바뀌어도 그대로 둬도 됨
APP_TITLE = "Math Management"

# 학부모 대상 인사말 (보고서 첫머리)
PARENT_GREETING = f"안녕하세요, {ACADEMY_NAME} {TEACHER_NAME} 강사입니다."

# 문자(SMS) 전용 짧은 인사말 — 90바이트(단문 요금) 안에 들어가도록 짧게 유지
SMS_GREETING = f"사과나무 {TEACHER_NAME}T입니다."
