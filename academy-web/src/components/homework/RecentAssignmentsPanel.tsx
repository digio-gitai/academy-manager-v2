import { useState } from 'react';
import type { ClassInfo } from '../../types/classManagement';
import type { HwAssignment, HwItem, HwItemPhotoGroup, HwSubmission, HwSubmissionStatus } from '../../types/homework';
import { HW_ITEM_TYPE_LABELS } from '../../types/homework';
import { HW_UPLOAD_BASE_URL } from '../../data/mockHomework';
import { fetchSubmissionPhotoDetails, setPhotoTeacherVerified } from '../../lib/homework';
import { runPageVerification } from '../../lib/hwUpload';
import styles from './RecentAssignmentsPanel.module.css';

const STATUS_LABELS: Record<HwSubmissionStatus, string> = {
  not_viewed: '안 봄',
  viewed: '열람함',
  done: '완료',
};

// hw_photo_review.py의 _FLAG_LABELS 대응.
const AI_FLAG_LABELS: Record<string, string> = {
  match: '✅ AI: 범위 일치',
  mismatch: '⚠️ AI: 페이지 불일치 의심',
  unclear: '❔ AI: 못 읽음(직접 확인 필요)',
  error: '❌ AI 검증 오류',
  no_api_key: '❌ API 키 없음',
};

interface RecentAssignmentsPanelProps {
  classInfo: ClassInfo;
  assignments: HwAssignment[];
  items: HwItem[];
  submissions: HwSubmission[];
  onDeleteItem: (itemId: string) => void;
  onDeleteAssignment: (assignmentId: string) => void;
  onSendUploadLink: (studentId: string) => void;
  onPhotosChanged: () => void;
  onBulkSms: (assignmentId: string) => { sentNames: string[]; skippedNames: string[] };
}

/**
 * 스트림릿 render_hw_assign_page()의 "최근 부여한 과제" 재현: 과제별 항목
 * 표(삭제 가능) + 학생별 제출 현황(업로드 링크 문자 발송, 사진 확인, 완료/미완료
 * 일괄 문자 발송) + 과제 삭제.
 *
 * 2026-08-26 수정: "제출 사진 보기" 버튼이 원래 sub.hasPhoto가 true일 때만
 * 보이게 되어있었는데, 실제 스트림릿 화면은 사진이 없어도(아직 학생이 안
 * 올렸어도) 이 메뉴 자체는 항상 보이고 펼치면 "아직 제출된 사진이 없습니다"로
 * 표시됨 — 그 동작과 맞추기 위해 버튼을 항상 노출하도록 변경.
 *
 * [2026-09-01] 과제인증 4단계(3/3): "제출 사진 보기"를 실제 hw_photo_review.py
 * 수준으로 다시 만듦 — 항목(문제집/프린트)별로 사진을 실제로 보여주고, 사진
 * 마다 AI 1차 판독 결과 배지 + "다시 확인"/"선생님 확인" 버튼을 개별로 둠
 * (기존엔 "AI 1차 확인: 완료 (데모)"라는 가짜 문구 + 제출 1건 전체를 한 번에
 * 확인 처리하는 버튼뿐이었음). 펼칠 때만 지연 조회(fetchSubmissionPhotoDetails).
 */
