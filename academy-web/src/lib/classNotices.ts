import { supabase } from './supabaseClient';

export interface ClassNotice {
  body: string;
  updatedAt: string;
}

// class_notices 테이블(supabase/sql/2026-09-28_class_notices.sql):
// id(SERIAL), class_id(INTEGER UNIQUE), body(TEXT), updated_at(TEXT).
// 반마다 한 행만 가짐 — 대시보드 공지(lib/notices.ts)처럼 지우기 전까지 계속 남음.
interface ClassNoticeRow {
  body: string;
  updated_at: string;
}

function nowStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 반 공지 조회. 아직 저장된 적 없으면 빈 값. */
export async function fetchClassNotice(classId: string): Promise<ClassNotice> {
  const { data, error } = await supabase
    .from('class_notices')
    .select('body, updated_at')
    .eq('class_id', Number(classId))
    .maybeSingle();
  if (error) {
    throw error;
  }
  const row = data as ClassNoticeRow | null;
  return { body: row?.body ?? '', updatedAt: row?.updated_at ?? '' };
}

/** 반 공지 저장(upsert). 빈 문자열로 저장하면 지운 것과 같음. */
export async function saveClassNotice(classId: string, body: string): Promise<string> {
  const updatedAt = nowStr();
  const { error } = await supabase
    .from('class_notices')
    .upsert({ class_id: Number(classId), body, updated_at: updatedAt }, { onConflict: 'class_id' });
  if (error) {
    throw error;
  }
  return updatedAt;
}
