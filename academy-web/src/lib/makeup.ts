import { supabase } from './supabaseClient';

/**
 * 보강 기록 — makeup_sessions(보강 1회) + makeup_attendees(그 보강에 참여한 학생).
 * 테이블 생성 SQL: supabase/sql/2026-09-23_makeup_sessions.sql
 */

export interface MakeupSession {
  id: number;
  date: string;
  classId: string | null;
  className: string;
  content: string;
  students: { id: string; name: string }[];
}

function nowStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type SessionRow = {
  id: number;
  session_date: string;
  class_id: number | null;
  content: string | null;
  classes: { name: string } | null;
  makeup_attendees: { student_id: number; students: { name: string } | null }[] | null;
};

/** 기간 안의 보강 기록(날짜순). */
export async function fetchMakeupSessions(fromDate: string, toDate: string): Promise<MakeupSession[]> {
  const { data, error } = await supabase
    .from('makeup_sessions')
    .select('id, session_date, class_id, content, classes ( name ), makeup_attendees ( student_id, students ( name ) )')
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
      .map((a) => ({ id: String(a.student_id), name: a.students?.name ?? '—' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
  }));
}

export async function createMakeupSession(params: {
  date: string;
  classId: string | null;
  content: string;
  studentIds: string[];
}): Promise<void> {
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
  const { error: attError } = await supabase
    .from('makeup_attendees')
    .insert(params.studentIds.map((sid) => ({ makeup_id: makeupId, student_id: Number(sid) })));
  if (attError) {
    await supabase.from('makeup_sessions').delete().eq('id', makeupId);
    throw attError;
  }
}

export async function deleteMakeupSession(id: number): Promise<void> {
  const { error } = await supabase.from('makeup_sessions').delete().eq('id', id);
  if (error) throw error;
}
