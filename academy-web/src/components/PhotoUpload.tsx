import { useRef, useState } from 'react';
import styles from './PhotoUpload.module.css';

interface PhotoUploadProps {
  photoUrl: string | null;
  onPhotoSelected: (file: File) => void;
}

export function PhotoUpload({ photoUrl, onPhotoSelected }: PhotoUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const browseInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onPhotoSelected(file);
  };

  return (
    <div>
      <div
        className={styles.dropzone}
        data-drag={dragActive}
        onClick={() => browseInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          handleFiles(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
      >
        {photoUrl ? (
          <img src={photoUrl} alt="업로드한 인증샷" className={styles.preview} />
        ) : (
          <span className={styles.placeholder}>사진을 드래그하거나 클릭해 업로드</span>
        )}
        <input
          ref={browseInputRef}
          type="file"
          accept="image/*"
          className={styles.hiddenInput}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      <div className={styles.cameraRow}>
        <button
          type="button"
          className={styles.cameraButton}
          onClick={() => cameraInputRef.current?.click()}
          aria-label="카메라로 촬영"
        >
          <span className={styles.cameraIcon} />
        </button>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className={styles.hiddenInput}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      <p className={styles.hint}>카메라 아이콘을 눌러 촬영하거나 위 영역에 사진을 올려주세요</p>
    </div>
  );
}
