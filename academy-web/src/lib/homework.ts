import { supabase } from './supabaseClient';
import type {
  HwAssignment,
  HwItem,
  HwItemPhotoGroup,
  HwItemStatus,
  HwItemType,
  HwSubmission,
  HwSubmissionItemState,
  HwSubmissionStatus,
} from '../types/homework';

// dev Supabase 실제 스키마(2026-08-26, database.py/hw_assign.py/hw_upload.py/
// hw_photo_review.py 소스 확인). hw_ 테이블 6개:
//   hw_assignments(id, class_id, title, assigned_date, due_date, created_by, created_at, updated_at)
//   hw_assignment_targets(id, assignment_id, student_id, requires_certification,
//     include_common BOOLEAN NOT NULL DEFAULT TRUE, UNIQUE(assignment_id,student_id))
//   hw_items(id, assignment_id, item_type CHECK IN('page_range','wrong_note'),
//     material_name, page_start, page_end, description, student_id(NULL=공통), sort_order, created_at)
//   hw_submissions(id, assignment_id, student_id, upload_token UNIQUE,
//     status CHECK IN('pending','partial','done'), viewed_at, submitted_at, notified_at,
//     created_at, UNIQUE(assignment_id,student_id))
//   hw_item_submissions(id, submission_id, item_id, status CHECK IN('done','not_done'),
//     completed_pages TEXT(콤마구분 숫자), student_note, updated_at, UNIQUE(submission_id,item_id))
//   hw_photos(id, item_submission_id, photo_url, uploaded_at, ai_page_guess, ai_flag,
//     teacher_verified, teacher_verified_at)
// (hw_reference_materials는 참조 PDF 대조 기능용 — ReferenceUploadSection이 아직
//  mock 단계라 이 파일에서 다루지 않음)
//
// React 쪽 타입(types/homework.ts)은 학생 개인 화면(AssignmentUpload.tsx, mock
// 단계라 이번에 안 건드림) 기준으로 상태를 not_viewed/viewed/done 3단계로 단순화
// 해뒀는데, 실제 DB(hw_upload.py)는 pending/partial/done + viewed_at 조합으로 더
// 세분화(compute_display_status: 완료/일부완료/열람 후 미완료/미열람+기한초과)
// 되어 있다. 화면 컴포넌트(RecentAssignmentsPanel 등)를 이번 단계에서 다시
// 안 뜯기로 했으므로, 아래 mapSubmissionStatus()에서 DB의 4단계를 기존 3단계
// 타입에 맞춰 내려서 씀(partial/열람함 둘 다 'viewed'로 합침) — 나중에 학생
// 업로드 페이지를 실제로 연동할 때 이 3단계 타입 자체를 확장하는 걸 고려할 것.
//
// [2026-09-03] "완료·미완료 일괄 발송"은 실제 발송으로 전환함 — 아래
// buildHwSmsText()/markNotified() 참고. Solapi 직접 호출은 여전히 브라우저에서
// 안 하고, 이미 배포되어 있는 send-sms Edge Function(lib/smsSend.ts의
// sendBulkSms, "SMS발송" 메뉴가 쓰던 것과 동일)을 학생 1명씩 재사용한다 —
// send-sms가 "여러 명에게 같은 문구"만 지원해서, 학생마다 다른 완료/미완료
// 문구를 보내려면 1명씩 호출해야 함(Edge Function 새로 안 만들어도 됨).
// "업로드 링크 개별 발송"은 여전히 데모임 — academy-web이 아직 공개 배포되지
// 않아서(로컬 개발 서버뿐) 실제 링크를 보내면 학부모가 못 여는 깨진 링크가
// 되므로, 배포 전까지는 의도적으로 보류함(2026-09-03 사용자에게 설명함).
//
// 선생님 사진 확인(hw_photos.teacher_verified)은 외부 API 호출이 아니라 단순
// DB 값 갱신이라 실제로 씀 — toggleTeacherVerified() 참고.

interface ItemDraftInput {
  itemType: HwItemType;
  materialName: string;
  pageStart?: number;
  pageEnd?: number;
  description?: string;
}

