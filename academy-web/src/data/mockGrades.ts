import type { UnifiedGradeRecord } from '../types/grades';

/**
 * 스트림릿 student_grade_unified 테이블(학교/모의/학원 시험 통합)을 흉내낸 목데이터.
 * 학생 id는 mockStudents.ts의 학생 명부와 동일한 id(s1~s6)를 공유한다.
 */
export const unifiedGrades: UnifiedGradeRecord[] = [
  // 김지우 (s1) — 세 카테고리 모두 데이터 있음
  { id: 'g1', studentId: 's1', examGroup: 'school', examLabel: '1학기 중간고사', score: 82, examDate: '2026-04-24', updatedAt: '2026-04-25' },
  { id: 'g2', studentId: 's1', examGroup: 'school', examLabel: '1학기 기말고사', score: 88, examDate: '2026-07-10', updatedAt: '2026-07-11' },
  { id: 'g3', studentId: 's1', examGroup: 'mock', examLabel: '3월 모의고사', score: 76, examDate: '2026-03-12', updatedAt: '2026-03-13' },
  { id: 'g4', studentId: 's1', examGroup: 'mock', examLabel: '6월 모의고사', score: 84, examDate: '2026-06-04', updatedAt: '2026-06-05' },
  { id: 'g5', studentId: 's1', examGroup: 'academy', examLabel: '6월 정기고사', score: 79, examDate: '2026-06-28', updatedAt: '2026-06-28' },
  { id: 'g6', studentId: 's1', examGroup: 'academy', examLabel: '7월 정기고사', score: 85, examDate: '2026-07-26', updatedAt: '2026-07-26' },
  { id: 'g7', studentId: 's1', examGroup: 'academy', examLabel: '8월 정기고사', score: 91, examDate: '2026-08-20', updatedAt: '2026-08-20' },

  // 박서연 (s2) — 학원시험만 몇 건
  { id: 'g8', studentId: 's2', examGroup: 'academy', examLabel: '7월 정기고사', score: 94, examDate: '2026-07-26', updatedAt: '2026-07-26' },
  { id: 'g9', studentId: 's2', examGroup: 'academy', examLabel: '8월 정기고사', score: 96, examDate: '2026-08-20', updatedAt: '2026-08-20' },

  // 이준호 (s3), 최민서(s4), 정하윤(s5), 강예린(s6) — 아직 기록 없음 (빈 상태 확인용)
];

export function getGradesForStudent(studentId: string): UnifiedGradeRecord[] {
  return unifiedGrades.filter((g) => g.studentId === studentId);
}
