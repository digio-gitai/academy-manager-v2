import { useState } from 'react';
import type { ClassInfo } from '../../types/classManagement';
import type { HwAssignment, HwItem, HwSubmission, HwSubmissionStatus } from '../../types/homework';
import { HW_ITEM_TYPE_LABELS } from '../../types/homework';
import { HW_UPLOAD_BASE_URL } from '../../data/mockHomework';
import styles from './RecentAssignmentsPanel.module.css';

const STATUS_LABELS: Record<HwSubmissionStatus, string> = {
  not_viewed: '안 봄',
  viewed: '열람함',
  done: '완료',
};

interface RecentAssignmentsPanelProps {
  classInfo: ClassInfo;
  assignments: HwAssignment[];
  items: HwItem[];
  submissions: HwSubmission[];
  onDeleteItem: (itemId: string) => void;
  onDeleteAssignment: (assignmentId: string) => void;
  onSendUploadLink: (studentId: string) => void;
  onToggleTeacherVerified: (submissionId: string) => void;
  onBulkSms: (assignmentId: string) => { sentNames: string[]; skippedNames: string[] };
}

/**
 * 스트림릿 render_hw_assign_page()의 "최근 부여한 과제" 재현: 과제별 항목
 * 표(삭제 가능) + 학생별 제출 현황(업로드 링크 문자 발송, 사진 확인, 완료/미완료
 * 일괄 문자 발송) + 과제 삭제. AI 1차 사진 판독(hw_photo_review.py)은 실제
 * GPT-4o Vision 연동이 핵심이라 보류하고, "선생님 최종 확인" 수동 게이트
 * 개념만 그대로 재현함.
 */
