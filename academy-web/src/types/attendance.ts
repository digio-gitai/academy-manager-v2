// 'cancelled'(휴강)은 학생 개개인이 아니라 반 전체 단위로만 매겨지는 상태 —
// 결석과 달리 출석률 통계에서 제외된다(lib/attendance.ts의 fetchAttendanceHistory).
export type AttendanceStatus = 'present' | 'late' | 'absent' | 'cancelled';

export interface AttendanceRecord {
  studentId: string;
  status: AttendanceStatus;
  note: string;
}

export interface AttendanceStatsRow {
  studentId: string;
  studentName: string;
  className: string;
  present: number;
  late: number;
  absent: number;
  attendanceRate: number;
}

export interface AttendanceLogRow {
  date: string;
  weekday: string;
  studentId: string;
  studentName: string;
  className: string;
  status: AttendanceStatus;
  note: string;
}
