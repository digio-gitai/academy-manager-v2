export type AttendanceStatus = 'present' | 'late' | 'absent';

export interface AttendanceRecord {
  studentId: string;
  status: AttendanceStatus;
  note: string;
}

export interface AttendanceStatsRow {
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
  studentName: string;
  className: string;
  status: AttendanceStatus;
  note: string;
}
