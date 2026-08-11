import anthropic
import os
from dotenv import load_dotenv

load_dotenv()

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# 샘플 학생 데이터
student_data = {
    "이름": "김민준",
    "반": "고2 심화반",
    "날짜": "2026-06-22",
    "오늘점수": 78,
    "반평균": 71,
    "반석차": "3/8",
    "월평균": 74,
    "최근8회점수": [65, 70, 68, 72, 75, 71, 74, 78],
    "반평균8회": [63, 67, 65, 69, 70, 68, 70, 71],
    "단원별정답률": {
        "이차방정식": 60,
        "이차함수": 75,
        "부등식": 85,
        "경우의수": 50,
        "확률": 70
    },
    "오답문항": [2, 5, 8, 11, 14]
}

student_name = student_data["이름"]
student_class = student_data["반"]
student_date = student_data["날짜"]
today_score = student_data["오늘점수"]
class_avg = student_data["반평균"]
class_rank = student_data["반석차"]
month_avg = student_data["월평균"]
scores_8 = student_data["최근8회점수"]
avg_8 = student_data["반평균8회"]
unit_scores = student_data["단원별정답률"]
wrong_nums = student_data["오답문항"]

prompt = (
    "너는 수학학원 선생님이야. 아래 학생 데이터를 보고 학부모에게 보내는 HTML 보고서를 만들어줘.\n\n"
    "학생 정보:\n"
    f"- 이름: {student_name}\n"
    f"- 반: {student_class}\n"
    f"- 날짜: {student_date}\n"
    f"- 오늘점수: {today_score}\n"
    f"- 반평균: {class_avg}\n"
    f"- 반석차: {class_rank}\n"
    f"- 월평균: {month_avg}\n"
    f"- 최근8회점수: {scores_8}\n"
    f"- 반평균8회: {avg_8}\n"
    f"- 단원별정답률: {unit_scores}\n"
    f"- 오답문항: {wrong_nums}\n\n"
    "조건:\n"
    "1. HTML 파일 형식으로 만들어줘\n"
    "2. 네이비(#1B2A5E)와 골드(#C9A84C) 컬러 사용\n"
    "3. Chart.js로 아래 2가지 차트 포함:\n"
    "   - 최근 8회 점수 추이 꺾은선 그래프 (반 평균과 비교)\n"
    "   - 단원별 정답률 바차트\n"
    "4. 상단에 KPI 카드 4개: 오늘점수 / 반평균 / 반석차 / 월평균\n"
    "5. 하단에 선생님 코멘트 섹션 (따뜻하고 구체적으로 2~3문장)\n"
    "6. 모바일에서도 잘 보이게 (반응형)\n"
    "7. HTML 코드만 출력하고 다른 설명은 하지 마\n"
)

print("보고서 생성 중... 잠시만 기다려주세요")

message = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=4000,
    messages=[
        {"role": "user", "content": prompt}
    ]
)

html_content = message.content[0].text

# HTML 파일로 저장
with open("sample_report.html", "w", encoding="utf-8") as f:
    f.write(html_content)

print("완료! sample_report.html 파일을 브라우저로 열어서 확인해보세요")
