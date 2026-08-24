import { supabase } from './supabaseClient';
import type { ConsultationCategory, ConsultationLogEntry } from '../types/consultation';

// dev Supabase(kpimhidgkrqtegcumrul)의 consultation_logs 테이블(app.py 기준 스키마):
//   id SERIAL, student_id INTEGER, category TEXT
//   (general/progress/parent/behavior/other 중 하나, CHECK 제약),
//   note TEXT NOT NULL, author TEXT DEFAULT '', created_at TEXT NOT NULL
//   ("YYYY-MM-DD HH:mm" 형식 문자열 — 스트림릿 쪽과 동일한 포맷으로 맞춤)
interface ConsultationLogRow {
  id: number;
  category: string;
  note: string;
  author: string | null;
  created_at: string;
}

function nowStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 특정 학생의 상담 이력을 최신순으로 조회 (app.py의 get_consultation_logs_for_student 대응). */
export async function fetchConsultationLogs(studentId: string): Promise<ConsultationLogEntry[]> {
  const { data, error } = await supabase
    .from('consultation_logs')
    .select('id, category, note, author, created_at')
    .eq('student_id', Number(studentId))
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

  if (error) {
    throw error;
  }

  return ((data as ConsultationLogRow[]) ?? []).map((row) => ({
    id: String(row.id),
    studentId,
    category: (row.category as ConsultationCategory) ?? 'general',
    note: row.note,
    author: row.author ?? '',
    createdAt: row.created_at,
  }));
}

/** 새 상담 메모 저장 (app.py의 add_consultation_log 대응). */
export async function addConsultationLog(params: {
  studentId: string;
  category: ConsultationCategory;
  note: string;
  author: string;
}): Promise<void> {
  const note = params.note.trim();
  if (!note) {
    throw new Error('메모 내용을 입력해 주세요.');
  }

  const { error } = await supabase.from('consultation_logs').insert({
    student_id: Number(params.studentId),
    category: params.category,
    note,
    author: params.author.trim(),
    created_at: nowStr(),
  });

  if (error) {
    throw error;
  }
}

/** 상담 메모 삭제 (app.py의 delete_consultation_log 대응). */
export async function deleteConsultationLog(logId: string): Promise<void> {
  const { error } = await supabase.from('consultation_logs').delete().eq('id', Number(logId));
  if (error) {
    throw error;
  }
}
