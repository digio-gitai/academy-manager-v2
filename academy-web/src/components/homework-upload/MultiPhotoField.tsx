import { useEffect, useRef, useState } from 'react';
import styles from './MultiPhotoField.module.css';

interface MultiPhotoFieldProps {
  photos: File[];
  onChange: (files: File[]) => void;
  requiredLabel: string;
  satisfied: boolean;
}

function useObjectUrls(files: File[]): string[] {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const next = files.map((f) => URL.createObjectURL(f));
    setUrls(next);
    return () => {
      next.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [files]);
  return urls;
}

/** 항목 하나당 여러 장의 인증 사진을 첨부하는 위젯. 기존 PhotoUpload(1장 전용)의
 * 드롭존+카메라 버튼 시각 언어를 유지하되, 여러 장을 썸네일 그리드로 보여주고
 * 낱장 삭제가 가능하도록 확장했다. */
export function MultiPhotoField({ photos, onChange, requiredLabel, satisfied }: MultiPhotoFieldProps) {
  const urls = useObjectUrls(photos);
  const browseRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    onChange([...photos, ...Array.from(files)]);
  };

  const removeAt = (idx: number) => {
    onChange(photos.filter((_, i) => i !== idx));
  };

  return (
    <div className={styles.field}>
      <div className={styles.grid}>
        {photos.map((_, i) => (
          <div key={i} className={styles.thumb}>
            <img src={urls[i]} alt={`인증 사진 ${i + 1}`} className={styles.thumbImg} />
            <button type="button" className={styles.removeBtn} onClick={() => removeAt(i)} aria-label="사진 삭제">
              ×
            </button>
          </div>
        ))}
        <div
          className={styles.addTile}
          onClick={() => browseRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') browseRef.current?.click();
          }}
        >
          <span className={styles.addPlus}>+</span>
        </div>
      </div>

      <div className={styles.bottomRow}>
        <span className={styles.requiredLabel} data-satisfied={satisfied}>
          {requiredLabel} (현재 {photos.length}장)
        </span>
        <button type="button" className={styles.cameraButton} onClick={() => cameraRef.current?.click()} aria-label="카메라로 촬영">
          <span className={styles.cameraIcon} />
        </button>
      </div>

      <input
        ref={browseRef}
        type="file"
        accept="image/*"
        multiple
        className={styles.hiddenInput}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className={styles.hiddenInput}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
