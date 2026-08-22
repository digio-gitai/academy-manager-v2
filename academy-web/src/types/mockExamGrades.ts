export const MOCK_GRADE_LEVEL_OPTIONS = ['고1', '고2', '고3'];
export const MOCK_MONTH_OPTIONS = [3, 4, 6, 9, 11];

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
