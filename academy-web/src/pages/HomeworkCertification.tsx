import { useRef, useState } from 'react';
import { classes } from '../data/mockClasses';
import { initialAssignments, initialHwItems, initialSubmissions } from '../data/mockHomework';
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

/**
 * 스트림릿 hw_assign.py의 render_hw_assign_page() 재현 — 과제 인증(선생님용
 * 과제 부여 화면). 학생용 업로드 페이지(hw_upload.py)는 이미 AssignmentUpload.tsx
 * (경로 "/")로 완성되어 있어 이번엔 다루지 않음.
 *
 * 보류한 부분(추후 실제 백엔드 연동 단계에서 진행):
 * - 참조 PDF 업로드 + AI 페이지 자동 대조 (hw_reference.py) — 학원시험 AI분석과
 *   같은 이유로 실제 AI 연동이 핵심이라 mock으로 만드는 의미가 적음.
 * - 사진 AI 1차 판독(hw_photo_review.py의 run_ai_page_check) — "선생님 최종
 *   확인" 수동 게이트 개념만 그대로 재현하고, AI 판독 자체는 데모 문구로 대체.
 */
export function HomeworkCertification() {
  const [classId, setClassId] = useState(classes[0]?.id ?? '');
  const [assignedDate, setAssignedDate] = useState(todayStr());
  const [assignments, setAssignments] = useState<HwAssignment[]>(initialAssignments);
  const [items, setItems] = useState<HwItem[]>(initialHwItems);
  const [submissions, setSubmissions] = useState<HwSubmission[]>(initialSubmissions);
  const idSeed = useRef(1);

  const classInfo = classes.find((c) => c.id === classId);
  const assignmentsForClass = assignments.filter((a) => a.classId === classId);
  const itemsForClass = items.filter((it) => assignmentsForClass.some((a) => a.id === it.assignmentId));
  const submissionsForClass = submissions.filter((s) => assignmentsForClass.some((a) => a.id === s.assignmentId));

  const currentAssignment = assignmentsForClass.find((a) => a.assignedDate === assignedDate);
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

  function buildItemFromDraft(d: ItemRowDraft, assignmentId: string, idx: number, studentId?: string): HwItem {
    return {
      id: `${assignmentId}_${studentId ?? 'common'}_${idx}_${idSeed.current++}`,
      assignmentId,
      itemType: d.itemType,
      materialName: d.materialName.trim(),
      pageStart: d.itemType === 'page_range' && d.pageStart !== '' ? Number(d.pageStart) : undefined,
      pageEnd: d.itemType === 'page_range' && d.pageEnd !== '' ? Number(d.pageEnd) : undefined,
      description: d.description.trim() || undefined,
      studentId,
    };
  }

  function handleSaveCommon(payload: CommonSavePayload) {
    if (!classInfo) return;
    const existing = assignmentsForClass.find((a) => a.assignedDate === assignedDate);
    const assignmentId = existing?.id ?? `hw${idSeed.current++}`;

    const newAssignment: HwAssignment = {
      id: assignmentId,
      classId,
      title: existing?.title ?? `${assignedDate} 과제`,
      assignedDate,
      dueDate: payload.dueDate || undefined,
      studentIds: payload.studentIds,
      noCertStudentIds: payload.noCertStudentIds,
      includeCommonByStudent: existing?.includeCommonByStudent ?? {},
    };

    setAssignments((prev) => (existing ? prev.map((a) => (a.id === assignmentId ? newAssignment : a)) : [...prev, newAssignment]));

    const validDrafts = payload.commonItems.filter((d) => d.materialName.trim() !== '');
    const newCommonItems = validDrafts.map((d, i) => buildItemFromDraft(d, assignmentId, i));

    setItems((prev) => [...prev.filter((it) => !(it.assignmentId === assignmentId && !it.studentId)), ...newCommonItems]);

    setSubmissions((prev) => {
      const existingStudentIds = new Set(prev.filter((s) => s.assignmentId === assignmentId).map((s) => s.studentId));
      const additions: HwSubmission[] = payload.studentIds
        .filter((sid) => !existingStudentIds.has(sid))
        .map((sid) => ({
          id: `${assignmentId}_${sid}_${idSeed.current++}`,
          assignmentId,
          studentId: sid,
          status: 'not_viewed',
          teacherVerified: false,
          hasPhoto: false,
          notifiedToday: false,
          itemStates: [],
        }));
      return [...prev, ...additions];
    });
  }

  function handleSaveIndividual(studentId: string, rows: ItemRowDraft[], includeCommon: boolean) {
    if (!currentAssignment) return;
    const assignmentId = currentAssignment.id;
    const validDrafts = rows.filter((d) => d.materialName.trim() !== '');
    const newItems = validDrafts.map((d, i) => buildItemFromDraft(d, assignmentId, i, studentId));

    setItems((prev) => [
      ...prev.filter((it) => !(it.assignmentId === assignmentId && it.studentId === studentId)),
      ...newItems,
    ]);

    setAssignments((prev) =>
      prev.map((a) =>
        a.id === assignmentId ? { ...a, includeCommonByStudent: { ...a.includeCommonByStudent, [studentId]: includeCommon } } : a,
      ),
    );
  }

  function handleDeleteItem(itemId: string) {
    setItems((prev) => prev.filter((it) => it.id !== itemId));
  }

  function handleDeleteAssignment(assignmentId: string) {
    setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
    setItems((prev) => prev.filter((it) => it.assignmentId !== assignmentId));
    setSubmissions((prev) => prev.filter((s) => s.assignmentId !== assignmentId));
  }

  function handleSendUploadLink(studentId: string) {
    setSubmissions((prev) => prev.map((s) => (s.studentId === studentId ? { ...s, notifiedToday: true } : s)));
  }

  function handleToggleTeacherVerified(submissionId: string) {
    setSubmissions((prev) => prev.map((s) => (s.id === submissionId ? { ...s, teacherVerified: !s.teacherVerified } : s)));
  }

  function handleBulkSms(assignmentId: string) {
    const relevant = submissions.filter((s) => s.assignmentId === assignmentId);
    const sentIds: string[] = [];
    const skippedNames: string[] = [];
    const sentNames: string[] = [];

    relevant.forEach((s) => {
      const name = classInfo?.students.find((st) => st.id === s.studentId)?.name ?? s.studentId;
      if (s.hasPhoto && !s.teacherVerified) {
        skippedNames.push(name);
      } else {
        sentIds.push(s.id);
        sentNames.push(name);
      }
    });

    setSubmissions((prev) => prev.map((s) => (sentIds.includes(s.id) ? { ...s, notifiedToday: true } : s)));
    return { sentNames, skippedNames };
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
        assignment={currentAssignment}
        itemsByStudent={currentItemsByStudent}
        onSave={handleSaveIndividual}
      />

      <IncompleteStudentsPanel
        classInfo={classInfo}
        assignments={assignmentsForClass}
        items={itemsForClass}
        submissions={submissionsForClass}
      />

      <RecentAssignmentsPanel
        classInfo={classInfo}
        assignments={assignmentsForClass}
        items={itemsForClass}
        submissions={submissionsForClass}
        onDeleteItem={handleDeleteItem}
        onDeleteAssignment={handleDeleteAssignment}
        onSendUploadLink={handleSendUploadLink}
        onToggleTeacherVerified={handleToggleTeacherVerified}
        onBulkSms={handleBulkSms}
      />
    </>
  );
}
