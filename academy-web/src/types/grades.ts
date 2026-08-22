export type ExamGroup = 'school' | 'mock' | 'academy';

export const EXAM_GROUP_LABELS: Record<ExamGroup, string> = {
  school: '학교시험',
  mock: '모의고사',
  academy: '학원시험',
};

export interface UnifiedGradeRecord {
  id: string;
  studentId: string;
  examGroup: ExamGroup;
  examLabel: string;
  score: number;
  examDate: string;
  updatedAt: string;
}