export function RecentAssignmentsPanel({
  classInfo,
  assignments,
  items,
  submissions,
  onDeleteItem,
  onDeleteAssignment,
  onSendUploadLink,
  onToggleTeacherVerified,
  onBulkSms,
}: RecentAssignmentsPanelProps) {
  const [openAssignmentId, setOpenAssignmentId] = useState<string | null>(null);
  const [photoOpenFor, setPhotoOpenFor] = useState<string | null>(null);
  const [linkMessage, setLinkMessage] = useState<Record<string, string>>({});
  const [bulkMessage, setBulkMessage] = useState<Record<string, string>>({});

  const sorted = [...assignments].sort((a, b) => (a.assignedDate < b.assignedDate ? 1 : -1));

  if (sorted.length === 0) {
    return (
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>최근 부여한 과제</h3>
        <p className={styles.emptyText}>아직 이 반에 부여한 과제가 없습니다.</p>
      </div>
    );
  }

  function handleSendLink(studentId: string, studentName: string) {
    onSendUploadLink(studentId);
    setLinkMessage((prev) => ({ ...prev, [studentId]: `${studentName} 학생에게 업로드 링크 문자를 발송했습니다. (데모)` }));
  }

  function handleBulk(assignmentId: string) {
    const result = onBulkSms(assignmentId);
    const parts: string[] = [];
    if (result.sentNames.length > 0) parts.push(`발송: ${result.sentNames.join(', ')}`);
    if (result.skippedNames.length > 0) parts.push(`선생님 확인 대기 중이라 건너뜀: ${result.skippedNames.join(', ')}`);
    setBulkMessage((prev) => ({ ...prev, [assignmentId]: parts.join(' / ') || '발송 대상이 없습니다.' }));
  }

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>최근 부여한 과제</h3>

      {sorted.map((assignment) => {
        const isOpen = openAssignmentId === assignment.id;
        const assignmentItems = items.filter((it) => it.assignmentId === assignment.id);
        const assignmentSubs = submissions.filter((s) => s.assignmentId === assignment.id);

        return (
          <div key={assignment.id} className={styles.assignmentBlock}>
            <button
              type="button"
              className={styles.assignmentToggle}
              onClick={() => setOpenAssignmentId(isOpen ? null : assignment.id)}
            >
              {isOpen ? '▾' : '▸'} {assignment.assignedDate} 부여 과제 ({assignment.studentIds.length}명 대상)
            </button>

            {isOpen && (
              <div className={styles.assignmentBody}>
                {assignmentItems.length === 0 ? (
                  <p className={styles.emptyText}>등록된 항목이 없습니다.</p>
                ) : (
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>유형</th>
                        <th>문제집 · 프린트</th>
                        <th>시작p</th>
                        <th>끝p</th>
                        <th>설명</th>
                        <th>대상</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignmentItems.map((item) => {
                        const targetLabel = item.studentId
                          ? classInfo.students.find((s) => s.id === item.studentId)?.name ?? '개별'
                          : '공통';
                        return (
                          <tr key={item.id}>
                            <td>{HW_ITEM_TYPE_LABELS[item.itemType]}</td>
                            <td>{item.materialName}</td>
                            <td>{item.pageStart ?? '—'}</td>
                            <td>{item.pageEnd ?? '—'}</td>
                            <td>{item.description || '—'}</td>
                            <td>{targetLabel}</td>
                            <td>
                              <button type="button" className={styles.rowDeleteButton} onClick={() => onDeleteItem(item.id)}>
                                삭제
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                <h4 className={styles.subTitle}>학생별 제출 현황</h4>
                {assignmentSubs.map((sub) => {
                  const student = classInfo.students.find((s) => s.id === sub.studentId);
                  const hasUnverifiedPhoto = sub.hasPhoto && !sub.teacherVerified;
                  const showPhoto = photoOpenFor === sub.id;
                  return (
                    <div key={sub.id} className={styles.submissionRow}>
                      <div className={styles.submissionHeader}>
                        <span className={styles.submissionName}>{student?.name ?? sub.studentId}</span>
                        <span className={styles.statusTag} data-status={sub.status}>
                          {STATUS_LABELS[sub.status]}
                        </span>
                        {sub.notifiedToday && <span className={styles.notifiedTag}>오늘 문자 발송됨</span>}
                        {hasUnverifiedPhoto && <span className={styles.pendingTag}>선생님 확인 대기</span>}
                      </div>

                      <div className={styles.linkRow}>
                        <span className={styles.linkText}>
                          {HW_UPLOAD_BASE_URL}/?hw={sub.id}
                        </span>
                        <button
                          type="button"
                          className={styles.smallButton}
                          onClick={() => handleSendLink(sub.studentId, student?.name ?? '')}
                        >
                          업로드 링크 문자 발송
                        </button>
                        {sub.hasPhoto && (
                          <button
                            type="button"
                            className={styles.smallButton}
                            onClick={() => setPhotoOpenFor(showPhoto ? null : sub.id)}
                          >
                            제출 사진 보기
                          </button>
                        )}
                      </div>

                      {linkMessage[sub.studentId] && <p className={styles.successText}>{linkMessage[sub.studentId]}</p>}

                      {showPhoto && (
                        <div className={styles.photoReviewBox}>
                          <p className={styles.aiNote}>AI 1차 확인: 페이지 번호 인식 완료 (데모)</p>
                          <button
                            type="button"
                            className={styles.verifyButton}
                            data-verified={sub.teacherVerified}
                            onClick={() => onToggleTeacherVerified(sub.id)}
                          >
                            {sub.teacherVerified ? '✅ 선생님 확인 완료' : '✅ 선생님 확인'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                <div className={styles.bulkRow}>
                  <button type="button" className={styles.bulkButton} onClick={() => handleBulk(assignment.id)}>
                    학부모에게 완료/미완료 문자 발송
                  </button>
                  {bulkMessage[assignment.id] && <p className={styles.successText}>{bulkMessage[assignment.id]}</p>}
                </div>

                <button type="button" className={styles.deleteButton} onClick={() => onDeleteAssignment(assignment.id)}>
                  🗑️ 이 과제 삭제
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
