import { useCallback, useEffect, useState } from 'react';
import { fetchClasses } from '../lib/classManagement';
import {
  fetchHomeworkForClass,
  saveCommonAssignment,
  saveIndividualItems,
  ensureAssignment,
  deleteHwItem as deleteHwItemDb,
  deleteAssignment as deleteAssignmentDb,
  buildHwSmsText,
  buildHwUploadLinkText,
  markNotified,
} from '../lib/homework';
import { sendBulkSms } from '../lib/smsSend';
import { HW_UPLOAD_BASE_URL } from '../data/mockHomework';
import type { ClassInfo } from '../types/classManagement';
import type { HwAssignment, HwItem, HwSubmission } from '../types/homework';
import { AssignmentForm, type CommonSavePayload } from '../components/homework/AssignmentForm';
import { ReferenceUploadSection } from '../components/homework/ReferenceUploadSection';
import { IndividualAssignmentSection } from '../components/homework/IndividualAssignmentSection';
import { IncompleteStudentsPanel } from '../components/homework/IncompleteStudentsPanel';
import { RecentAssignmentsPanel } from '../components/homework/RecentAssignmentsPanel';
import type { ItemRowDraft } from '../components/homework/HwItemRows';
import styles from './HomeworkCertification.module.css';

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function draftToItemInput(d: ItemRowDraft) {
  return {
    itemType: d.itemType,
    materialName: d.materialName.trim(),
    pageStart: d.itemType === 'page_range' && d.pageStart !== '' ? Number(d.pageStart) : undefined,
    pageEnd: d.itemType === 'page_range' && d.pageEnd !== '' ? Number(d.pageEnd) : undefined,
    description: d.description.trim() || undefined,
  };
}

/**
 * 스트림릿 hw_assign.py의 render_hw_assign_page() 재현 — 과제 인증(선생님용
 * 과제 부여 화면). 2026-08-26부터 dev DB(Supabase) 실제 연동(lib/homework.ts).
 *
 * 여전히 mock으로 남겨둔 부분(이전 세션에 이미 결정된 범위 — 이번에 안 건드림):
 * - 학생용 업로드 페이지("/upload" 경로의 AssignmentUpload.tsx, hw_upload.py 대응)
 * - 참조 PDF 업로드 + AI 페이지 대조(ReferenceUploadSection, hw_reference.py 대응)
 *   — 둘 다 실제 AI/OCR 연동이 핵심이라 mock으로 만드는 의미가 적어서 보류.
 *
 * [2026-09-03] "완료·미완료 일괄 발송"은 실제 문자 발송으로 전환함 — 아래
 * handleBulkSms 참고(lib/homework.ts의 buildHwSmsText/markNotified,
 * lib/smsSend.ts의 sendBulkSms — 이미 배포된 send-sms Edge Function 재사용).
 * [2026-09-04] "업로드 링크 개별 발송"도 실제 발송으로 전환함 — academy-web이
 * Vercel에 공개 배포되어(https://academy-manager-v2.vercel.app) 더 이상 깨진
 * 링크가 아님. 아래 handleSendUploadLink 참고.
 *
 * 선생님 사진 확인(✅ 선생님 확인 버튼)은 외부 API 호출이 없는 단순 DB
 * 갱신이라 실제로 반영됨 — lib/homework.ts의 setPhotoTeacherVerified() 참고
 * (2026-09-01부터 제출 1건 전체가 아니라 사진 1장 단위로 확인함).
 * AI 1차 사진 판독(hw_photo_review.py 대응)도 2026-09-01부터 실제 GPT-4o
 * Vision 연동 완료 — RecentAssignmentsPanel의 "제출 사진 보기"에서 확인.
 *
 * 2026-08-26 수정: 공통 과제를 먼저 저장하지 않아도 개별 과제만 바로 부여할
 * 수 있어야 한다는 요청에 따라, handleSaveIndividual이 currentAssignment가
 * 없을 때 조용히 멈추던 것을 없애고 ensureAssignment()로 과제 행을 필요할
 * 때만 새로 만들도록 바꿈(대상 학생은 아직 아무도 없는 상태로 시작 —
 * saveIndividualItems가 그 학생만 target으로 추가함).
 */