export function RecentAssignmentsPanel({
  classInfo,
  assignments,
  items,
  submissions,
  onDeleteItem,
  onDeleteAssignment,
  onSendUploadLink,
  onPhotosChanged,
  onBulkSms,
}: RecentAssignmentsPanelProps) {
  const [openAssignmentId, setOpenAssignmentId] = useState<string | null>(null);
  const [photoOpenFor, setPhotoOpenFor] = useState<string | null>(null);
  const [linkMessage, setLinkMessage] = useState<Record<string, string>>({});
  const [bulkMessage, setBulkMessage] = useState<Record<string, string>>({});

  // [2026-09-01] 과제인증 4단계(3/3): 사진별 AI 검증 결과 표시용 상태.
  const [photoDetails, setPhotoDetails] = useState<Record<string, HwItemPhotoGroup[]>>({});
  const [photoLoadingFor, setPhotoLoadingFor] = useState<string | null>(null);
  const [photoErrors, setPhotoErrors] = useState<Record<string, string>>({});
  const [verifyingPhotoId, setVerifyingPhotoId] = useState<string | null>(null);
  const [recheckingPhotoId, setRecheckingPhotoId] = useState<string | null>(null);

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

  async function loadPhotoDetails(submissionId: string) {
    setPhotoLoadingFor(submissionId);
    setPhotoErrors((prev) => ({ ...prev, [submissionId]: '' }));
    try {
      const groups = await fetchSubmissionPhotoDetails(submissionId);
      setPhotoDetails((prev) => ({ ...prev, [submissionId]: groups }));
    } catch (err) {
      setPhotoErrors((prev) => ({ ...prev, [submissionId]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setPhotoLoadingFor(null);
    }
  }

  function handleTogglePhotos(submissionId: string) {
    const opening = photoOpenFor !== submissionId;
    setPhotoOpenFor(opening ? submissionId : null);
    if (opening && !photoDetails[submissionId]) {
      loadPhotoDetails(submissionId);
    }
  }

  async function handleVerifyPhoto(submissionId: string, photoId: string, verified: boolean) {
    setVerifyingPhotoId(photoId);
    try {
      await setPhotoTeacherVerified(photoId, verified);
      await loadPhotoDetails(submissionId);
      onPhotosChanged();
    } catch (err) {
      setPhotoErrors((prev) => ({ ...prev, [submissionId]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setVerifyingPhotoId(null);
    }
  }

  async function handleRecheckPhoto(
    submissionId: string,
    photoId: string,
    photoUrl: string,
    materialName: string,
    pageStart: number,
    pageEnd: number
  ) {
    setRecheckingPhotoId(photoId);
    try {
      await runPageVerification(Number(photoId), photoUrl, classInfo.id, materialName, pageStart, pageEnd);
      await loadPhotoDetails(submissionId);
    } catch (err) {
      setPhotoErrors((prev) => ({ ...prev, [submissionId]: err instanceof Error ? err.message : String(err) }));
    } finally {
      setRecheckingPhotoId(null);
    }
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
                        <button
                          type="button"
                          className={styles.smallButton}
                          onClick={() => handleTogglePhotos(sub.id)}
                        >
                          제출 사진 보기
                        </button>
                      </div>

                      {linkMessage[sub.studentId] && <p className={styles.successText}>{linkMessage[sub.studentId]}</p>}

                      {showPhoto && (
                        <div className={styles.photoReviewBox}>
                          {photoLoadingFor === sub.id && <p className={styles.aiNote}>불러오는 중...</p>}
                          {photoErrors[sub.id] && <p className={styles.errorText}>{photoErrors[sub.id]}</p>}
                          {photoLoadingFor !== sub.id && (() => {
                            const groups = (photoDetails[sub.id] ?? []).filter((g) => g.photos.length > 0);
                            if (groups.length === 0) {
                              return <p className={styles.aiNote}>아직 제출된 사진이 없습니다.</p>;
                            }
                            return groups.map((group) => (
                              <div key={group.itemId} className={styles.photoItemGroup}>
                                <p className={styles.photoItemTitle}>
                                  {group.materialName} — 사진 {group.photos.length}장
                                </p>
                                <div className={styles.photoGrid}>
                                  {group.photos.map((photo) => {
                                    const isPageRangeItem =
                                      group.itemType === 'page_range' && group.pageStart != null && group.pageEnd != null;
                                    return (
                                      <div key={photo.id} className={styles.photoCard}>
                                        <img src={photo.photoUrl} alt="제출 사진" className={styles.photoImg} />
                                        {photo.aiFlag ? (
                                          <p className={styles.aiNote}>
                                            {AI_FLAG_LABELS[photo.aiFlag] ?? photo.aiFlag}
                                            {photo.aiPageGuess ? ` (${photo.aiPageGuess}쪽)` : ''}
                                          </p>
                                        ) : isPageRangeItem ? (
                                          <p className={styles.aiNote}>⏳ 자동 검증 대기/실패</p>
                                        ) : (
                                          <p className={styles.aiNote}>오답정리형 — AI 페이지 검증 대상 아님</p>
                                        )}
                                        {isPageRangeItem && (
                                          <button
                                            type="button"
                                            className={styles.smallButton}
                                            disabled={recheckingPhotoId === photo.id}
                                            onClick={() =>
                                              handleRecheckPhoto(
                                                sub.id,
                                                photo.id,
                                                photo.photoUrl,
                                                group.materialName,
                                                group.pageStart!,
                                                group.pageEnd!
                                              )
                                            }
                                          >
                                            {recheckingPhotoId === photo.id
                                              ? '확인 중...'
                                              : photo.aiFlag
                                                ? '🔄 AI 다시 확인'
                                                : '🤖 AI 페이지 확인'}
                                          </button>
                                        )}
                                        {photo.teacherVerified ? (
                                          <p className={styles.aiNote}>👍 선생님 확인함 ({photo.teacherVerifiedAt})</p>
                                        ) : (
                                          <button
                                            type="button"
                                            className={styles.verifyButton}
                                            disabled={verifyingPhotoId === photo.id}
                                            onClick={() => handleVerifyPhoto(sub.id, photo.id, true)}
                                          >
                                            {verifyingPhotoId === photo.id ? '처리 중...' : '✅ 선생님 확인'}
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ));
                          })()}
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
