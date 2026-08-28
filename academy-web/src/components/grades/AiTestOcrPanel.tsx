import { useState } from 'react';
import { extractTextFromFiles } from '../../lib/visionOcr';
import type { OcrPage } from '../../lib/visionOcr';
import styles from './AiTestOcrPanel.module.css';

/**
 * "학원시험 AI분석" 탭 — 1단계(OCR 텍스트 추출) 확인용 화면.
 *
 * 2026-08-28: 스트림릿 page_ai_test_analysis()의 핵심 흐름(시험지 업로드 →
 * OCR → GPT 분석 → 문항 편집 → 반/학생 배정 → DB 저장)을 4단계로 나눠서
 * 진행하기로 함(사용자 확정). 이 화면은 그중 1단계만 담당 — 시험지 이미지를
 * 올리면 Google Vision OCR(vision-ocr Edge Function)이 텍스트를 얼마나 잘
 * 읽어내는지 확인하는 용도. 아직 GPT 정제/분석, 문항 편집, DB 저장은 없음
 * (다음 단계에서 추가 예정).
 *
 * 이미지(JPG/PNG 등) + PDF 둘 다 업로드 가능(PDF는 사용자 요청으로 같은 날
 * 추가함 — 시험지를 스캔해서 PDF로 받는 경우가 많아서). PDF는 페이지마다
 * 자동으로 이미지로 변환돼서 각각 OCR 처리됨.
 * 파일 선택은 클릭(파일 탐색기)뿐 아니라 드래그 앤 드롭도 지원(사용자 요청,
 * 2026-08-28).
 */
export function AiTestOcrPanel() {
  const [files, setFiles] = useState<File[]>([]);
  const [pages, setPages] = useState<OcrPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  function applyFiles(list: File[]) {
    setFiles(list);
    setPages([]);
    setError('');
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files ? Array.from(e.target.files) : [];
    applyFiles(list);
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const list = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    if (list.length > 0) {
      applyFiles(list);
    }
  }

  async function handleExtract() {
    if (files.length === 0) return;
    setLoading(true);
    setError('');
    setPages([]);
    try {
      const result = await extractTextFromFiles(files);
      setPages(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.card}>
      <span className={styles.badge}>1단계 테스트 · OCR 텍스트 추출 확인</span>
      <h3 className={styles.cardTitle}>📷 시험지 이미지/PDF → 텍스트 추출</h3>
      <p className={styles.caption}>
        시험지 사진(1장 이상) 또는 PDF를 올리고 "텍스트 추출" 버튼을 눌러보세요. Google Vision이 인식한 원문
        텍스트가 그대로 표시됩니다. PDF는 페이지마다 자동으로 나눠서 처리해요. (아직 문항 분석·저장 기능은 없어요
        — OCR 인식 정확도만 먼저 확인하는 화면입니다.)
      </p>

      <div
        className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {files.length === 0 ? (
          <p className={styles.dropzoneText}>여기로 파일을 끌어다 놓거나, 클릭해서 선택하세요</p>
        ) : (
          <p className={styles.dropzoneText}>
            {files.length}개 파일 선택됨 — {files.map((f) => f.name).join(', ')}
            <br />
            (다시 클릭하거나 새로 끌어다 놓으면 선택이 바뀝니다)
          </p>
        )}
        <input
          type="file"
          accept="image/*,application/pdf"
          multiple
          onChange={handleFileChange}
          className={styles.hiddenFileInput}
        />
      </div>

      <button
        type="button"
        className={styles.extractButton}
        onClick={handleExtract}
        disabled={files.length === 0 || loading}
      >
        {loading ? '텍스트 추출 중...' : `텍스트 추출 (${files.length}개 파일)`}
      </button>

      {error && <p className={styles.errorText}>{error}</p>}

      {pages.map((p) => (
        <div key={p.page} className={styles.pageBlock}>
          <div className={styles.pageLabel}>{p.page}페이지</div>
          <pre className={styles.pageText}>{p.text || '(인식된 텍스트가 없습니다)'}</pre>
        </div>
      ))}
    </div>
  );
}
