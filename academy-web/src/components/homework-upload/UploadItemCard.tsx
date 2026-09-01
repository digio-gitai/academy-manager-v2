import type { HwUploadItem, ItemFormState, RawItemInput } from '../../lib/hwUpload';
import { formatPageRanges } from '../../lib/hwUpload';
import { MultiPhotoField } from './MultiPhotoField';
import styles from './UploadItemCard.module.css';

interface UploadItemCardProps {
  item: HwUploadItem;
  raw: RawItemInput;
  derived: ItemFormState;
  onStartPageChange: (v: number) => void;
  onEndPageChange: (v: number) => void;
  onDoneChange: (v: boolean) => void;
  onNoteChange: (v: string) => void;
  onPhotosChange: (files: File[]) => void;
}

/** 문제집/프린트 항목 카드 1개 — 기존 mock의 AssignmentCard 카드 스타일을
 * 그대로 이어받되, "선택하는 카드"가 아니라 "입력하는 카드"로 바꾼 것.
 * 페이지 범위형은 오늘 시작~끝 페이지 스테퍼(±버튼), 오답정리형은 체크박스로
 * 나뉜다 — hw_upload.py의 _render_page_range_item()/_render_simple_item()과
 * 동일한 분기. */
export function UploadItemCard({
  item,
  raw,
  derived,
  onStartPageChange,
  onEndPageChange,
  onDoneChange,
  onNoteChange,
  onPhotosChange,
}: UploadItemCardProps) {
  return (
    <div className={styles.card} data-done={derived.done}>
      <div className={styles.headRow}>
        <div>
          <div className={styles.badge}>{item.itemType === 'page_range' ? '페이지 범위형' : '오답정리형'}</div>
          <div className={styles.materialName}>
            {item.materialName}
            {derived.isPageRange && ` (${item.pageStart}~${item.pageEnd}쪽)`}
          </div>
          {item.description && <div className={styles.description}>{item.description}</div>}
        </div>
        {derived.done && (
          <span className={styles.doneMark}>
            <span className={styles.doneMarkIcon}>✓</span>
          </span>
        )}
      </div>

      {derived.isPageRange ? (
        derived.alreadyFull ? (
          <p className={styles.fullNotice}>✅ 이 항목은 이미 전체 완료했어요. (더 인증할 필요 없음)</p>
        ) : (
          <div className={styles.pageRangeBlock}>
            {item.prevCompletedPages.length > 0 && (
              <p className={styles.progressCaption}>지금까지 완료: {formatPageRanges(item.prevCompletedPages)}</p>
            )}
            <div className={styles.stepperRow}>
              <NumberStepper
                label="오늘 시작 페이지"
                value={raw.startPage}
                min={item.pageStart!}
                max={item.pageEnd!}
                onChange={onStartPageChange}
              />
              <NumberStepper
                label="오늘 마지막 페이지"
                value={raw.endPage}
                min={item.pageStart! - 1}
                max={item.pageEnd!}
                onChange={onEndPageChange}
              />
            </div>
            {derived.newPageCount > 0 ? (
              <p className={styles.photoNeedCaption}>
                📷 오늘 {derived.newPageCount}쪽 인증 → 사진 {derived.newPageCount}장이 필요해요.
              </p>
            ) : (
              <p className={styles.mutedCaption}>오늘은 이 항목 진행 안 함으로 처리됩니다.</p>
            )}
            {!derived.done && derived.remainingPages.length > 0 && (
              <p className={styles.remainingCaption}>⏳ 남은 페이지: {formatPageRanges(derived.remainingPages)}</p>
            )}
          </div>
        )
      ) : (
        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={raw.done} onChange={(e) => onDoneChange(e.target.checked)} />
          <span>완료했어요</span>
        </label>
      )}

      <input
        type="text"
        className={styles.noteInput}
        placeholder="메모 (선택) 예: 3번 문제 어려웠어요"
        value={raw.note}
        onChange={(e) => onNoteChange(e.target.value)}
      />

      {item.existingPhotoCount > 0 && (
        <p className={styles.existingPhotoCaption}>📎 이미 올린 사진 {item.existingPhotoCount}장</p>
      )}

      {!derived.alreadyFull && (
        <MultiPhotoField
          photos={raw.photos}
          onChange={onPhotosChange}
          requiredLabel={
            derived.photoRule
              ? derived.photoRule.kind === 'exact'
                ? `사진 ${derived.photoRule.need}장 필요`
                : `사진 최소 ${derived.photoRule.need}장 필요`
              : '오늘 진행 안 하면 비워두세요'
          }
          satisfied={
            !derived.photoRule ||
            (derived.photoRule.kind === 'exact'
              ? raw.photos.length === derived.photoRule.need
              : raw.photos.length >= derived.photoRule.need)
          }
        />
      )}
    </div>
  );
}

interface NumberStepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}

function NumberStepper({ label, value, min, max, onChange }: NumberStepperProps) {
  return (
    <div className={styles.stepper}>
      <span className={styles.stepperLabel}>{label}</span>
      <div className={styles.stepperControl}>
        <button
          type="button"
          className={styles.stepperBtn}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          aria-label="감소"
        >
          −
        </button>
        <span className={styles.stepperValue}>{value}</span>
        <button
          type="button"
          className={styles.stepperBtn}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          aria-label="증가"
        >
          +
        </button>
      </div>
    </div>
  );
}
