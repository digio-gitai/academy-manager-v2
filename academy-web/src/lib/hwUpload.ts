import { supabase } from './supabaseClient';
import { uploadHwPhoto, compressPhotoForUpload } from './hwStorage';
import {
  fetchReferenceMaterials,
  fetchReferenceMaterialsByToken,
  getReferencePageImages,
  type ReferenceMaterial,
} from './hwReference';
import type { HwItemType } from '../types/homework';

// [2026-08-31] 학생용 과제 업로드 화면(3단계) 데이터/로직 레이어.
// 스트림릿 hw_upload.py를 그대로 이식 — 함수 이름도 최대한 대응시킴:
//   get_submission_by_token  → fetchUploadMeta
//   mark_viewed              → markViewed
//   get_items_with_state     → fetchUploadItems
//   save_submission          → submitUpload
//   format_page_ranges       → formatPageRanges
// 화면(UploadItemCard 등)은 이 파일이 내려주는 순수 함수(deriveItemState)로
// "오늘 시작~끝 페이지"에서 상태(완료 여부/사진 몇 장 필요한지/남은 페이지)를
// 계산하고, raw 입력(RawItemInput)은 페이지 컴포넌트(AssignmentUpload.tsx)가
// 소유한다 — 컴포넌트 쪽 state 동기화 문제를 피하려고 "입력값은 부모가 갖고,
// 계산된 값은 순수함수로 파생"하는 구조로 짰다.

export type HwUploadStatus = 'pending' | 'partial' | 'done';

export interface HwUploadMeta {
  /** 링크의 업로드 토큰 — 공개 화면은 테이블을 직접 읽지 않고 이 토큰으로 DB 함수를 부른다. */
  uploadToken: string;
  submissionId: string;
  assignmentId: string;
  studentId: string;
  classId: string;
  status: HwUploadStatus;
  title: string;
  dueDate: string;
  assignedDate: string;
  className: string;
  studentName: string;
  viewedAt: string | null;
  includeCommon: boolean;
}

export interface HwUploadItem {
  itemId: string;
  itemType: HwItemType;
  materialName: string;
  description: string;
  pageStart?: number;
  pageEnd?: number;
  excludedPages: number[]; // [2026-09-07 추가] "문제없는 페이지" — get_solvable_pages 계산용
  prevCompletedPages: number[];
  prevDone: boolean;
  prevNote: string;
  existingPhotoCount: number;
}

export interface RawItemInput {
  startPage: number;
  endPage: number;
  done: boolean;
  note: string;
  photos: File[];
}

export interface ItemFormState {
  done: boolean;
  note: string;
  completedPages: number[];
  photos: File[];
  photoRule: { kind: 'exact' | 'at_least'; need: number } | null;
  isPageRange: boolean;
  alreadyFull: boolean;
  remainingPages: number[];
  newPageCount: number;
  skippedPages: number[]; // [2026-09-07 추가] 오늘 범위 입력 중 문제없는 페이지라 자동 제외된 쪽
}

export interface HwUploadItemPayload {
  itemId: string;
  done: boolean;
  note: string;
  completedPages: number[];
  newPhotos: File[];
}

export interface HwUploadResult {
  overall: HwUploadStatus;
  doneCount: number;
  total: number;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    return String(e.message ?? e.details ?? e.hint ?? e.code ?? JSON.stringify(e));
  }
  return String(err);
}

export function parseCompletedPages(raw: string | null | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map(Number);
}

/** [1,2,3,5,6,9] → "1~3, 5~6, 9쪽" (hw_upload.py format_page_ranges 포팅). */
export function formatPageRanges(pages: number[]): string {
  const sorted = Array.from(new Set(pages)).sort((a, b) => a - b);
  if (sorted.length === 0) return '없음';
  const groups: number[][] = [];
  for (const p of sorted) {
    const last = groups[groups.length - 1];
    if (last && p === last[last.length - 1] + 1) {
      last.push(p);
    } else {
      groups.push([p]);
    }
  }
  const parts = groups.map((g) => (g.length > 1 ? `${g[0]}~${g[g.length - 1]}` : `${g[0]}`));
  return `${parts.join(', ')}쪽`;
}

