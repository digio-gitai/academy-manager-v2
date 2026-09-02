/**
 * 기출문제분석 (`/past-exams`) — 학교 기출 시험지 PDF/이미지를 업로드하면
 * GPT-4o가 분석해서 5페이지 분석 보고서(HTML, 인쇄용)를 만들어주는 화면.
 *
 * 스트림릿 past_exam_analyzer.py(render_past_exam_analyzer_page)를 그대로
 * 참고해서 이식함. 학생/반 등 DB 데이터와 무관한 독립 도구라서(기출문제 PDF를
 * 넣으면 그 자체로 완결되는 분석), 다른 화면들과 달리 Supabase 테이블 CRUD가
 * 전혀 없음 — OCR(Google Vision, 기존 vision-ocr Edge Function 재사용) →
 * GPT 분석(신규 generate-past-exam-report Edge Function) → HTML 조립
 * (lib/pastExamReport.ts)까지만 있으면 끝.
 *
 * 원본과 다른 점:
 * - 로고 업로드: 원본은 서버(스트림릿 프로세스)의 로컬 파일로 저장해서 모든
 *   보고서에 재사용했지만, 여기는 별도 백엔드 저장소가 없어서 이 브라우저의
 *   localStorage에 저장함(다음에 이 화면을 열었을 때도 로고가 남아있음 —
 *   단, 다른 컴퓨터/브라우저에서는 다시 올려야 함).
 * - PDF 다운로드 버튼: 원본은 서버에서 Playwright로 PDF를 만들었지만, 여기는
 *   "통합보고서 작성"(A4 리포트)과 동일한 방식으로 브라우저 인쇄(Ctrl+P →
 *   PDF로 저장)를 안내함 — 별도 PDF 생성 백엔드가 필요 없음.
 * - "API 키 없으면 데모 데이터" 폴백은 이식 안 함(Edge Function은 항상 실제
 *   키로 호출됨).
 */
import { useEffect, useRef, useState } from 'react';
import { extractTextFromFiles } from '../lib/visionOcr';
import { analyzePastExam, generatePastExamReportHtml } from '../lib/pastExamReport';
import styles from './PastExamAnalyzer.module.css';

const LOGO_STORAGE_KEY = 'pastExamAnalyzerLogo';
const DEFAULT_ACADEMY_NAME = 'J MATH';

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [e.message, e.details, e.hint].filter(
      (v): v is string => typeof v === 'string' && v.trim() !== '',
    );
    if (parts.length > 0) {
      return parts.join(' — ') + (e.code ? ` (code: ${String(e.code)})` : '');
    }
  }
  return String(err);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