interface RawTarget {
  student_id: number;
  requires_certification: boolean;
  include_common: boolean | null;
}

interface RawItem {
  id: number;
  item_type: HwItemType;
  material_name: string;
  page_start: number | null;
  page_end: number | null;
  description: string | null;
  student_id: number | null;
  sort_order: number;
}

interface RawPhoto {
  id: number;
  teacher_verified: boolean;
}

interface RawItemSubmission {
  id: number;
  item_id: number;
  status: 'done' | 'not_done';
  completed_pages: string | null;
  hw_photos: RawPhoto[] | null;
}

interface RawSubmission {
  id: number;
  student_id: number;
  status: 'pending' | 'partial' | 'done';
  viewed_at: string | null;
  notified_at: string | null;
  hw_item_submissions: RawItemSubmission[] | null;
}

interface RawAssignment {
  id: number;
  class_id: number | null;
  title: string;
  assigned_date: string;
  due_date: string | null;
  hw_assignment_targets: RawTarget[] | null;
  hw_items: RawItem[] | null;
  hw_submissions: RawSubmission[] | null;
}

/**
 * 과제 완료/미완료 요약 문자 문구 — 운영 스트림릿 hw_assign.py의
 * _build_hw_sms_text()를 그대로 이식(문구 형식까지 동일하게 맞춤).
 * branding.py의 SMS_GREETING("안녕하세요, 수학 정재훈T입니다.")도 그대로 씀.
 */
export const HW_SMS_GREETING = '안녕하세요, 수학 정재훈T입니다.';

export function buildHwSmsText(params: {
  studentName: string;
  assignedDate: string;
  title: string;
  itemStates: HwSubmissionItemState[];
  items: HwItem[];
}): { text: string; allDone: boolean } {
  const { studentName, assignedDate, title, itemStates, items } = params;
  const itemById = new Map(items.map((it) => [it.id, it]));
  const lines: string[] = [];
  let allDone = true;

  for (const state of itemStates) {
    const item = itemById.get(state.itemId);
    if (!item) continue;
    const hasPages = item.itemType === 'page_range' && item.pageStart != null && item.pageEnd != null;
    if (hasPages) {
      const pageStart = item.pageStart as number;
      const pageEnd = item.pageEnd as number;
      const totalPages = pageEnd - pageStart + 1;
      const fullRange = new Set<number>();
      for (let p = pageStart; p <= pageEnd; p += 1) fullRange.add(p);
      const donePages = state.completedPages.filter((p) => fullRange.has(p));
      if (totalPages > 0 && donePages.length >= totalPages) {
        lines.push(`- ${item.materialName}: 완료`);
      } else {
        allDone = false;
        lines.push(`- ${item.materialName}: 미완료(${donePages.length}/${totalPages}쪽)`);
      }
    } else if (state.status === 'done') {
      lines.push(`- ${item.materialName}: 완료`);
    } else {
      allDone = false;
      lines.push(`- ${item.materialName}: 미완료`);
    }
  }

  const overall = allDone ? '완료' : '미완료';
  const text = `${HW_SMS_GREETING}\n${studentName} 학생 ${assignedDate} 과제(${title}) 현황 — ${overall}\n${lines.join('\n')}`;
  return { text, allDone };
}

/**
 * 이 제출건에 학부모 문자를 보냈다고 기록(hw_submissions.notified_at) — 운영
 * mark_notified()와 동일 목적(같은 학생에게 수동/야간자동이 겹쳐서 문자가
 * 두 번 가는 걸 막기 위한 "오늘 이미 보냈는지" 판단 기준).
 */
export async function markNotified(submissionId: string): Promise<void> {
  const { error } = await supabase
    .from('hw_submissions')
    .update({ notified_at: nowStr() })
    .eq('id', submissionId);
  if (error) {
    throw error;
  }
}

export interface HwClassData {
  assignments: HwAssignment[];
  items: HwItem[];
  submissions: HwSubmission[];
}

function nowStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function isToday(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return dateStr.slice(0, 10) === todayStr();
}