/** "13,15,16" → [13,15,16] (excluded_pages 컬럼 파싱 — parseCompletedPages와 형식 동일). */
export function parseExcludedPages(raw: string | null | undefined): number[] {
  return parseCompletedPages(raw);
}

/**
 * [2026-09-07 추가] 페이지 범위에서 "문제없는 페이지(제외페이지)"를 뺀 실제로
 * 풀어야 하는 페이지 목록 — database.py get_solvable_pages() 포팅. 진도율
 * 계산·체크리스트·완료 판정 전부 이 함수 기준으로 통일한다.
 */
export function getSolvablePages(pageStart: number, pageEnd: number, excludedPages: number[]): number[] {
  if (!excludedPages || excludedPages.length === 0) {
    return Array.from({ length: pageEnd - pageStart + 1 }, (_, i) => pageStart + i);
  }
  const excluded = new Set(excludedPages);
  const pages: number[] = [];
  for (let p = pageStart; p <= pageEnd; p++) {
    if (!excluded.has(p)) pages.push(p);
  }
  return pages;
}

/**
 * 업로드 토큰으로 과제·학생·반 정보를 조회 — hw_upload.py get_submission_by_token() 대응.
 * [2026-10-24] 테이블을 직접 읽지 않고 DB 함수(hw_upload_meta)로 조회한다 — 학생·과제 테이블은
 * 로그인한 강사 계정만 읽도록 잠그고, 학생 링크는 "토큰이 맞는 제출 1건"만 받는다.
 */
export async function fetchUploadMeta(token: string): Promise<HwUploadMeta | null> {
  const { data, error } = await supabase.rpc('hw_upload_meta', { p_token: token });
  if (error) throw new Error(`과제 정보를 불러오지 못했습니다: ${describeError(error)}`);
  if (!data) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any;
  const assignment = row.hw_assignments;
  const student = row.students;

  return {
    uploadToken: token,
    submissionId: String(row.id),
    assignmentId: String(row.assignment_id),
    studentId: String(row.student_id),
    classId: String(assignment?.class_id ?? ''),
    status: row.status,
    title: assignment?.title ?? '',
    dueDate: assignment?.due_date ?? '',
    assignedDate: assignment?.assigned_date ?? '',
    className: assignment?.classes?.name ?? '',
    studentName: student?.name ?? '',
    viewedAt: row.viewed_at,
    includeCommon: (row.include_common as boolean | null) ?? true,
  };
}

/** 학생이 링크를 열었을 때 최초 1회만 열람 시각 기록 — hw_upload.py mark_viewed() 대응(규칙은 DB 함수 안). */
export async function markViewed(token: string): Promise<void> {
  await supabase.rpc('hw_upload_mark_viewed', { p_token: token });
}

