export interface ConsultationEntry {
  date: string;
  content: string;
}

export type HomeworkLevel = '상' | '중' | '하';

export interface HomeworkHistoryEntry {
  date: string;
  level: HomeworkLevel;
  note?: string;
}

export interface GradeRecordSummary {
  examDate: string;
  examTitle: string;
  score: number;
  classAverage: number;
}

// 실제 운영 스트림릿 앱(app.py의 page_students())에 있는 필드/기능을 그대로 반영함.
// (2026-08-22, 사용자가 스크린샷으로 실제 화면 보여주고 필드 누락을 지적해서 재작업)
export interface StudentProfile {
  id: string;
  name: string;
  initial: string;
  school?: string;
  grade: string;
  className: string;
  teacherName: string;
  registeredAt: string;
  studentPhone?: string;
  parentPhone: string;
  preVisitProgress?: string;
  expectations?: string;
  notes?: string;
  homeworkCompletionRate: number;
  recentHomeworkLevel: HomeworkLevel;
  homeworkHistory: HomeworkHistoryEntry[];
  grades: GradeRecordSummary[];
  consultations: ConsultationEntry[];
}
