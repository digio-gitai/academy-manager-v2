import { supabase } from './supabaseClient';
import * as pdfjsLib from 'pdfjs-dist';
// visionOcr.ts와 동일한 방식(Vite 전용 ?url import)으로 pdf.js 워커 파일 위치를 가져옴.
// eslint-disable-next-line import/no-unresolved
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { uploadReferencePdf, deleteReferencePdf } from './hwStorage';

// [2026-08-30 성능 수정] 아래 GlobalWorkerOptions 설정이 빠져있어서 PDF 페이지
// 수를 셀 때(getPdfPageCount) pdf.js가 "워커 스레드"를 못 찾고 브라우저 메인
// 스레드에서 느리게 처리했음(화면이 멈춘 것처럼 오래 걸리는 원인) —
// visionOcr.ts가 이미 쓰고 있는 것과 똑같은 워커 설정을 여기도 추가해서 해결.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// [2026-08-30] hw_reference.py(스트림릿) 대응 — 참조 PDF(문제집/프린트 원본)
// 등록·조회·삭제·페이지 오프셋 보정. 실제 dev DB 테이블 hw_reference_materials
// (id SERIAL, class_id FK→classes, material_name, file_path, page_count,
// page_offset INTEGER DEFAULT 0, uploaded_at, updated_at, UNIQUE(class_id, material_name))
// 대상. PDF 원본 파일은 hwStorage.ts를 통해 Supabase Storage(hw-reference-pdfs
// 버킷)에 저장 — 스트림릿처럼 학원 컴퓨터 로컬 폴더에 저장하는 방식은 브라우저
// 앱에서 불가능해서 이번에 클라우드 저장소로 대체함.
//
// AI 자동 오프셋 감지(auto_detect_page_offset, GPT-4o로 PDF 앞부분을 읽어서
// 추정)와 사진-페이지 AI 대조(run_ai_page_check_with_reference)는 서버 쪽에서
// PDF를 실제로 렌더링해서 GPT에 보내야 하는 기능이라 Edge Function이 필요함 —
// 이번 단계(2단계: 업로드/목록/삭제/수동 보정) 범위 밖, 다음 단계에서 추가 예정.
// 페이지 수(page_count)만은 브라우저에서 pdfjs-dist로 직접 셀 수 있어서 여기서
// 바로 처리함(같은 라이브러리를 visionOcr.ts가 이미 쓰고 있음).
//
// [2026-08-30 버그 수정] Storage 저장 경로에 한글 문제집 이름을 그대로 썼더니
// "Invalid key" 에러로 업로드가 항상 실패했음(Supabase Storage 객체 키는
// 영문/숫자/일부 기호만 허용). safeStorageFileName()에서 한글을 저장 경로에
// 남기지 않는 방식(영문/숫자만 남기고 이름 해시를 붙임)으로 해결 — 화면에
// 보이는 material_name은 DB 컬럼 그대로 한글 유지됨.
//
// [2026-08-30 실사용 확인] 대용량 PDF(23MB) 업로드가 6분 이상 걸린 사례 있었음 —
// 브라우저 개발자도구로 원인 추적한 결과 서버 응답은 빨랐고(대기 1.7초) 전부
// "요청 전송" 구간(클라이언트→서버 실제 전송)이었음 = 이 코드나 Supabase 설정
// 문제가 아니라 그 컴퓨터의 네트워크 업로드 속도 문제로 확인됨. 코드 쪽은 정상.

export interface ReferenceMaterial {
  id: number;
  classId: string;
  materialName: string;
  filePath: string; // Storage 안에서의 저장 경로(삭제 시 필요)
  fileUrl: string; // 공개 URL(다운로드/미리보기용)
  pageCount: number;
  pageOffset: number; // 0-indexed. 화면에는 항상 +1(몇 번째 장인지)로 보여줌 — 기존 mock과 동일한 표시 규칙.
  uploadedAt: string;
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    return String(e.message ?? e.details ?? e.hint ?? e.code ?? JSON.stringify(e));
  }
  return String(err);
}

