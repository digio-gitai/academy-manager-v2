import { createClient } from '@supabase/supabase-js';

// dev용 Supabase(kpimhidgkrqtegcumrul) 접속 클라이언트.
// URL/키는 .env.local에서 읽어옴 — 이 파일 안에 값을 직접 적지 않음
// (나중에 운영 DB로 바꿀 때도 .env.local 값만 바꾸면 되도록).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // 값이 비어 있으면 이상한 동작 대신 바로 에러로 멈추게 함
  // (academy_dev의 "비어있으면 안전하게 에러로 멈춘다" 원칙과 동일)
  throw new Error(
    '[supabaseClient] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY가 설정되지 않았습니다. ' +
      '.env.local 파일을 확인하세요.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
