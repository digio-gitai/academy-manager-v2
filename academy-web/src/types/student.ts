import type { UnifiedGradeRecord } from './grades';

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

// 실제 운영 스트림릿 앱(app.py의 page_students())에 있는 필드/기능을 그대로 반영함.
// (2026-08-22, 사용자가 스크린샷으로 실제 화면 보여주고 필드 누락을 지적해서 재작업)
//
// 2026-08-27: grades는 원래 자체 요약 타입(GradeRecordSummary, 반평균 포함)이었으나,
// 실제 DB 연동 단계에서 학교/모의고사 성적은 lib/grades.ts의 fetchUnifiedGrades()가
// 반환하는 UnifiedGradeRecord[]를 그대로 재사용하기로 함 — 이 데이터(외부 성적)는
// "반 평균" 개념 자체가 없어서(학교시험/모의고사는 같은 반이라도 학생별로 따로
// 관리됨) classAverage 필드는 제거함.
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
  grades: UnifiedGradeRecord[];
  consultations: ConsultationEntry[];
  // 2026-09-02 추가: 수업중지(휴원) 상태. 스트림릿 운영 앱과 동일한 필드
  // (students.is_paused/paused_at)를 그대로 반영.
  isPaused: boolean;
  pausedAt?: string;
}
