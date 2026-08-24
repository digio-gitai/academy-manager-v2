import { supabase } from './supabaseClient';
import type { AttendanceStatus, AttendanceRecord, AttendanceStatsRow, AttendanceLogRow } from '../types/attendance';

const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

interface AttendanceJoinRow {
  student_id: number;
  session_date: string;
  status: AttendanceStatus;
  note: string | null;
  students: { name: string } | null;
  classes: { name: string } | null;
}

/**
 * 특정 반+날짜에 실제로 저장된 출석 기록만 조회. 아직 저장 안 된 학생은
 * 여기 안 뜨고, 화면(AttendanceCheckPanel)에서 기본값 '출석'으로 표시함
 * (스트림릿 page_attendance()의 라디오 기본값 로직과 동일).
 */
export async function fetchAttendanceForSession(
  classId: string,
  sessionDate: string,
): Promise<AttendanceRecord[]> {
  const { data, error } = await supabase
    .from('attendance')
    .select('student_id, status, note')
    .eq('class_id', Number(classId))
    .eq('session_date', sessionDate);
  if (error) {
    throw error;
  }
  return ((data as { student_id: number; status: AttendanceStatus; note: string | null }[]) ?? []).map(
    (r) => ({
      studentId: String(r.student_id),
      status: r.status,
      note: r.note ?? '',
    }),
  );
}

/**
 * 출석 저장(upsert). attendance 테이블이 (student_id, session_date) UNIQUE라서
 * 같은 반+날짜로 다시 저장하면 자동으로 수정(덮어쓰기)됨 — 스트림릿의
 * "ON CONFLICT ... DO UPDATE"와 동일한 동작.
 */
export async function saveAttendanceSession(
  classId: string,
  sessionDate: string,
  records: AttendanceRecord[],
): Promise<void> {
  if (records.length === 0) return;
  const rows = records.map((r) => ({
    student_id: Number(r.studentId),
    class_id: Number(classId),
    session_date: sessionDate,
    status: r.status,
    note: r.note.trim(),
  }));
  const { error } = await supabase.from('attendance').upsert(rows, { onConflict: 'student_id,session_date' });
  if (error) {
    throw error;
  }
}

interface AttendanceEntry {
  studentId: string;
  studentName: string;
  className: string;
  date: string;
  status: AttendanceStatus;
  note: string;
}

async function fetchAttendanceRange(
  fromDate: string,
  toDate: string,
  classId?: string | null,
): Promise<AttendanceEntry[]> {
  let query = supabase
    .from('attendance')
    .select('student_id, session_date, status, note, students ( name ), classes ( name )')
    .gte('session_date', fromDate)
    .lte('session_date', toDate)
    .order('session_date', { ascending: false });
  if (classId) {
    query = query.eq('class_id', Number(classId));
  }
  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return ((data as unknown as AttendanceJoinRow[]) ?? []).map((r) => ({
    studentId: String(r.student_id),
    studentName: r.students?.name ?? '—',
    className: r.classes?.name ?? '—',
    date: r.session_date,
    status: r.status,
    note: r.note ?? '',
  }));
}

/**
 * 기간(+선택적 반 필터) 출결을 조회해서 "학생별 통계"와 "세션별 로그" 두 가지
 * 모양으로 가공. 스트림릿의 get_attendance_summary() / get_attendance_history()
 * 를 화면단(TS) 계산으로 재현 — 학생 수(25명 내외) 규모라 클라이언트 집계로 충분.
 * 같은 학생이 기간 중 반을 옮긴 경우, 원본 SQL과 동일하게 반별로 별도 통계행이 생김.
 */
export async function fetchAttendanceHistory(
  fromDate: string,
  toDate: string,
  classId?: string | null,
): Promise<{ stats: AttendanceStatsRow[]; log: AttendanceLogRow[] }> {
  const entries = await fetchAttendanceRange(fromDate, toDate, classId);

  const statsMap = new Map<string, AttendanceStatsRow & { total: number }>();
  entries.forEach((e) => {
    const key = `${e.studentId}_${e.className}`;
    const row =
      statsMap.get(key) ??
      ({
        studentName: e.studentName,
        className: e.className,
        present: 0,
        late: 0,
        absent: 0,
        attendanceRate: 0,
        total: 0,
      } satisfies AttendanceStatsRow & { total: number });
    if (e.status === 'present') row.present += 1;
    else if (e.status === 'late') row.late += 1;
    else row.absent += 1;
    row.total += 1;
    statsMap.set(key, row);
  });

  const stats: AttendanceStatsRow[] = Array.from(statsMap.values())
    .map(({ total, ...row }) => ({
      ...row,
      attendanceRate: total ? Math.round(((row.present + row.late) / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => a.studentName.localeCompare(b.studentName, 'ko'));

  const log: AttendanceLogRow[] = entries.map((e) => ({
    date: e.date,
    weekday: WEEKDAYS_KO[new Date(`${e.date}T00:00:00`).getDay()],
    studentName: e.studentName,
    className: e.className,
    status: e.status,
    note: e.note,
  }));

  return { stats, log };
}