/** 이 학생에게 보여줄 과제 항목 + 이전 제출 상태 — hw_upload.py get_items_with_state() 대응. */
export async function fetchUploadItems(meta: HwUploadMeta): Promise<HwUploadItem[]> {
  // [2026-10-24] 항목 + 이전 제출 상태(사진 개수 포함)를 DB 함수(hw_upload_items) 한 번으로 받는다.
  const { data, error } = await supabase.rpc('hw_upload_items', { p_token: meta.uploadToken });
  if (error) throw new Error(`과제 항목을 불러오지 못했습니다: ${describeError(error)}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let items = ((data as any[]) ?? []).slice();
  if (!meta.includeCommon) {
    items = items.filter((it) => it.student_id != null);
  }

  return items.map((it) => {
    const sub = it.sub as {
      status: string | null;
      completed_pages: string | null;
      student_note: string | null;
      photo_count: number | null;
    } | null;
    return {
      itemId: String(it.id),
      itemType: it.item_type as HwItemType,
      materialName: it.material_name,
      description: it.description || '',
      pageStart: it.page_start ?? undefined,
      pageEnd: it.page_end ?? undefined,
      excludedPages: parseExcludedPages(it.excluded_pages),
      prevCompletedPages: parseCompletedPages(sub?.completed_pages),
      prevDone: sub?.status === 'done',
      prevNote: sub?.student_note || '',
      existingPhotoCount: Number(sub?.photo_count ?? 0),
    };
  });
}

/** item.prevCompletedPages/prevDone만으로 "이 항목이 완료됐는지"를 판단(제출 후 요약 화면용). */
export function isItemDisplayDone(item: HwUploadItem): boolean {
  if (item.itemType !== 'page_range' || item.pageStart == null || item.pageEnd == null || item.pageStart > item.pageEnd) {
    return item.prevDone;
  }
  const set = new Set(item.prevCompletedPages);
  const solvable = getSolvablePages(item.pageStart, item.pageEnd, item.excludedPages);
  return solvable.every((p) => set.has(p));
}

/**
 * 항목 하나의 "오늘 입력값(raw)"을 화면에 필요한 계산된 상태로 바꾼다 —
 * hw_upload.py _render_page_range_item()/_render_simple_item()의 계산 부분
 * 포팅(그리기는 UploadItemCard.tsx가 담당). 순수 함수라 테스트/재사용이 쉽다.
 */
export function deriveItemState(item: HwUploadItem, raw: RawItemInput): ItemFormState {
  const isPageRange =
    item.itemType === 'page_range' && item.pageStart != null && item.pageEnd != null && item.pageStart <= item.pageEnd;

  if (!isPageRange) {
    const done = raw.done;
    return {
      done,
      note: raw.note,
      completedPages: [],
      photos: raw.photos,
      photoRule: done ? { kind: 'at_least', need: 1 } : null,
      isPageRange: false,
      alreadyFull: false,
      remainingPages: [],
      newPageCount: 0,
      skippedPages: [],
    };
  }

  const pageStart = item.pageStart!;
  const pageEnd = item.pageEnd!;
  const fullRange: number[] = getSolvablePages(pageStart, pageEnd, item.excludedPages);
  const fullRangeSet = new Set(fullRange);
  const prevSet = new Set(item.prevCompletedPages);
  const alreadyFull = fullRange.every((p) => prevSet.has(p));

  if (alreadyFull) {
    return {
      done: true,
      note: raw.note,
      completedPages: fullRange,
      photos: raw.photos,
      photoRule: null,
      isPageRange: true,
      alreadyFull: true,
      remainingPages: [],
      newPageCount: 0,
      skippedPages: [],
    };
  }

  // [2026-09-07 추가] "오늘 시작~마지막" 연속 범위 입력 안에 문제없는 페이지
  // (제외페이지)가 섞여 있으면 자동으로 빼고, 뺀 목록은 skippedPages로 돌려줘서
  // 화면에 안내 문구를 띄운다(hw_upload.py 이식과 동일한 정책).
  const rawRange: number[] =
    raw.endPage >= raw.startPage ? Array.from({ length: raw.endPage - raw.startPage + 1 }, (_, i) => raw.startPage + i) : [];
  const newRange = rawRange.filter((p) => fullRangeSet.has(p));
  const skippedPages = rawRange.filter((p) => !fullRangeSet.has(p));
  const mergedSet = new Set<number>([...item.prevCompletedPages, ...newRange]);
  const done = fullRange.every((p) => mergedSet.has(p));
  const remainingPages = fullRange.filter((p) => !mergedSet.has(p));

  return {
    done,
    note: raw.note,
    completedPages: Array.from(mergedSet).sort((a, b) => a - b),
    photos: raw.photos,
    photoRule: newRange.length > 0 ? { kind: 'exact', need: newRange.length } : null,
    isPageRange: true,
    alreadyFull: false,
    remainingPages,
    newPageCount: newRange.length,
    skippedPages,
  };
}

/**
 * 사진 한 장에 대해 AI 1차 페이지 검증을 실행하고 결과를 hw_photos에 기록한
 * 뒤 그 결과를 반환한다 — 스트림릿 hw_photo_review.run_ai_page_check()에
 * 대응. 반에 참조 PDF가 등록돼 있으면(materialName이 정확히 일치) 사진↔
 * 페이지 이미지 대조 방식을, 없으면 텍스트(인쇄 숫자 읽기) 방식을 자동으로
 * 쓴다. referenceMaterials를 미리 넘기면(같은 반 여러 사진을 한 번에 처리할
 * 때, 예: submitUpload) 반복 조회를 피할 수 있고, 안 넘기면(예: 선생님 화면의
 * "다시 확인" 버튼 — 사진 한 장만 다루므로) 이 함수가 classId로 직접 조회한다.
 *
 * [2026-09-01] 학생 업로드 자동 검증(submitUpload)과 선생님의 "다시 확인"
 * 버튼(RecentAssignmentsPanel)이 이 함수 하나를 공유해서 쓴다 — 두 진입점이
 * 서로 다른 검증 로직을 갖지 않도록 하기 위함.
 *
 * 실패해도 예외를 던지지 않는다 — 이 검증은 어디까지나 참고용 1차 판단이라,
 * 실패하더라도 호출한 쪽(학생 제출/선생님 재확인)의 나머지 동작을 막으면 안
 * 된다. 실패 시 guess/flag를 null로 반환하고 DB도 건드리지 않는다.
 */
export async function runPageVerification(
  photoId: number,
  photoUrl: string,
  classId: string,
  materialName: string,
  pageStart: number,
  pageEnd: number,
  referenceMaterials?: ReferenceMaterial[],
  /** 학생 링크에서 부를 때의 업로드 토큰 — 있으면 테이블을 직접 읽고 쓰지 않고 DB 함수로 처리한다. */
  uploadToken?: string
): Promise<{ guess: string | null; flag: string | null }> {
  let materials = referenceMaterials;
  if (!materials) {
    try {
      materials = uploadToken
        ? await fetchReferenceMaterialsByToken(uploadToken)
        : classId
          ? await fetchReferenceMaterials(classId)
          : [];
    } catch {
      materials = [];
    }
  }
  const material = materials.find((m) => m.materialName === materialName);

  let referencePages: { page: number; image: string }[] = [];
  if (material) {
    try {
      referencePages = await getReferencePageImages(material, pageStart, pageEnd);
    } catch {
      referencePages = [];
    }
  }

  try {
    const { data, error } = await supabase.functions.invoke<{
      guess?: string | null;
      flag?: string;
      message?: string;
      error?: string;
    }>('hw-verify-page', {
      body: { photoUrl, pageStart, pageEnd, referencePages, uploadToken, photoId },
    });
    if (error || !data || data.error) return { guess: null, flag: null };
    const guess = data.guess ?? null;
    const flag = data.flag ?? null;
    if (uploadToken) {
      await supabase.rpc('hw_upload_set_ai', { p_token: uploadToken, p_photo_id: photoId, p_guess: guess, p_flag: flag });
    } else {
      await supabase.from('hw_photos').update({ ai_page_guess: guess, ai_flag: flag }).eq('id', photoId);
    }
    return { guess, flag };
  } catch {
    return { guess: null, flag: null };
  }
}

/**
 * 항목별 완료 체크·메모·새 사진 저장 + 전체 제출 상태 갱신 — hw_upload.py
 * save_submission() 대응.
 *
 * [2026-09-01] 과제인증 4단계(2/3): 사진을 저장한 직후, 그 항목이
 * 페이지범위형(page_range)이면 AI 1차 페이지 검증을 자동으로 실행해서
 * hw_photos.ai_page_guess/ai_flag를 채운다(스트림릿과 동일하게 "학생이
 * 사진을 올리는 순간" 자동 실행). 반에 참조 PDF가 등록돼 있고 문제집 이름이
 * 이 항목과 정확히 같으면 사진↔페이지 대조 방식을, 아니면 텍스트(인쇄 숫자
 * 읽기) 방식을 자동으로 씀. 오답정리형 항목/페이지 정보가 없는 항목은 검증
 * 대상이 아니라 건너뜀. 검증이 실패해도(네트워크 오류 등) 학생 제출 자체는
 * 그대로 성공 처리된다 — 최종 확인은 어차피 선생님 몫이라 이 1차 검증은
 * "최선을 다하되 실패해도 무방한" 부가 기능으로 다룬다.
 */
export async function submitUpload(
  meta: HwUploadMeta,
  items: HwUploadItemPayload[],
  itemsMeta: HwUploadItem[]
): Promise<HwUploadResult> {
  // [2026-10-24] 테이블을 직접 쓰지 않고 DB 함수(hw_upload_*)로 저장한다 — 함수가 토큰으로 이
  // 제출에 속한 항목·사진인지 확인하므로 다른 학생의 기록은 건드릴 수 없다. 저장 순서와
  // 사진 업로드·AI 확인 흐름은 이전과 같다.
  const token = meta.uploadToken;
  const classId = meta.classId;
  const submissionIdNum = Number(meta.submissionId);
  let doneCount = 0;
  let anyDone = false;
  let allDone = true;

  const metaById = new Map<string, HwUploadItem>(itemsMeta.map((it) => [it.itemId, it]));

  // 이 반에 등록된 참조 자료 목록은 제출 전체에서 한 번만 조회(항목마다 매번
  // 조회하지 않음). 조회 자체가 실패해도(예: 네트워크 문제) 참고용 기능이니
  // 빈 목록으로 취급해서 전체가 텍스트 인식 방식으로 자연스럽게 폴백되게 함.
  let referenceMaterials: ReferenceMaterial[] = [];
  try {
    referenceMaterials = await fetchReferenceMaterialsByToken(token);
  } catch {
    referenceMaterials = [];
  }

  for (const it of items) {
    const status = it.done ? 'done' : 'not_done';
    if (it.done) {
      doneCount += 1;
      anyDone = true;
    } else {
      allDone = false;
    }
    const completedPagesStr = Array.from(new Set(it.completedPages))
      .sort((a, b) => a - b)
      .join(',');

    const { data: savedId, error: upsertErr } = await supabase.rpc('hw_upload_save_item', {
      p_token: token,
      p_item_id: Number(it.itemId),
      p_status: status,
      p_completed_pages: completedPagesStr,
      p_note: it.note.trim(),
    });
    if (upsertErr) throw new Error(`저장에 실패했습니다: ${describeError(upsertErr)}`);
    const itemSubmissionId = Number(savedId);

    const itemMeta = metaById.get(it.itemId);
    const isPageRange =
      itemMeta?.itemType === 'page_range' &&
      itemMeta.pageStart != null &&
      itemMeta.pageEnd != null &&
      itemMeta.pageStart <= itemMeta.pageEnd;

    for (let i = 0; i < it.newPhotos.length; i++) {
      const file = it.newPhotos[i];
      const blob = await compressPhotoForUpload(file);
      const path = `${submissionIdNum}/${it.itemId}/${Date.now()}_${i}.jpg`;
      const photoUrl = await uploadHwPhoto(blob, path);
      const { data: insertedPhotoId, error: photoErr } = await supabase.rpc('hw_upload_add_photo', {
        p_token: token,
        p_item_submission_id: itemSubmissionId,
        p_photo_url: photoUrl,
      });
      if (photoErr) throw new Error(`사진 저장에 실패했습니다: ${describeError(photoErr)}`);

      if (isPageRange) {
        const photoId = Number(insertedPhotoId);
        try {
          await runPageVerification(
            photoId,
            photoUrl,
            classId,
            itemMeta!.materialName,
            itemMeta!.pageStart!,
            itemMeta!.pageEnd!,
            referenceMaterials,
            token
          );
        } catch {
          // AI 1차 검증은 참고용일 뿐이라 실패해도 제출 자체는 계속 진행.
        }
      }
    }
  }

  const overall: HwUploadStatus = items.length === 0 ? 'pending' : allDone ? 'done' : anyDone ? 'partial' : 'pending';
  const { error: subErr } = await supabase.rpc('hw_upload_finish', { p_token: token, p_status: overall });
  if (subErr) throw new Error(`제출 상태 갱신에 실패했습니다: ${describeError(subErr)}`);

  return { overall, doneCount, total: items.length };
}
