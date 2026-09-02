import type { SchoolGradeRecord } from '../types/schoolGrades';

// '성적 조회' 탭의 김지우(s1) 학교시험 목데이터(g1, g2)와 내용을 맞춰 일관성 유지.
export const initialSchoolGrades: SchoolGradeRecord[] = [
  {
    studentId: 's1',
    schoolYear: 2026,
    gradeLevel: '중2',
    semester: '1학기',
    examKind: '중간고사',
    score: 82,
    updatedAt: '2026-04-25',
  },
  {
    studentId: 's1',
    schoolYear: 2026,
    gradeLevel: '중2',
    semester: '1학기',
    examKind: '기말고사',
    score: 88,
    updatedAt: '2026-07-11',
  },
];
