import { supabase } from './supabaseClient';

// [2026-08-30] 과제 인증 사진 / 참조 PDF를 저장할 Supabase Storage 버킷.
//
// 운영(스트림릿)은 사진을 압축해서 base64 텍스트로 DB 컬럼(hw_photos.photo_url)에
// 그대로 저장하고, 참조 PDF는 학원 컴퓨터의 로컬 폴더(hw_reference_files/)에
// 파일로 저장한다 — 둘 다 브라우저 앱에서는 그대로 쓸 수 없는 방식이라
// (브라우저는 학원 컴퓨터의 특정 폴더에 파일을 쓸 수 없음), React 쪽은 이번에
// Supabase Storage를 새로 도입해서 대체한다.
//
// 버킷은 dev 프로젝트(kpimhidgkrqtegcumrul)에 수동으로 미리 만들어둔 상태
// (Storage 화면에서 New bucket, 2026-08-30). 지금은 dev 환경 편의상 Public으로
// 열어뒀음 — 다른 테이블들의 RLS를 dev에서 꺼둔 것과 같은 이유·같은 위험도.
// 운영 전환 시 반드시 비공개로 다시 잠그고 서명된 URL 방식으로 바꿔야 함
// (academy-web_현황.md의 "운영 DB 전환 전 반드시 먼저 할 일" 체크리스트 참고).
const HW_PHOTO_BUCKET = 'hw-photos';
const HW_REFERENCE_BUCKET = 'hw-reference-pdfs';

function describeStorageError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    return String(e.message ?? e.error ?? e.statusCode ?? JSON.stringify(e));
  }
  return String(err);
}

/**
 * 학생이 올린 과제 인증 사진을 hw-photos 버킷에 업로드하고, 공개 URL을 반환한다.
 * path는 호출하는 쪽에서 고유하게 만들어서 넘긴다 (예:
 * `${submissionId}/${itemId}/${Date.now()}_${file.name}`).
 */
export async function uploadHwPhoto(file: File | Blob, path: string): Promise<string> {
  const { error } = await supabase.storage.from(HW_PHOTO_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: true,
    contentType: file instanceof File ? file.type || 'image/jpeg' : 'image/jpeg',
  });
  if (error) {
    throw new Error(`사진 업로드 실패: ${describeStorageError(error)}`);
  }
  const { data } = supabase.storage.from(HW_PHOTO_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * 선생님이 올린 참조 PDF(문제집/프린트 원본)를 hw-reference-pdfs 버킷에 업로드하고,
 * 공개 URL을 반환한다. path는 `{classId}/{materialName}.pdf` 형태 권장(스트림릿의
 * `{class_id}_{safe_material_name}.pdf` 파일명 규칙과 같은 의도 — 반+자료명으로
 * 유일하게 식별).
 */
export async function uploadReferencePdf(file: File | Blob, path: string): Promise<string> {
  const { error } = await supabase.storage.from(HW_REFERENCE_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: true,
    contentType: 'application/pdf',
  });
  if (error) {
    throw new Error(`참조 PDF 업로드 실패: ${describeStorageError(error)}`);
  }
  const { data } = supabase.storage.from(HW_REFERENCE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** 참조 PDF 삭제 (자료 교체/삭제 시 사용). */
export async function deleteReferencePdf(path: string): Promise<void> {
  const { error } = await supabase.storage.from(HW_REFERENCE_BUCKET).remove([path]);
  if (error) {
    throw new Error(`참조 PDF 삭제 실패: ${describeStorageError(error)}`);
  }
}
