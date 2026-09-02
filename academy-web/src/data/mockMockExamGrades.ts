import type { MockExamGradeRecord } from '../types/mockExamGrades';

// '성적 조회' 탭의 김지우(s1) 모의고사 목데이터(g3, g4)와 내용을 맞춰 일관성 유지.
// 참고: 실제 스트림릿 폼도 "학년" 선택지가 고1~3뿐이라(중학생 예외 없음),
// 김지우가 중2여도 이 폼에서는 고1로 저장하게 되는 게 원본과 동일한 동작임.
export const initialMockExamGrades: MockExamGradeRecord[] = [
  { studentId: 's1', schoolYear: 2026, gradeLevel: '고1', examMonth: 3, score: 76, updatedAt: '2026-03-13' },
  { studentId: 's1', schoolYear: 2026, gradeLevel: '고1', examMonth: 6, score: 84, updatedAt: '2026-06-05' },
];
