import { useMemo, useState } from 'react';
import { mockAssignments } from '../data/mockAssignments';
import { StepHeader } from '../components/StepHeader';
import { AssignmentCard } from '../components/AssignmentCard';
import { PageChecklist } from '../components/PageChecklist';
import { PhotoUpload } from '../components/PhotoUpload';
import { StepFooter } from '../components/StepFooter';
import styles from './AssignmentUpload.module.css';

const TOTAL_STEPS = 4;
const STEP_LABELS = ['', '과제 확인', '페이지 체크', '인증샷', '완료'];

export function AssignmentUpload() {
  const [step, setStep] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [checkedPages, setCheckedPages] = useState<Record<number, boolean>>({});
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const selected = useMemo(
    () => mockAssignments.find((a) => a.id === selectedId) ?? null,
    [selectedId],
  );

  const checkedList = useMemo(
    () =>
      Object.keys(checkedPages)
        .filter((k) => checkedPages[Number(k)])
        .map(Number)
        .sort((a, b) => a - b),
    [checkedPages],
  );

  const handleSelectAssignment = (id: number) => {
    setSelectedId(id);
    setCheckedPages({});
  };

  const handleTogglePage = (page: number) => {
    setCheckedPages((prev) => ({ ...prev, [page]: !prev[page] }));
  };

  const handlePhotoSelected = (file: File) => {
    setPhotoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  };

  const handleBack = () => setStep((s) => Math.max(1, s - 1));

  const handlePrimaryAction = () => {
    if (step === 1 && selectedId) setStep(2);
    else if (step === 2 && checkedList.length > 0) setStep(3);
    else if (step === 3) setStep(4);
    else if (step === 4) {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      setStep(1);
      setSelectedId(null);
      setCheckedPages({});
      setPhotoUrl(null);
    }
  };

  const primaryDisabled =
    (step === 1 && !selectedId) || (step === 2 && checkedList.length === 0);

  let primaryLabel = '다음';
  let primaryVariant: 'default' | 'accent' = 'default';
  if (step === 3) {
    primaryLabel = '제출하기';
    primaryVariant = 'accent';
  }
  if (step === 4) primaryLabel = '확인';

  return (
    <div className={styles.page}>
      <div className={styles.frame}>
        <StepHeader step={step} totalSteps={TOTAL_STEPS} stepLabel={STEP_LABELS[step]} />

        <div className={styles.content}>
          {step === 1 && (
            <div>
              <h1 className={styles.title}>오늘의 과제</h1>
              <p className={styles.subtitle}>인증할 과제를 선택해주세요</p>
              <div className={styles.cardList}>
                {mockAssignments.map((a) => (
                  <AssignmentCard
                    key={a.id}
                    assignment={a}
                    selected={a.id === selectedId}
                    onSelect={handleSelectAssignment}
                  />
                ))}
              </div>
            </div>
          )}

          {step === 2 && selected && (
            <div>
              <h1 className={styles.title}>완료한 페이지 체크</h1>
              <p className={styles.subtitle}>
                {selected.title} · {selected.pageStart}~{selected.pageEnd}페이지
              </p>
              <PageChecklist
                pageStart={selected.pageStart}
                pageEnd={selected.pageEnd}
                checkedPages={checkedPages}
                onTogglePage={handleTogglePage}
              />
            </div>
          )}

          {step === 3 && (
            <div>
              <h1 className={styles.title}>인증샷 업로드</h1>
              <p className={styles.subtitle}>완료한 문제집 페이지를 촬영해 올려주세요</p>
              <PhotoUpload photoUrl={photoUrl} onPhotoSelected={handlePhotoSelected} />
            </div>
          )}

          {step === 4 && selected && (
            <div className={styles.doneWrap}>
              <div className={styles.doneBadge}>
                <span className={styles.doneMark}>✓</span>
              </div>
              <h1 className={styles.doneTitle}>제출 완료</h1>
              <p className={styles.doneText}>
                {selected.title} {selected.pageStart}~{selected.pageEnd}페이지
                <br />
                인증이 정상적으로 접수되었습니다.
                <br />
                선생님이 확인 후 코멘트를 남겨드릴게요.
              </p>
              <div className={styles.summaryBox}>
                <div className={styles.summaryLabel}>완료한 페이지</div>
                <div className={styles.summaryValue}>
                  {checkedList.length ? `${checkedList.join(', ')}페이지` : ''}
                </div>
              </div>
            </div>
          )}
        </div>

        <StepFooter
          showBack={step > 1 && step < 4}
          onBack={handleBack}
          primaryLabel={primaryLabel}
          primaryDisabled={primaryDisabled}
          primaryVariant={primaryVariant}
          onPrimaryAction={handlePrimaryAction}
        />
      </div>
    </div>
  );
}
