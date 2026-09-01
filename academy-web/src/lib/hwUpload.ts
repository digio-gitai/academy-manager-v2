import { supabase } from './supabaseClient';
import { uploadHwPhoto, compressPhotoForUpload } from './hwStorage';
import { fetchReferenceMaterials, getReferencePageImages, type ReferenceMaterial } from './hwReference';
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

function nowStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

/** 업로드 토큰으로 과제·학생·반 정보를 조회 — hw_upload.py get_submission_by_token() 대응. */
export async function fetchUploadMeta(token: string): Promise<HwUploadMeta | null> {
  const { data, error } = await supabase
    .from('hw_submissions')
    .select(
      `
        id, assignment_id, student_id, status, viewed_at,
        hw_assignments ( title, due_date, assigned_date, class_id, classes ( name ) ),
        students ( name )
      `,
    )
    .eq('upload_token', token)
    .maybeSingle();
  if (error) throw new Error(`과제 정보를 불러오지 못했습니다: ${describeError(error)}`);
  if (!data) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any;
  const assignment = row.hw_assignments;
  const student = row.students;

  const { data: targetRow } = await supabase
    .from('hw_assignment_targets')
    .select('include_common')
    .eq('assignment_id', row.assignment_id)
    .eq('student_id', row.student_id)
    .maybeSingle();

  return {
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
    includeCommon: (targetRow as { include_common: boolean | null } | null)?.include_common ?? true,
  };
}

/** 학생이 링크를 열었을 때 최초 1회만 열람 시각 기록 — hw_upload.py mark_viewed() 대응. */
export async function markViewed(submissionId: string): Promise<void> {
  const { data } = await supabase
    .from('hw_submissions')
    .select('viewed_at')
    .eq('id', Number(submissionId))
    .maybeSingle();
  if ((data as { viewed_at: string | null } | null)?.viewed_at) return;
  await supabase.from('hw_submissions').update({ viewed_at: nowStr() }).eq('id', Number(submissionId));
}

/** 이 학생에게 보여줄 과제 항목 + 이전 제출 상태 — hw_upload.py get_items_with_state() 대응. */
export async function fetchUploadItems(meta: HwUploadMeta): Promise<HwUploadItem[]> {
  const assignmentId = Number(meta.assignmentId);
  const studentId = Number(meta.studentId);
  const submissionId = Number(meta.submissionId);

  const { data: itemRows, error: itemErr } = await supabase
    .from('hw_items')
    .select('id, item_type, material_name, page_start, page_end, description, student_id, sort_order')
    .eq('assignment_id', assignmentId)
    .or(`student_id.is.null,student_id.eq.${studentId}`)
    .order('sort_order', { ascending: true });
  if (itemErr) throw new Error(`과제 항목을 불러오지 못했습니다: ${describeError(itemErr)}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let items = (itemRows as any[]) ?? [];
  if (!meta.includeCommon) {
    items = items.filter((it) => it.student_id != null);
  }

  const { data: subRows, error: subErr } = await supabase
    .from('hw_item_submissions')
    .select('id, item_id, status, completed_pages, student_note, hw_photos ( id )')
    .eq('submission_id', submissionId);
  if (subErr) throw new Error(`제출 이력을 불러오지 못했습니다: ${describeError(subErr)}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subByItemId = new Map<number, any>();
  ((subRows as any[]) ?? []).forEach((r) => subByItemId.set(r.item_id, r));

  return items.map((it) => {
    const sub = subByItemId.get(it.id);
    return {
      itemId: String(it.id),
      itemType: it.item_type as HwItemType,
      materialName: it.material_name,
      description: it.description || '',
      pageStart: it.page_start ?? undefined,
      pageEnd: it.page_end ?? undefined,
      prevCompletedPages: parseCompletedPages(sub?.completed_pages),
      prevDone: sub?.status === 'done',
      prevNote: sub?.student_note || '',
      existingPhotoCount: ((sub?.hw_photos as unknown[] | null) ?? []).length,
    };
  });
}

/** item.prevCompletedPages/prevDone만으로 "이 항목이 완료됐는지"를 판단(제출 후 요약 화면용). */
export function isItemDisplayDone(item: HwUploadItem): boolean {
  if (item.itemType !== 'page_range' || item.pageStart == null || item.pageEnd == null || item.pageStart > item.pageEnd) {
    return item.prevDone;
  }
  const set = new Set(item.prevCompletedPages);
  for (let p = item.pageStart; p <= item.pageEnd; p++) {
    if (!set.has(p)) return false;
  }
  return true;
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
    };
  }

  const pageStart = item.pageStart!;
  const pageEnd = item.pageEnd!;
  const fullRange: number[] = [];
  for (let p = pageStart; p <= pageEnd; p++) fullRange.push(p);
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
    };
  }

  const newRange: number[] =
    raw.endPage >= raw.startPage ? Array.from({ length: raw.endPage - raw.startPage + 1 }, (_, i) => raw.startPage + i) : [];
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
  };
}