function safeStorageFileName(name: string): string {
  // [2026-08-30, 2차 수정] encodeURIComponent로는 안 고쳐졌음 — 브라우저가
  // 요청을 보낼 때 어차피 URL을 다시 디코딩해서 서버가 실제로 받는 키는
  // 결국 원래의 한글 문자열과 같아지기 때문(그래서 같은 에러가 그대로 재현됨).
  // 그래서 이번엔 한글/특수문자를 아예 저장 경로에 남기지 않는 방식으로 바꿈:
  // 영문·숫자만 남기고(문제집 이름이 한글뿐이면 이 부분은 비게 됨), 원래
  // 이름 전체를 기반으로 만든 짧은 해시를 항상 붙여서 순수 영문 파일명을
  // 만듦. 같은 이름으로 재업로드하면 해시도 항상 같아서 여전히 같은 파일을
  // 덮어씀(= "같은 이름으로 재업로드 = 교체" 동작은 그대로 유지됨). 화면에
  // 보이는 문제집 이름(DB의 material_name 컬럼)은 한글 그대로 유지됨 — 이
  // 함수는 Storage 저장 경로에만 쓰임.
  const trimmed = name.trim();
  const asciiPart = trimmed
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  let hash = 0;
  for (let i = 0; i < trimmed.length; i++) {
    hash = (hash * 31 + trimmed.charCodeAt(i)) >>> 0;
  }
  const hashPart = hash.toString(36);
  return asciiPart ? `${asciiPart}-${hashPart}` : hashPart;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): ReferenceMaterial {
  const filePath = String(row.file_path ?? '');
  const { data } = supabase.storage.from('hw-reference-pdfs').getPublicUrl(filePath);
  return {
    id: Number(row.id),
    classId: String(row.class_id),
    materialName: String(row.material_name ?? ''),
    filePath,
    fileUrl: data.publicUrl,
    pageCount: Number(row.page_count ?? 0),
    pageOffset: Number(row.page_offset ?? 0),
    uploadedAt: String(row.uploaded_at ?? '').slice(0, 10),
    updatedAt: String(row.updated_at ?? ''),
  };
}

export async function fetchReferenceMaterials(classId: string): Promise<ReferenceMaterial[]> {
  const { data, error } = await supabase
    .from('hw_reference_materials')
    .select('id, class_id, material_name, file_path, page_count, page_offset, uploaded_at, updated_at')
    .eq('class_id', Number(classId))
    .order('material_name', { ascending: true });
  if (error) throw new Error(`참조 자료 목록을 불러오지 못했습니다: ${describeError(error)}`);
  return (data ?? []).map(mapRow);
}

async function getPdfPageCount(file: File): Promise<number> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  return pdf.numPages;
}

/**
 * 새 참조 PDF 등록. 같은 반+같은 자료명이 이미 있으면 덮어씀(DB의
 * UNIQUE(class_id, material_name) 제약을 그대로 살려서 재업로드 = 교체가
 * 되도록 upsert 처리 — "문제집이 끝나면 삭제 후 다음 문제집으로 교체"할 때도
 * 이름을 새로 지으면 별도 행, 같은 이름으로 다시 올리면 교체됨).
 */
export async function saveReferenceMaterial(
  classId: string,
  materialName: string,
  file: File,
  pageOffset: number
): Promise<ReferenceMaterial> {
  const trimmedName = materialName.trim();
  if (!trimmedName) throw new Error('문제집/프린트 이름을 입력해주세요.');

  const pageCount = await getPdfPageCount(file);
  const storagePath = `${classId}/${safeStorageFileName(trimmedName)}.pdf`;
  await uploadReferencePdf(file, storagePath);

  const ts = nowIso();
  const { data, error } = await supabase
    .from('hw_reference_materials')
    .upsert(
      {
        class_id: Number(classId),
        material_name: trimmedName,
        file_path: storagePath,
        page_count: pageCount,
        page_offset: Math.max(0, pageOffset),
        uploaded_at: ts,
        updated_at: ts,
      },
      { onConflict: 'class_id,material_name' }
    )
    .select('id, class_id, material_name, file_path, page_count, page_offset, uploaded_at, updated_at')
    .single();
  if (error) throw new Error(`참조 자료 저장에 실패했습니다: ${describeError(error)}`);
  return mapRow(data);
}

export async function updateReferenceMaterialOffset(id: number, pageOffset: number): Promise<void> {
  const { error } = await supabase
    .from('hw_reference_materials')
    .update({ page_offset: Math.max(0, pageOffset), updated_at: nowIso() })
    .eq('id', id);
  if (error) throw new Error(`보정값 저장에 실패했습니다: ${describeError(error)}`);
}

export async function deleteReferenceMaterial(material: ReferenceMaterial): Promise<void> {
  const { error } = await supabase.from('hw_reference_materials').delete().eq('id', material.id);
  if (error) throw new Error(`참조 자료 삭제에 실패했습니다: ${describeError(error)}`);
  try {
    await deleteReferencePdf(material.filePath);
  } catch {
    // DB 행은 이미 지워졌으니, 스토리지 파일 삭제 실패는 조용히 무시
    // (고아 파일 하나 남는 정도 — 치명적이지 않음).
  }
}
