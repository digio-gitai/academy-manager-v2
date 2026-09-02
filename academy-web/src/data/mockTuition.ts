import type { TuitionRecord } from '../types/tuition';

// 2026-08월 기준 데모 데이터 — s1~s5는 mockClasses.ts의 학생 id 재사용(같은 반 구조).
export const initialTuitionRecords: TuitionRecord[] = [
  { studentId: 's1', month: '2026-08', status: 'paid', amount: 350000, paidDate: '2026-08-03' },
  { studentId: 's4', month: '2026-08', status: 'paid', amount: 350000, paidDate: '2026-08-05' },
  { studentId: 's2', month: '2026-08', status: 'pending', amount: 380000 },
  { studentId: 's3', month: '2026-08', status: 'overdue', amount: 380000 },
];