function sanitizeFilename(text: string, maxLen = 40): string {
  const cleaned = text.trim().replace(/[<>:"/\\|?*\n\r\t]/g, '');
  return cleaned.replace(/\s+/g, '_').slice(0, maxLen) || '기출분석';
}

export function PastExamAnalyzer() {
  const [schoolName, setSchoolName] = useState('');
  const [academyName, setAcademyName] = useState(DEFAULT_ACADEMY_NAME);
  const [reportTitle, setReportTitle] = useState('');
  const [logoDataUri, setLogoDataUri] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [stage, setStage] = useState<'idle' | 'ocr' | 'analyzing'>('idle');
  const [error, setError] = useState('');
  const [reportHtml, setReportHtml] = useState('');
  const [reportFileName, setReportFileName] = useState('past_exam_report.html');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LOGO_STORAGE_KEY);
      if (saved) setLogoDataUri(saved);
    } catch {
      // localStorage를 못 쓰는 환경이면 그냥 로고 없이 진행.
    }
  }, []);

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      setLogoDataUri(dataUrl);
      window.localStorage.setItem(LOGO_STORAGE_KEY, dataUrl);
    } catch {
      setError('로고 이미지를 읽지 못했습니다.');
    }
  }

  function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files || []);
    if (list.length > 0) setFiles(list);
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
    if (list.length > 0) setFiles(list);
  }

  async function handleGenerate() {
    if (!schoolName.trim()) {
      setError('학교명을 입력해 주세요.');
      return;
    }
    if (files.length === 0) return;
    setError('');
    setReportHtml('');
    try {
      setStage('ocr');
      const pages = await extractTextFromFiles(files);
      const examText = pages.map((p) => p.text || '').join('\n\n').trim();
      if (!examText) {
        throw new Error('업로드한 파일에서 텍스트를 읽지 못했습니다. 파일이 선명한지 확인해 주세요.');
      }

      setStage('analyzing');
      const data = await analyzePastExam(schoolName.trim(), examText);
      const html = generatePastExamReportHtml(data, {
        schoolName: schoolName.trim(),
        academyName: academyName.trim() || DEFAULT_ACADEMY_NAME,
        reportTitle: reportTitle.trim(),
        logoUri: logoDataUri,
      });
      setReportHtml(html);
      const today = new Date().toISOString().slice(0, 10);
      setReportFileName(`기출분석_${sanitizeFilename(schoolName)}_${today}.html`);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setStage('idle');
    }
  }

  function handleDownload() {
    if (!reportHtml) return;
    const blob = new Blob([reportHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = reportFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handlePrint() {
    if (!reportHtml) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.open();
    printWindow.document.write(reportHtml);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
    };
  }

  const busy = stage !== 'idle';
  const stageLabel = stage === 'ocr' ? '파일에서 텍스트 추출 중...' : stage === 'analyzing' ? 'GPT 분석 중... (약 10~20초)' : '📊 분석 보고서 생성';

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>기출문제 분석 보고서</h2>
      <p className={styles.caption}>학교 기출 시험지 PDF/이미지 → GPT 분석 → 5페이지 인쇄용 보고서</p>

      <div className={styles.card}>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>학교명 *</span>
            <input
              className={styles.input}
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
              placeholder="예: 장충고등학교 고2"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>학원명</span>
            <input
              className={styles.input}
              value={academyName}
              onChange={(e) => setAcademyName(e.target.value)}
            />
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span className={styles.fieldLabel}>보고서 제목</span>
            <input
              className={styles.input}
              value={reportTitle}
              onChange={(e) => setReportTitle(e.target.value)}
              placeholder="예: 2026학년도 장충고 고2 1학기 중간고사 분석보고서 (비워두면 자동 생성)"
            />
          </label>
        </div>

        <div className={styles.logoRow}>
          {logoDataUri ? (
            <img src={logoDataUri} alt="학원 로고" className={styles.logoPreview} />
          ) : (
            <div className={styles.logoPlaceholder}>로고 없음</div>
          )}
          <label className={styles.logoUploadButton}>
            로고 업로드
            <input type="file" accept="image/png,image/jpeg" onChange={handleLogoChange} hidden />
          </label>
          <span className={styles.logoHint}>이 브라우저에 저장되어 다음에도 재사용됩니다.</span>
        </div>

        <div className={styles.fileRow}>
          <div
            className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {files.length === 0 ? (
              <p className={styles.dropzoneText}>📎 여기로 기출 파일(PDF/JPG/PNG)을 끌어다 놓거나, 클릭해서 선택하세요</p>
            ) : (
              <p className={styles.dropzoneText}>
                📎 {files.length}개 파일 선택됨: {files.map((f) => f.name).join(', ')}
                <br />
                (다시 클릭하거나 새로 끌어다 놓으면 선택이 바뀝니다)
              </p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              multiple
              onChange={handleFilesChange}
              className={styles.hiddenFileInput}
            />
          </div>
        </div>

        <button
          type="button"
          className={styles.generateButton}
          onClick={handleGenerate}
          disabled={busy || files.length === 0}
        >
          {stageLabel}
        </button>

        {error && <p className={styles.errorText}>{error}</p>}
      </div>

      {reportHtml && (
        <div className={styles.card}>
          <div className={styles.previewActions}>
            <button type="button" className={styles.secondaryButton} onClick={handleDownload}>
              ⬇️ HTML 파일로 다운로드
            </button>
            <button type="button" className={styles.secondaryButton} onClick={handlePrint}>
              🖨️ 인쇄 / PDF로 저장
            </button>
          </div>
          <iframe title="기출문제분석 보고서 미리보기" srcDoc={reportHtml} className={styles.previewFrame} />
        </div>
      )}
    </div>
  );
}