/**
 * 사진 한 장에 대해 AI 1차 페이지 검증을 실행하고 결과를 hw_photos에 기록한다.
 * 스트림릿 hw_photo_review.run_ai_page_check()에 대응 — 참조 자료가 있으면
 * 사진↔페이지 이미지 대조(referencePages를 채워서 호출), 없으면 빈 배열로
 * 호출해 Edge Function이 텍스트(인쇄 숫자 읽기) 방식으로 자동 전환하게 한다.
 * 실패해도 예외를 던지지 않는다 — 이 검증은 어디까지나 참고용 1차 판단이라
 * 실패하더라도 학생의 과제 제출 자체를 막으면 안 된다(호출부에서 그렇게
 * 감싸 쓴다).
 */
async function verifyUploadedPhoto(
  photoId: number,
  photoUrl: string,
  pageStart: number,
  pageEnd: number,
  referencePages: { page: number; image: string }[]
): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{
    guess?: string | null;
    flag?: string;
    message?: string;
    error?: string;
  }>('hw-verify-page', {
    body: { photoUrl, pageStart, pageEnd, referencePages },
  });
  if (error || !data || data.error) return; // 참고용 기능이라 실패는 조용히 무시
  await supabase
    .from('hw_photos')
    .update({ ai_page_guess: data.guess ?? null, ai_flag: data.flag ?? null })
    .eq('id', photoId);
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
  submissionId: string,
  items: HwUploadItemPayload[],
  itemsMeta: HwUploadItem[],
  classId: string
): Promise<HwUploadResult> {
  const submissionIdNum = Number(submissionId);
  const now = nowStr();
  let doneCount = 0;
  let anyDone = false;
  let allDone = true;

  const metaById = new Map<string, HwUploadItem>(itemsMeta.map((it) => [it.itemId, it]));

  // 이 반에 등록된 참조 자료 목록은 제출 전체에서 한 번만 조회(항목마다 매번
  // 조회하지 않음). 조회 자체가 실패해도(예: 네트워크 문제) 참고용 기능이니
  // 빈 목록으로 취급해서 전체가 텍스트 인식 방식으로 자연스럽게 폴백되게 함.
  let referenceMaterials: ReferenceMaterial[] = [];
  if (classId) {
    try {
      referenceMaterials = await fetchReferenceMaterials(classId);
    } catch {
      referenceMaterials = [];
    }
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

    const { data: upserted, error: upsertErr } = await supabase
      .from('hw_item_submissions')
      .upsert(
        {
          submission_id: submissionIdNum,
          item_id: Number(it.itemId),
          status,
          completed_pages: completedPagesStr,
          student_note: it.note.trim(),
          updated_at: now,
        },
        { onConflict: 'submission_id,item_id' },
      )
      .select('id')
      .single();
    if (upsertErr) throw new Error(`저장에 실패했습니다: ${describeError(upsertErr)}`);
    const itemSubmissionId = (upserted as { id: number }).id;

    const meta = metaById.get(it.itemId);
    const isPageRange =
      meta?.itemType === 'page_range' && meta.pageStart != null && meta.pageEnd != null && meta.pageStart <= meta.pageEnd;
    const material = isPageRange
      ? referenceMaterials.find((m) => m.materialName === meta!.materialName)
      : undefined;
    let referencePages: { page: number; image: string }[] = [];
    if (isPageRange && material) {
      try {
        referencePages = await getReferencePageImages(material, meta!.pageStart!, meta!.pageEnd!);
      } catch {
        referencePages = [];
      }
    }

    for (let i = 0; i < it.newPhotos.length; i++) {
      const file = it.newPhotos[i];
      const blob = await compressPhotoForUpload(file);
      const path = `${submissionIdNum}/${it.itemId}/${Date.now()}_${i}.jpg`;
      const photoUrl = await uploadHwPhoto(blob, path);
      const { data: insertedPhoto, error: photoErr } = await supabase
        .from('hw_photos')
        .insert({ item_submission_id: itemSubmissionId, photo_url: photoUrl, uploaded_at: now })
        .select('id')
        .single();
      if (photoErr) throw new Error(`사진 저장에 실패했습니다: ${describeError(photoErr)}`);

      if (isPageRange) {
        const photoId = (insertedPhoto as { id: number }).id;
        try {
          await verifyUploadedPhoto(photoId, photoUrl, meta!.pageStart!, meta!.pageEnd!, referencePages);
        } catch {
          // AI 1차 검증은 참고용일 뿐이라 실패해도 제출 자체는 계속 진행.
        }
      }
    }
  }

  const overall: HwUploadStatus = items.length === 0 ? 'pending' : allDone ? 'done' : anyDone ? 'partial' : 'pending';
  const { error: subErr } = await supabase
    .from('hw_submissions')
    .update({ status: overall, submitted_at: now })
    .eq('id', submissionIdNum);
  if (subErr) throw new Error(`제출 상태 갱신에 실패했습니다: ${describeError(subErr)}`);

  return { overall, doneCount, total: items.length };
}
