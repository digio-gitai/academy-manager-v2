import { supabase } from './supabaseClient';

export type NoticeType = 'weekly' | 'monthly';

export interface Notice {
  body: string;
  updatedAt: string;
}

// dev DB academy_notices 테이블(app.py 기준, 스키마 복제 이전부터 있던 오래된
// 테이블이라 신뢰 가능): id(SERIAL), notice_type(TEXT UNIQUE, 'weekly'|'monthly'),
// body(TEXT), updated_at(TEXT). 대시보드 새로고침할 때마다 weekly/monthly를
// 각각 한 행씩만 가짐(그래서 select 결과는 항상 0건 또는 1건).
interface NoticeRow {
  body: string;
  updated_at: string;
}

function nowStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Weekly/Monthly 공지 조회 (app.py의 get_academy_notice 대응). 아직 저장된 적 없으면 빈 값. */
export async function fetchNotice(type: NoticeType): Promise<Notice> {
  const { data, error } = await supabase
    .from('academy_notices')
    .select('body, updated_at')
    .eq('notice_type', type)
    .maybeSingle();
  if (error) {
    throw error;
  }
  const row = data as NoticeRow | null;
  return { body: row?.body ?? '', updatedAt: row?.updated_at ?? '' };
}

/** Weekly/Monthly 공지 저장(upsert). app.py의 save_academy_notice 대응. */
export async function saveNotice(type: NoticeType, body: string): Promise<string> {
  const updatedAt = nowStr();
  const { error } = await supabase
    .from('academy_notices')
    .upsert({ notice_type: type, body, updated_at: updatedAt }, { onConflict: 'notice_type' });
  if (error) {
    throw error;
  }
  return updatedAt;
}