export function HomeworkCertification() {
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [classesError, setClassesError] = useState('');

  const [classId, setClassId] = useState('');
  const [assignedDate, setAssignedDate] = useState(todayStr());
  const [assignments, setAssignments] = useState<HwAssignment[]>([]);
  const [items, setItems] = useState<HwItem[]>([]);
  const [submissions, setSubmissions] = useState<HwSubmission[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchClasses()
      .then((data) => {
        if (cancelled) return;
        setClasses(data);
        setClassId((prev) => prev || data[0]?.id || '');
      })
      .catch((err) => {
        if (cancelled) return;
        setClassesError(err instanceof Error ? err.message : '수업 목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setClassesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(() => {
    if (!classId) return;
    setDataLoading(true);
    setDataError('');
    fetchHomeworkForClass(classId)
      .then((data) => {
        setAssignments(data.assignments);
        setItems(data.items);
        setSubmissions(data.submissions);
      })
      .catch((err) => {
        setDataError(err instanceof Error ? err.message : '과제 데이터를 불러오지 못했습니다.');
      })
      .finally(() => setDataLoading(false));
  }, [classId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const classInfo = classes.find((c) => c.id === classId);

  const currentAssignment = assignments.find((a) => a.assignedDate === assignedDate);
  const currentCommonItems = currentAssignment
    ? items.filter((it) => it.assignmentId === currentAssignment.id && !it.studentId)
    : [];
  const currentItemsByStudent: Record<string, HwItem[]> = {};
  if (currentAssignment) {
    items
      .filter((it) => it.assignmentId === currentAssignment.id && it.studentId)
      .forEach((it) => {
        const sid = it.studentId!;
        if (!currentItemsByStudent[sid]) currentItemsByStudent[sid] = [];
        currentItemsByStudent[sid].push(it);
      });
  }

  async function handleSaveCommon(payload: CommonSavePayload) {
    if (!classInfo) return;
    await saveCommonAssignment({
      classId,
      assignedDate,
      dueDate: payload.dueDate,
      studentIds: payload.studentIds,
      noCertStudentIds: payload.noCertStudentIds,
      commonItems: payload.commonItems.map(draftToItemInput),
    });
    reload();
  }

  async function handleSaveIndividual(studentId: string, rows: ItemRowDraft[], includeCommon: boolean) {
    const assignmentId = currentAssignment ? currentAssignment.id : await ensureAssignment(classId, assignedDate);
    await saveIndividualItems(assignmentId, studentId, rows.map(draftToItemInput), includeCommon);
    reload();
  }

  async function handleDeleteItem(itemId: string) {
    await deleteHwItemDb(itemId);
    reload();
  }

  async function handleDeleteAssignment(assignmentId: string) {
    await deleteAssignmentDb(assignmentId);
    reload();
  }

  /**
   * [2026-09-04] "업로드 링크 개별 발송" 실제 발송 — 운영 스트림릿 hw_assign.py와
   * 동일한 규칙: 학생 본인 연락처(studentPhone)가 있으면 그쪽으로, 없으면 보호자
   * 번호로 대체 발송(둘 다 없으면 에러를 던져서 RecentAssignmentsPanel이 실패
   * 메시지로 보여줌).
   */
  async function handleSendUploadLink(submissionId: string): Promise<{ via: 'student' | 'parent' }> {
    const sub = submissions.find((s) => s.id === submissionId);
    if (!sub) throw new Error('제출 정보를 찾을 수 없습니다.');
    const assignment = assignments.find((a) => a.id === sub.assignmentId);
    const student = classInfo?.students.find((st) => st.id === sub.studentId);
    if (!student) throw new Error('학생 정보를 찾을 수 없습니다.');

    const studentPhone = student.studentPhone?.trim();
    const parentPhone = student.parentPhone?.trim();
    const targetPhone = studentPhone || parentPhone;
    if (!targetPhone) {
      throw new Error('학생·보호자 연락처가 모두 없어 링크 문자를 보낼 수 없습니다.');
    }

    const link = `${HW_UPLOAD_BASE_URL}?hw=${sub.uploadToken}`;
    const text = buildHwUploadLinkText({
      studentName: student.name,
      assignedDate: assignment?.assignedDate ?? todayStr(),
      title: assignment?.title ?? '과제',
      link,
    });

    await sendBulkSms([{ name: student.name, phone: targetPhone }], text);
    return { via: studentPhone ? 'student' : 'parent' };
  }

  /**
   * [2026-09-04] "완료/미완료 문자 발송" — 학생 1명 단위로 전환(사용자 요청).
   * 기존엔 과제 단위로 한 번에 전원에게 나가서, 특정 학생 1명만 테스트하려던
   * 의도와 다르게 같은 과제의 다른 학생에게도 문자가 나가는 문제가 있었음.
   * 건너뛰는 조건은 기존과 동일(운영 스트림릿 send_hw_nightly_sms.py 기준):
   * (1) 선생님이 아직 확인 안 한 제출 사진이 있으면 건너뜀 (2) 오늘 이미
   * 발송됐으면(수동이든 야간자동이든) 중복 발송 방지로 건너뜀. 성공하면
   * markNotified()로 기록.
   */
  async function handleSendCompletionSms(
    submissionId: string,
  ): Promise<{ status: 'sent' | 'skipped'; reason?: string }> {
    const sub = submissions.find((s) => s.id === submissionId);
    if (!sub) throw new Error('제출 정보를 찾을 수 없습니다.');
    const assignment = assignments.find((a) => a.id === sub.assignmentId);
    const student = classInfo?.students.find((st) => st.id === sub.studentId);
    if (!student) throw new Error('학생 정보를 찾을 수 없습니다.');

    if (sub.hasPhoto && !sub.teacherVerified) {
      return { status: 'skipped', reason: '선생님 확인 대기 중이라 건너뛰었습니다. 사진 확인 후 다시 시도해주세요.' };
    }
    if (sub.notifiedToday) {
      return { status: 'skipped', reason: '오늘 이미 문자를 발송했습니다.' };
    }
    const phone = student.parentPhone?.trim();
    if (!phone) {
      throw new Error('보호자 연락처가 없어 문자를 보낼 수 없습니다.');
    }

    const { text } = buildHwSmsText({
      studentName: student.name,
      assignedDate: assignment?.assignedDate ?? todayStr(),
      title: assignment?.title ?? '과제',
      itemStates: sub.itemStates,
      items,
    });

    await sendBulkSms([{ name: student.name, phone }], text);
    await markNotified(sub.id);
    reload();
    return { status: 'sent' };
  }

  if (classesLoading) {
    return <p className={styles.emptyText}>수업 목록을 불러오는 중입니다...</p>;
  }
  if (classesError) {
    return <p className={styles.emptyText}>불러오지 못했습니다: {classesError}</p>;
  }
  if (!classInfo) {
    return <p className={styles.emptyText}>등록된 수업이 없습니다.</p>;
  }

  return (
    <>
      <div className={styles.headerRow}>
        <h1 className={styles.pageTitle}>과제 인증</h1>
        <div className={styles.pageSub}>
          학생별 과제를 부여하고, 인증샷 제출 현황을 확인 · 문자 발송합니다.
        </div>
      </div>

      <div className={styles.classSelectCard}>
        <label className={styles.classSelectLabel}>반 선택</label>
        <select className={styles.classSelectInput} value={classId} onChange={(e) => setClassId(e.target.value)}>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {dataError && <p className={styles.emptyText}>불러오지 못했습니다: {dataError}</p>}
      {dataLoading && <p className={styles.emptyText}>과제 데이터를 불러오는 중입니다...</p>}

      <ReferenceUploadSection classId={classId} />

      <AssignmentForm
        classInfo={classInfo}
        assignedDate={assignedDate}
        onDateChange={setAssignedDate}
        existingAssignment={currentAssignment}
        commonItems={currentCommonItems}
        onSave={handleSaveCommon}
      />

      <IndividualAssignmentSection
        classInfo={classInfo}
        assignedDate={assignedDate}
        assignment={currentAssignment}
        itemsByStudent={currentItemsByStudent}
        onSave={handleSaveIndividual}
      />

      <IncompleteStudentsPanel
        classInfo={classInfo}
        assignments={assignments}
        items={items}
        submissions={submissions}
      />

      <RecentAssignmentsPanel
        classInfo={classInfo}
        assignments={assignments}
        items={items}
        submissions={submissions}
        onDeleteItem={handleDeleteItem}
        onDeleteAssignment={handleDeleteAssignment}
        onSendUploadLink={handleSendUploadLink}
        onPhotosChanged={reload}
        onSendCompletionSms={handleSendCompletionSms}
      />
    </>
  );
}
