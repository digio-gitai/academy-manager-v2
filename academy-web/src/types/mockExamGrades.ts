export const MOCK_GRADE_LEVEL_OPTIONS = ['고1', '고2', '고3'];
// 2026-08-26: 원래 3·4·6·9·11월(평가원+교육청 대표 시험월)만 있었는데,
// 사용자 피드백으로 10월 등 그 외 달의 모의고사도 실제로 있을 수 있어서
// 1~12월 전체를 선택 가능하게 변경함.
export const MOCK_MONTH_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export interface MockExamGradeRecord {
  studentId: string;
  schoolYear: number;
  gradeLevel: string;
  examMonth: number;
  score: number;
  updatedAt: string;
}

export function mockExamGradeKey(r: {
  studentId: string;
  schoolYear: number;
  gradeLevel: string;
  examMonth: number;
}): string {
  return `${r.studentId}_${r.schoolYear}_${r.gradeLevel}_${r.examMonth}`;
}
