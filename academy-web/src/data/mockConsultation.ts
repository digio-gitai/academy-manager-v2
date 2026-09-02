import type { ConsultationLogEntry } from '../types/consultation';

// mockClasses.ts의 학생 id를 재사용(수강료/과제인증과 동일한 방식).
export const initialConsultationLogs: ConsultationLogEntry[] = [
  {
    id: 'cl1',
    studentId: 's1',
    category: 'progress',
    note: '이차방정식 단원 이해도 상승, 다음 시험 목표 90점 이상으로 함께 설정함.',
    author: '김선생',
    createdAt: '2026-08-10 15:20',
  },
  {
    id: 'cl2',
    studentId: 's1',
    category: 'parent',
    note: '학부모 상담 — 학원 숙제량 적당하다는 피드백 받음.',
    author: '김선생',
    createdAt: '2026-07-20 11:05',
  },
  {
    id: 'cl3',
    studentId: 's3',
    category: 'behavior',
    note: '결석이 잦은 편 — 학부모 연락 필요.',
    author: '박선생',
    createdAt: '2026-08-05 09:40',
  },
];
