import type { AttendanceRecord, AttendanceStatsRow, AttendanceLogRow } from '../types/attendance';

// key: `${classId}_${dateStr}` — 이미 저장된 출석 세션 예시 데이터
export const savedAttendanceSessions: Record<string, AttendanceRecord[]> = {
  'c1_2026-08-20': [
    { studentId: 's1', status: 'present', note: '' },
    { studentId: 's4', status: 'late', note: '차량 지연' },
  ],
};

// 과제 인증(hw_assign)에서 등록된 반별 · 날짜별 과제 참고 표시용 목데이터.
// 출석 관리에서는 이 내용을 "읽기 전용"으로만 보여준다 — 입력/수정은 전부
// 과제 인증 화면에서 하는 것으로 사용자가 확정함(2026-08-22).
export const referenceAssignments: Record<string, string> = {
  'c1_2026-08-20': '쎈 수학 1~10p (오답정리), 프린트 5~10p',
  'c2_2026-08-19': '개념원리 22~30p, 오답노트 정리 3문제',
};

export const attendanceStats: AttendanceStatsRow[] = [
  { studentName: '김지우', className: '중2 심화반', present: 11, late: 1, absent: 0, attendanceRate: 100 },
  { studentName: '최민서', className: '중2 심화반', present: 9, late: 2, absent: 1, attendanceRate: 92 },
  { studentName: '박서연', className: '중3 대수반', present: 12, late: 0, absent: 0, attendanceRate: 100 },
  { studentName: '이준호', className: '중3 대수반', present: 7, late: 1, absent: 4, attendanceRate: 67 },
];

export const attendanceLog: AttendanceLogRow[] = [
  { date: '2026-08-20', weekday: '목', studentName: '김지우', className: '중2 심화반', status: 'present', note: '' },
  { date: '2026-08-20', weekday: '목', studentName: '최민서', className: '중2 심화반', status: 'late', note: '차량 지연' },
  { date: '2026-08-19', weekday: '수', studentName: '박서연', className: '중3 대수반', status: 'present', note: '' },
  { date: '2026-08-19', weekday: '수', studentName: '이준호', className: '중3 대수반', status: 'absent', note: '병결' },
];
