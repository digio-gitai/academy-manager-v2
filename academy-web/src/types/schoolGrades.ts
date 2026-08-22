export const GRADE_LEVEL_OPTIONS = ['중1', '중2', '중3', '고1', '고2', '고3'];
export const SEMESTER_OPTIONS = ['1학기', '2학기'];
export const SCHOOL_EXAM_KIND_OPTIONS = ['중간고사', '기말고사'];
export const MATH_SUBJECT = '수학';

export interface SchoolGradeRecord {
  studentId: string;
  schoolYear: number;
  gradeLevel: string;
  semester: string;
  examKind: string;
  score: number;
  updatedAt: string;
}

export function schoolGradeKey(r: {
  studentId: string;
  schoolYear: number;
  gradeLevel: string;
  semester: string;
  examKind: string;
}): string {
  return `${r.studentId}_${r.schoolYear}_${r.gradeLevel}_${r.semester}_${r.examKind}`;
}