function newUploadToken(): string {
  const raw = (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`).replace(
    /-/g,
    '',
  );
  return raw.slice(0, 16);
}

function parseCompletedPages(raw: string | null): number[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map(Number);
}

/** DB의 4단계 상태(pending/partial/done + viewed_at)를 화면 3단계 타입으로 축약. */
function mapSubmissionStatus(dbStatus: string, viewedAt: string | null): HwSubmissionStatus {
  if (dbStatus === 'done') return 'done';
  if (dbStatus === 'partial') return 'viewed';
  return viewedAt ? 'viewed' : 'not_viewed';
}

function mapAssignment(row: RawAssignment): { assignment: HwAssignment; items: HwItem[]; submissions: HwSubmission[] } {
  const assignmentId = String(row.id);
  const targets = row.hw_assignment_targets ?? [];
  const studentIds = targets.map((t) => String(t.student_id));
  const noCertStudentIds = targets.filter((t) => !t.requires_certification).map((t) => String(t.student_id));
  const includeCommonByStudent: Record<string, boolean> = {};
  targets.forEach((t) => {
    includeCommonByStudent[String(t.student_id)] = t.include_common ?? true;
  });

  const assignment: HwAssignment = {
    id: assignmentId,
    classId: String(row.class_id),
    title: row.title,
    assignedDate: row.assigned_date,
    dueDate: row.due_date || undefined,
    studentIds,
    noCertStudentIds,
    includeCommonByStudent,
  };

  const sortedRawItems = [...(row.hw_items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const items: HwItem[] = sortedRawItems.map((it) => ({
    id: String(it.id),
    assignmentId,
    itemType: it.item_type,
    materialName: it.material_name,
    pageStart: it.page_start ?? undefined,
    pageEnd: it.page_end ?? undefined,
    description: it.description || undefined,
    studentId: it.student_id != null ? String(it.student_id) : undefined,
  }));

  const submissions: HwSubmission[] = (row.hw_submissions ?? []).map((s) => {
    const itemStates = (s.hw_item_submissions ?? []).map((isub) => ({
      itemId: String(isub.item_id),
      completedPages: parseCompletedPages(isub.completed_pages),
      status: (isub.status === 'done' ? 'done' : 'incomplete') as HwItemStatus,
    }));
    const allPhotos = (s.hw_item_submissions ?? []).flatMap((isub) => isub.hw_photos ?? []);
    return {
      id: String(s.id),
      assignmentId,
      studentId: String(s.student_id),
      status: mapSubmissionStatus(s.status, s.viewed_at),
      teacherVerified: allPhotos.length > 0 && allPhotos.every((p) => p.teacher_verified),
      hasPhoto: allPhotos.length > 0,
      notifiedToday: isToday(s.notified_at),
      itemStates,
    };
  });

  return { assignment, items, submissions };
}

/** 반 하나의 과제 인증 데이터 전체(과제+대상학생+항목+제출현황) 조회. */
export async function fetchHomeworkForClass(classId: string): Promise<HwClassData> {
  const { data, error } = await supabase
    .from('hw_assignments')
    .select(
      `
        id, class_id, title, assigned_date, due_date,
        hw_assignment_targets ( student_id, requires_certification, include_common ),
        hw_items ( id, item_type, material_name, page_start, page_end, description, student_id, sort_order ),
        hw_submissions (
          id, student_id, status, viewed_at, notified_at,
          hw_item_submissions (
            id, item_id, status, completed_pages,
            hw_photos ( id, teacher_verified )
          )
        )
      `,
    )
    .eq('class_id', Number(classId))
    .order('assigned_date', { ascending: false });

  if (error) {
    throw error;
  }

  const rows = (data as unknown as RawAssignment[]) ?? [];
  const assignments: HwAssignment[] = [];
  const items: HwItem[] = [];
  const submissions: HwSubmission[] = [];
  rows.forEach((row) => {
    const mapped = mapAssignment(row);
    assignments.push(mapped.assignment);
    items.push(...mapped.items);
    submissions.push(...mapped.submissions);
  });

  return { assignments, items, submissions };
}

/**
 * 항목 동기화 — hw_assign.py save_assignment()/save_individual_items()의 항목
 * 처리 로직 포팅. (item_type, material_name) 조합으로 기존 항목과 매칭해서
 * id를 최대한 재사용한다 — id가 유지돼야 그 항목에 이미 쌓인 학생 제출기록
 * (hw_item_submissions, hw_photos)이 삭제되지 않고 그대로 이어진다. 매칭 안 된
 * 새 항목은 새로 INSERT, 이번에 안 쓰인 기존 항목은 DELETE(연쇄로 그 항목의
 * 제출기록도 함께 삭제됨 — 항목 자체가 없어졌으니 자연스러운 동작).
 */
async function syncItems(assignmentId: number, studentId: number | null, drafts: ItemDraftInput[]): Promise<void> {
  let existingQuery = supabase.from('hw_items').select('id, item_type, material_name').eq('assignment_id', assignmentId);
  existingQuery = studentId === null ? existingQuery.is('student_id', null) : existingQuery.eq('student_id', studentId);
  const { data: existingRows, error: fetchErr } = await existingQuery;
  if (fetchErr) throw fetchErr;

  const buckets = new Map<string, number[]>();
  (existingRows as { id: number; item_type: string; material_name: string }[] | null ?? []).forEach((row) => {
    const key = `${row.item_type}|${row.material_name}`;
    const list = buckets.get(key) ?? [];
    list.push(row.id);
    buckets.set(key, list);
  });

  const now = nowStr();
  const validDrafts = drafts.filter((d) => d.materialName.trim() !== '');

  for (let i = 0; i < validDrafts.length; i++) {
    const d = validDrafts[i];
    const key = `${d.itemType}|${d.materialName.trim()}`;
    const bucket = buckets.get(key);
    const reuseId = bucket && bucket.length > 0 ? bucket.shift() : undefined;
    const pageStart = d.itemType === 'page_range' && d.pageStart != null ? d.pageStart : null;
    const pageEnd = d.itemType === 'page_range' && d.pageEnd != null ? d.pageEnd : null;
    if (reuseId !== undefined) {
      const { error } = await supabase
        .from('hw_items')
        .update({
          page_start: pageStart,
          page_end: pageEnd,
          description: d.description ?? '',
          sort_order: i,
        })
        .eq('id', reuseId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('hw_items').insert({
        assignment_id: assignmentId,
        item_type: d.itemType,
        material_name: d.materialName.trim(),
        page_start: pageStart,
        page_end: pageEnd,
        description: d.description ?? '',
        student_id: studentId,
        sort_order: i,
        created_at: now,
      });
      if (error) throw error;
    }
  }

  const leftoverIds = Array.from(buckets.values()).flat();
  if (leftoverIds.length > 0) {
    const { error } = await supabase.from('hw_items').delete().in('id', leftoverIds);
    if (error) throw error;
  }
}

function buildItemSummaryText(
  rows: { item_type: string; material_name: string; page_start: number | null; page_end: number | null; description: string | null }[],
): string {
  const parts: string[] = [];
  for (const it of rows) {
    const name = (it.material_name || '').trim();
    if (!name) continue;
    if (it.item_type === 'page_range' && it.page_start && it.page_end) {
      parts.push(`${name} (${it.page_start}~${it.page_end}쪽)`);
    } else {
      const desc = (it.description || '').trim();
      parts.push(desc ? `${name} 오답정리 (${desc})` : `${name} 오답정리`);
    }
  }
  return parts.join(', ');
}

/** 출석부 "오늘 과제(참고)" 카드 동기화 — 실패해도 과제 저장 자체는 막지 않음. */
async function syncAttendanceHomeworkCard(classId: number, assignedDate: string, assignmentId: number): Promise<void> {
  try {
    const { data: itemRows } = await supabase
      .from('hw_items')
      .select('item_type, material_name, page_start, page_end, description, sort_order')
      .eq('assignment_id', assignmentId)
      .is('student_id', null);
    const sorted = [...((itemRows as { sort_order: number }[] | null) ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order);
    const summary = buildItemSummaryText(sorted as any);
    const now = nowStr();
    await supabase
      .from('class_homework')
      .upsert(
        { class_id: classId, session_date: assignedDate, content: summary, created_at: now, updated_at: now },
        { onConflict: 'class_id,session_date' },
      );
  } catch {
    // 참고용 동기화 실패는 무시(과제 저장 자체는 이미 완료된 상태).
  }
}

/**
 * 이 반+부여일에 hw_assignments 행이 이미 있으면 그 id를, 없으면 새로 만들어서
 * 반환한다(제목은 기본값, due_date는 빈 값으로 시작). 공통 과제 저장(위)과
 * 개별 과제만 먼저 부여하는 경우(아래 ensureAssignment) 양쪽에서 재사용 —
 * 2026-08-26 사용자 요청으로 "공통 과제 없이 개별 과제부터 부여"가 가능해야
 * 해서, 과제 행 자체를 만드는 로직을 공용 함수로 뺐다.
 */
async function findOrCreateAssignmentId(
  classId: string,
  assignedDate: string,
): Promise<{ id: number; created: boolean }> {
  const classIdNum = Number(classId);
  const { data: existing, error: findErr } = await supabase
    .from('hw_assignments')
    .select('id')
    .eq('class_id', classIdNum)
    .eq('assigned_date', assignedDate)
    .maybeSingle();
  if (findErr) throw findErr;
  if (existing) return { id: existing.id, created: false };

  const now = nowStr();
  const { data: created, error } = await supabase
    .from('hw_assignments')
    .insert({
      class_id: classIdNum,
      title: `${assignedDate} 과제`,
      assigned_date: assignedDate,
      due_date: '',
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();
  if (error) throw error;
  return { id: created.id, created: true };
}

/**
 * 개별 과제만 먼저 부여할 때 쓰는 진입점 — 공통 과제를 저장한 적이 없어도
 * hw_assignments 행을 만들어서(대상 학생은 아직 아무도 없는 채로) id를
 * 반환한다. 이후 saveIndividualItems()가 이 id로 그 학생만 target으로
 * 추가하므로, "공통 없이 이 학생만 개별로" 부여한 상태가 정확히 만들어진다.
 */
export async function ensureAssignment(classId: string, assignedDate: string): Promise<string> {
  const { id } = await findOrCreateAssignmentId(classId, assignedDate);
  return String(id);
}

/** 공통(반 전체) 과제 저장 — hw_assign.py save_assignment() 대응. 같은 반+부여일이면 수정. */
export async function saveCommonAssignment(params: {
  classId: string;
  assignedDate: string;
  dueDate: string;
  studentIds: string[];
  noCertStudentIds: string[];
  commonItems: ItemDraftInput[];
}): Promise<void> {
  const classIdNum = Number(params.classId);
  const now = nowStr();

  const { id: foundOrCreatedId, created } = await findOrCreateAssignmentId(params.classId, params.assignedDate);
  const assignmentId = foundOrCreatedId;

  if (!created) {
    const { error } = await supabase
      .from('hw_assignments')
      .update({ due_date: params.dueDate || '', updated_at: now })
      .eq('id', assignmentId);
    if (error) throw error;

    const { data: currentTargets, error: tErr } = await supabase
      .from('hw_assignment_targets')
      .select('student_id')
      .eq('assignment_id', assignmentId);
    if (tErr) throw tErr;
    const currentIds = ((currentTargets as { student_id: number }[] | null) ?? []).map((r) => String(r.student_id));
    const removedIds = currentIds.filter((id) => !params.studentIds.includes(id)).map(Number);
    if (removedIds.length > 0) {
      await supabase.from('hw_assignment_targets').delete().eq('assignment_id', assignmentId).in('student_id', removedIds);
      await supabase.from('hw_submissions').delete().eq('assignment_id', assignmentId).in('student_id', removedIds);
      await supabase.from('hw_items').delete().eq('assignment_id', assignmentId).in('student_id', removedIds);
    }
  } else if (params.dueDate) {
    // findOrCreateAssignmentId는 due_date를 항상 빈 값으로 만들기 때문에,
    // 이번 공통 과제 저장에서 마감일을 입력했다면 그 값으로 갱신해준다.
    const { error } = await supabase.from('hw_assignments').update({ due_date: params.dueDate }).eq('id', assignmentId);
    if (error) throw error;
  }

  for (const sid of params.studentIds) {
    const requiresCert = !params.noCertStudentIds.includes(sid);
    const { error } = await supabase
      .from('hw_assignment_targets')
      .upsert(
        { assignment_id: assignmentId, student_id: Number(sid), requires_certification: requiresCert },
        { onConflict: 'assignment_id,student_id' },
      );
    if (error) throw error;

    if (requiresCert) {
      const { error: subErr } = await supabase.from('hw_submissions').upsert(
        {
          assignment_id: assignmentId,
          student_id: Number(sid),
          upload_token: newUploadToken(),
          status: 'pending',
          created_at: now,
        },
        { onConflict: 'assignment_id,student_id', ignoreDuplicates: true },
      );
      if (subErr) throw subErr;
    }
  }

  await syncItems(assignmentId, null, params.commonItems);
  await syncAttendanceHomeworkCard(classIdNum, params.assignedDate, assignmentId);
}

/** 개별 과제 저장 — hw_assign.py save_individual_items() 대응. */
export async function saveIndividualItems(
  assignmentId: string,
  studentId: string,
  rows: ItemDraftInput[],
  includeCommon: boolean,
): Promise<void> {
  const assignmentIdNum = Number(assignmentId);
  const studentIdNum = Number(studentId);
  const now = nowStr();

  const { data: existingTarget, error: findErr } = await supabase
    .from('hw_assignment_targets')
    .select('id')
    .eq('assignment_id', assignmentIdNum)
    .eq('student_id', studentIdNum)
    .maybeSingle();
  if (findErr) throw findErr;

  if (existingTarget) {
    const { error } = await supabase
      .from('hw_assignment_targets')
      .update({ include_common: includeCommon })
      .eq('id', existingTarget.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('hw_assignment_targets').insert({
      assignment_id: assignmentIdNum,
      student_id: studentIdNum,
      requires_certification: true,
      include_common: includeCommon,
    });
    if (error) throw error;
  }

  const { error: subErr } = await supabase.from('hw_submissions').upsert(
    {
      assignment_id: assignmentIdNum,
      student_id: studentIdNum,
      upload_token: newUploadToken(),
      status: 'pending',
      created_at: now,
    },
    { onConflict: 'assignment_id,student_id', ignoreDuplicates: true },
  );
  if (subErr) throw subErr;

  await syncItems(assignmentIdNum, studentIdNum, rows);
}

/** 항목 1개만 삭제 — hw_assign.py delete_hw_item() 대응(연쇄로 제출기록·사진도 삭제). */
export async function deleteHwItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('hw_items').delete().eq('id', Number(itemId));
  if (error) throw error;
}

/** 과제 1건 통째로 삭제 — hw_assign.py delete_assignment() 대응(대상학생·제출·항목 연쇄삭제). */
export async function deleteAssignment(assignmentId: string): Promise<void> {
  const { error } = await supabase.from('hw_assignments').delete().eq('id', Number(assignmentId));
  if (error) throw error;
}

/**
 * 제출 1건의 사진들을 항목(문제집/프린트)별로 묶어서 상세 조회 — 스트림릿
 * hw_photo_review.render_photo_review()의 데이터 부분 대응. "제출 사진 보기"를
 * 펼칠 때만 지연 조회한다(목록 전체를 미리 다 가져오지 않음, 다른 화면들과
 * 동일한 패턴).
 */
export async function fetchSubmissionPhotoDetails(submissionId: string): Promise<HwItemPhotoGroup[]> {
  const { data, error } = await supabase
    .from('hw_item_submissions')
    .select(
      `
        item_id,
        hw_items ( material_name, item_type, page_start, page_end ),
        hw_photos ( id, photo_url, uploaded_at, ai_page_guess, ai_flag, teacher_verified, teacher_verified_at )
      `,
    )
    .eq('submission_id', Number(submissionId));
  if (error) throw error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data as any[]) ?? [];
  return rows.map((row) => {
    const item = row.hw_items;
    const photos = ((row.hw_photos as unknown[] | null) ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((p: any) => ({
        id: String(p.id),
        photoUrl: p.photo_url,
        uploadedAt: p.uploaded_at ?? '',
        aiPageGuess: p.ai_page_guess ?? null,
        aiFlag: p.ai_flag ?? null,
        teacherVerified: Boolean(p.teacher_verified),
        teacherVerifiedAt: p.teacher_verified_at ?? null,
      }))
      .sort((a, b) => (a.uploadedAt < b.uploadedAt ? -1 : 1));
    return {
      itemId: String(row.item_id),
      materialName: item?.material_name ?? '',
      itemType: (item?.item_type as HwItemType) ?? 'page_range',
      pageStart: item?.page_start ?? undefined,
      pageEnd: item?.page_end ?? undefined,
      photos,
    };
  });
}

/**
 * 사진 한 장의 선생님 확인 여부를 개별로 바꾼다 — hw_photo_review.py
 * mark_teacher_verified()와 동일(제출 1건 전체가 아니라 사진 1장 단위).
 * 외부 API 호출 없는 단순 DB 값 갱신이라 실제로 반영함.
 */
export async function setPhotoTeacherVerified(photoId: string, verified: boolean): Promise<void> {
  const { error } = await supabase
    .from('hw_photos')
    .update({ teacher_verified: verified, teacher_verified_at: verified ? nowStr() : null })
    .eq('id', Number(photoId));
  if (error) throw error;
}

/**
 * 선생님 사진 확인 토글 — hw_photo_review.py mark_teacher_verified() 대응.
 * 외부 API 호출 없는 단순 DB 값 갱신이라 실제로 반영함(다른 SMS 관련 버튼과
 * 달리 데모가 아님). 화면(RecentAssignmentsPanel)이 제출 1건당 확인 버튼
 * 하나만 두고 있어서, 그 제출에 딸린 사진 전부를 한 번에 같은 값으로 토글함.
 */
export async function toggleTeacherVerified(submissionId: string): Promise<void> {
  const { data: itemSubs, error: e1 } = await supabase
    .from('hw_item_submissions')
    .select('id')
    .eq('submission_id', Number(submissionId));
  if (e1) throw e1;
  const itemSubIds = ((itemSubs as { id: number }[] | null) ?? []).map((r) => r.id);
  if (itemSubIds.length === 0) return;

  const { data: photos, error: e2 } = await supabase
    .from('hw_photos')
    .select('id, teacher_verified')
    .in('item_submission_id', itemSubIds);
  if (e2) throw e2;
  const rows = (photos as { id: number; teacher_verified: boolean }[] | null) ?? [];
  if (rows.length === 0) return;

  const allVerified = rows.every((p) => p.teacher_verified);
  const nextVerified = !allVerified;
  const now = nowStr();
  const { error: e3 } = await supabase
    .from('hw_photos')
    .update({ teacher_verified: nextVerified, teacher_verified_at: nextVerified ? now : null })
    .in(
      'id',
      rows.map((p) => p.id),
    );
  if (e3) throw e3;
}

/**
 * 출석 관리 화면의 "오늘 과제 (참고)" 카드용 — homework.py
 * get_hw_assignment_summary() 대응. 이 반+날짜에 과제 인증에서 등록한 과제가
 * 있으면 제목과 공통 항목 요약을 반환, 없으면 null.
 */
export async function fetchTodayHomeworkSummary(
  classId: string,
  sessionDate: string,
): Promise<{ title: string; summary: string } | null> {
  const { data: assignment, error: aErr } = await supabase
    .from('hw_assignments')
    .select('id, title')
    .eq('class_id', Number(classId))
    .eq('assigned_date', sessionDate)
    .maybeSingle();
  if (aErr) throw aErr;
  if (!assignment) return null;

  const { data: itemRows, error: iErr } = await supabase
    .from('hw_items')
    .select('item_type, material_name, page_start, page_end, description, sort_order')
    .eq('assignment_id', assignment.id)
    .is('student_id', null);
  if (iErr) throw iErr;

  const sorted = [...((itemRows as { sort_order: number }[] | null) ?? [])].sort((a: any, b: any) => a.sort_order - b.sort_order);
  return { title: assignment.title, summary: buildItemSummaryText(sorted as any) };
}
