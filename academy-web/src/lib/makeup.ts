import { supabase } from './supabaseClient';

/**
 * 보강 기록 — makeup_sessions(보강 1회) + makeup_attendees(그 보강에 참여한 학생).
 * 테이블 생성 SQL: supabase/sql/2026-09-23_makeup_sessions.sql
 * 원래 수업일 칸: supabase/sql/2026-10-06_makeup_original_date.sql
 *
 * 학생별로 "원래 수업일"(결석 대신 미리/나중에 보강한 날)을 적으면, 그 날짜의
 * 출결(attendance)을 'cancelled' 상태 + 비고 "보강대체 …"로 자동 처리한다.
 * cancelled는 출석 통계에서 빠지므로 결석으로 깎이지 않는다.
 */

/** 보강으로 대체된 출결 행의 비고 접두어 — 이 문구로 일반 휴강과 구분한다. */
export const MAKEUP_SUBSTITUTE_PREFIX = '보강대체';

export function isMakeupSubstituteNote(note: string): boolean {
  return note.trim().startsWith(MAKEUP_SUBSTITUTE_PREFIX);
}

export interface MakeupStudent {
  id: string;
  name: string;
  originalDate: string | null;
}

export interface MakeupSession {
  id: number;
  date: string;
  classId: string | null;
  className: string;
  content: string;
  students: MakeupStudent[];
}

const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

function nowStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function shortDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}(${WEEKDAYS_KO[d.getDay()]})`;
}

type SessionRow = {
  id: number;
  session_date: string;
  class_id: number | null;
  content: string | null;
  classes: { name: string } | null;
  makeup_attendees:
    | { student_id: number; original_date: string | null; students: { name: string } | null }[]
    | null;
};

/** 기간 안의 보강 기록(날짜순). */
export async function fetchMakeupSessions(fromDate: string, toDate: string): Promise<MakeupSession[]> {
  const { data, error } = await supabase
    .from('makeup_sessions')
    .select(
      'id, session_date, class_id, content, classes ( name ), makeup_attendees ( student_id, original_date, students ( name ) )',
    )
    .gte('session_date', fromDate)
    .lte('session_date', toDate)
    .order('session_date', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return ((data as unknown as SessionRow[]) ?? []).map((r) => ({
    id: r.id,
    date: r.session_date,
    classId: r.class_id != null ? String(r.class_id) : null,
    className: r.classes?.name ?? '',
    content: r.content ?? '',
    students: (r.makeup_attendees ?? [])
      .map((a) => ({
        id: String(a.student_id),
        name: a.students?.name ?? '—',
        originalDate: a.original_date || null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
  }));
}

export interface MakeupStudentInput {
  studentId: string;
  studentName: string;
  /** 이 학생의 소속 반 — 원래 수업일 출결 행(attendance.class_id)에 쓴다. */
  classId: string;
  /** 결석 대신 보강한 원래 수업일('YYYY-MM-DD'). 일반 보강이면 빈 값. */
  originalDate: string;
}

/** 저장 결과 — 원래 수업일에 이미 출석·지각이 기록돼 있어 덮어쓰지 않은 학생 이름들. */
export interface CreateMakeupResult {
  skippedNames: string[];
}

export async function createMakeupSession(params: {
  date: string;
  classId: string | null;
  content: string;
  students: MakeupStudentInput[];
}): Promise<CreateMakeupResult> {
  const { data, error } = await supabase
    .from('makeup_sessions')
    .insert({
      session_date: params.date,
      class_id: params.classId ? Number(params.classId) : null,
      content: params.content.trim(),
      created_at: nowStr(),
    })
    .select('id')
    .single();
  if (error) throw error;
  const makeupId = (data as { id: number }).id;
  const { error: attError } = await supabase.from('makeup_attendees').insert(
    params.students.map((s) => ({
      makeup_id: makeupId,
      student_id: Number(s.studentId),
      original_date: s.originalDate || null,
    })),
  );
  if (attError) {
    await supabase.from('makeup_sessions').delete().eq('id', makeupId);
    throw attError;
  }

  // 원래 수업일 출결 자동 처리. 실제로 출석·지각한 기록이 있으면 덮어쓰지 않는다.
  const skippedNames: string[] = [];
  const rows: { student_id: number; class_id: number; session_date: string; status: string; note: string }[] = [];
  for (const s of params.students.filter((x) => x.originalDate)) {
    const { data: existing, error: exErr } = await supabase
      .from('attendance')
      .select('status')
      .eq('student_id', Number(s.studentId))
      .eq('session_date', s.originalDate)
      .maybeSingle();
    if (exErr) throw exErr;
    const st = (existing as { status: string } | null)?.status;
    if (st === 'present' || st === 'late') {
      skippedNames.push(s.studentName);
      continue;
    }
    rows.push({
      student_id: Number(s.studentId),
      class_id: Number(s.classId),
      session_date: s.originalDate,
      status: 'cancelled',
      note: `${MAKEUP_SUBSTITUTE_PREFIX} → ${shortDate(params.date)} 보강`,
    });
  }
  if (rows.length > 0) {
    const { error: upErr } = await supabase.from('attendance').upsert(rows, { onConflict: 'student_id,session_date' });
    if (upErr) throw upErr;
  }
  return { skippedNames };
}

/** 보강 기록 삭제 — 보강대체로 바꿔 둔 원래 수업일 출결은 다시 결석으로 되돌린다. */
export async function deleteMakeupSession(session: MakeupSession): Promise<void> {
  for (const s of session.students) {
    if (!s.originalDate) continue;
    const { error } = await supabase
      .from('attendance')
      .update({ status: 'absent', note: '보강 기록 삭제로 결석 복구' })
      .eq('student_id', Number(s.id))
      .eq('session_date', s.originalDate)
      .eq('status', 'cancelled')
      .like('note', `${MAKEUP_SUBSTITUTE_PREFIX}%`);
    if (error) throw error;
  }
  const { error } = await supabase.from('makeup_sessions').delete().eq('id', session.id);
  if (error) throw error;
}
