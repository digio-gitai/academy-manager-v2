import { useState } from 'react';
import { extractTextFromFiles } from '../../lib/visionOcr';
import type { OcrPage } from '../../lib/visionOcr';
import { refineAndAnalyzeTest } from '../../lib/examAnalysis';
import type { AnalyzedQuestion } from '../../lib/examAnalysis';
import styles from './AiTestOcrPanel.module.css';

/**
 * "학원시험 AI분석" 탭 — 1단계(OCR 텍스트 추출) + 1b단계(GPT 문항 분석) 확인용 화면.
 *
 * 2026-08-28: 스트림릿 page_ai_test_analysis()의 핵심 흐름(시험지 업로드 →
 * OCR → GPT 분석 → 문항 편집 → 반/학생 배정 → DB 저장)을 4단계로 나눠서
 * 진행하기로 함(사용자 확정). 1단계는 다시 1a(OCR만)/1b(GPT 분석 추가)로
 * 쪼갬 — 이 화면이 1a·1b를 모두 담당. 아직 문항 편집(사람이 고치는 UI)·
 * 반/학생 배정·DB 저장은 없음(2~4단계에서 추가 예정).
 *
 * 이미지(JPG/PNG 등) + PDF 둘 다 업로드 가능. 파일 선택은 클릭(파일 탐색기)뿐
 * 아니라 드래그 앤 드롭도 지원.
 */
export function AiTestOcrPanel() {
  const [files, setFiles] = useState<File[]>([]);
  const [pages, setPages] = useState<OcrPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');
  const [questions, setQuestions] = useState<AnalyzedQuestion[]>([]);
  const [refinedText, setRefinedText] = useState('');

  function applyFiles(list: File[]) {
    setFiles(list);
    setPages([]);
    setError('');
    setQuestions([]);
    setRefinedText('');
    setAnalyzeError('');
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
    setQuestions([]);
    setRefinedText('');
    setAnalyzeError('');
    try {
      const result = await extractTextFromFiles(files);
      setPages(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleAnalyze() {
    if (pages.length === 0) return;
    setAnalyzing(true);
    setAnalyzeError('');
    setQuestions([]);
    setRefinedText('');
    try {
      // 스트림릿 refine_and_analyze_with_gpt()와 동일하게, 여러 페이지 원문을
      // 빈 줄 하나로 이어붙여서 GPT에 한 번에 전달.
      const rawText = pages.map((p) => p.text || '').join('\n\n').trim();
      const result = await refineAndAnalyzeTest(rawText);
      setQuestions(result.questions);
      setRefinedText(result.refinedText);
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className={styles.card}>
      <span className={styles.badge}>1a단계 · OCR 텍스트 추출</span>
      <h3 className={styles.cardTitle}>📷 시험지 이미지/PDF → 텍스트 추출</h3>
      <p className={styles.caption}>
        시험지 사진(1장 이상) 또는 PDF를 올리고 "텍스트 추출" 버튼을 눌러보세요. Google Vision이 인식한 원문
        텍스트가 그대로 표시됩니다. PDF는 페이지마다 자동으로 나눠서 처리해요.
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

      {pages.length > 0 && (
        <div className={styles.analyzeSection}>
          <span className={styles.badge}>1b단계 · GPT 문항 분석</span>
          <p className={styles.caption}>
            위에서 추출한 원문을 GPT-4o에게 보내서, 문항마다 단원·풀이유형·난이도·유형(객관식/서술형)을
            분석하고 수식을 LaTeX로 정리합니다. 시험지 내용에 따라 몇 초~수십 초 걸릴 수 있어요.
          </p>
          <button
            type="button"
            className={styles.extractButton}
            onClick={handleAnalyze}
            disabled={analyzing}
          >
            {analyzing ? 'GPT 분석 중...' : 'GPT로 문항 분석하기'}
          </button>

          {analyzeError && <p className={styles.errorText}>{analyzeError}</p>}

          {questions.length > 0 && (
            <div className={styles.questionTableWrap}>
              <table className={styles.questionTable}>
                <thead>
                  <tr>
                    <th>번호</th>
                    <th>유형</th>
                    <th>단원</th>
                    <th>풀이유형</th>
                    <th>난이도</th>
                  </tr>
                </thead>
                <tbody>
                  {questions
                    .slice()
                    .sort((a, b) => a.number - b.number)
                    .map((q) => (
                      <tr key={q.number}>
                        <td>{q.number}</td>
                        <td>{q.questionType}</td>
                        <td>{q.topic}</td>
                        <td>{q.method}</td>
                        <td>{q.difficulty}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className={styles.caption}>총 {questions.length}문항 인식됨</p>
            </div>
          )}

          {refinedText && (
            <div className={styles.pageBlock}>
              <div className={styles.pageLabel}>수식 정제된 전체 텍스트</div>
              <pre className={styles.pageText}>{refinedText}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
