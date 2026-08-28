import { useState } from 'react';
import { extractTextFromFiles } from '../../lib/visionOcr';
import type { OcrPage } from '../../lib/visionOcr';
import { refineAndAnalyzeTest } from '../../lib/examAnalysis';
import {
  saveTestWithQuestions,
  inferDominantTopic,
  suggestTestTitle,
} from '../../lib/testAnalysis';
import type { TestQuestionDraft, QuestionType, DifficultyLevel } from '../../lib/testAnalysis';
import styles from './AiTestOcrPanel.module.css';

const TEST_TYPE_OPTIONS = ['일일테스트', '주간테스트', '월간테스트', '단원테스트', '기타'];
const QUESTION_TYPE_OPTIONS: QuestionType[] = ['객관식', '서술형'];
const DIFFICULTY_OPTIONS: DifficultyLevel[] = ['A', 'B', 'C', 'D', 'E'];

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * catch(err)로 잡히는 값이 항상 Error 인스턴스는 아님 — Supabase(PostgREST)가
 * 던지는 에러는 { message, details, hint, code } 형태의 평범한 객체라서,
 * `err instanceof Error`가 false가 되어 String(err)를 타면 "[object Object]"
 * 처럼 의미 없는 문자열만 표시되는 버그가 있었음(2026-08-28, 실사용 중 발견).
 * message/details/hint/code 중 있는 것만 골라 사람이 읽을 수 있는 문장으로 만듦.
 */
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

/**
 * "학원시험 AI분석" 탭 — 1a(OCR 텍스트 추출) + 1b(GPT 문항 분석) + 2단계(검토·
 * 편집 후 TEST로 확정 저장)까지 담당하는 화면.
 *
 * 스트림릿 page_ai_test_analysis()의 흐름(시험지 업로드 → OCR → GPT 분석 →
 * 문항 편집 → 반/학생 배정 → DB 저장)을 4단계로 나눠 진행 중(사용자 확정,
 * 2026-08-28). 1a·1b는 이미 확인 완료. 이 화면에서 새로 추가된 부분(2단계):
 * GPT가 분석한 문항을 표로 보여주고 직접 고칠 수 있게 한 뒤(번호/단원/
 * 풀이유형/유형/난이도), 테스트 종류·시험일·제목을 정해서 "확정" 누르면
 * `tests`+`test_questions` 테이블에 저장됨 — 스트림릿의 save_test_with_questions()와
 * 동일한 저장 방식. 아직 반/학생 배정(3단계)과 기존 화면 연동(4단계)은 없음.
 *
 * 원본과 다른 점 1가지: 업로드한 시험지 파일 자체를 서버에 저장하는 기능은
 * 아직 없음(DB에는 문항 데이터만 저장) — 나중에 필요해지면 별도로 추가 예정.
 */
export function AiTestOcrPanel() {
  const [files, setFiles] = useState<File[]>([]);
  const [pages, setPages] = useState<OcrPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');
  const [refinedText, setRefinedText] = useState('');
  const [analysisPartial, setAnalysisPartial] = useState(false);

  // 2단계: 검토/편집 상태
  const [editQuestions, setEditQuestions] = useState<TestQuestionDraft[]>([]);
  const [testType, setTestType] = useState(TEST_TYPE_OPTIONS[0]);
  const [testTypeCustom, setTestTypeCustom] = useState('');
  const [testDate, setTestDate] = useState(todayStr());
  const [testTitle, setTestTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedTestId, setSavedTestId] = useState<number | null>(null);

  function applyFiles(list: File[]) {
    setFiles(list);
    setPages([]);
    setError('');
    resetAnalysis();
  }

  function resetAnalysis() {
    setEditQuestions([]);
    setRefinedText('');
    setAnalysisPartial(false);
    setAnalyzeError('');
    setTestTitle('');
    setSavedTestId(null);
    setSaveError('');
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
    resetAnalysis();
    try {
      const result = await extractTextFromFiles(files);
      setPages(result);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleAnalyze() {
    if (pages.length === 0) return;
    setAnalyzing(true);
    setAnalyzeError('');
    resetAnalysis();
    try {
      const rawText = pages.map((p) => p.text || '').join('\n\n').trim();
      const result = await refineAndAnalyzeTest(rawText);
      const drafts: TestQuestionDraft[] = result.questions
        .slice()
        .sort((a, b) => a.number - b.number)
        .map((q) => ({
          questionNumber: String(q.number),
          topic: q.topic,
          method: q.method,
          questionType: (q.questionType === '서술형' ? '서술형' : '객관식') as QuestionType,
          difficulty: (DIFFICULTY_OPTIONS.includes(q.difficulty as DifficultyLevel)
            ? q.difficulty
            : 'C') as DifficultyLevel,
        }));
      setEditQuestions(drafts);
      setRefinedText(result.refinedText);
      setAnalysisPartial(Boolean(result.partial));
      const dominant = inferDominantTopic(drafts);
      setTestTitle(suggestTestTitle(dominant, files[0]?.name, testDate));
    } catch (err) {
      setAnalyzeError(describeError(err));
    } finally {
      setAnalyzing(false);
    }
  }

  function updateQuestion(index: number, patch: Partial<TestQuestionDraft>) {
    setEditQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  function removeQuestion(index: number) {
    setEditQuestions((prev) => prev.filter((_, i) => i !== index));
  }

  function addQuestion() {
    const nextNumber = editQuestions.length > 0
      ? String((Number(editQuestions[editQuestions.length - 1].questionNumber) || editQuestions.length) + 1)
      : '1';
    setEditQuestions((prev) => [
      ...prev,
      { questionNumber: nextNumber, topic: '미분류', method: '', questionType: '객관식', difficulty: 'C' },
    ]);
  }

  async function handleConfirm() {
    setSaveError('');
    setSavedTestId(null);
    if (editQuestions.length === 0) {
      setSaveError('저장할 문항이 없습니다.');
      return;
    }
    if (editQuestions.some((q) => !q.questionNumber.trim())) {
      setSaveError('모든 문항에 문항번호를 입력해 주세요.');
      return;
    }
    const finalType = testType === '기타' ? (testTypeCustom.trim() || '기타') : testType;
    const dominant = inferDominantTopic(editQuestions);
    setSaving(true);
    try {
      const testId = await saveTestWithQuestions({
        testName: testTitle,
        testDate,
        testType: finalType,
        questions: editQuestions,
        analysisData: {
          detected_count: editQuestions.length,
          dominant_topic: dominant,
          source: 'ocr_vision_gpt_react',
          original_upload: files[0]?.name || '',
        },
      });
      setSavedTestId(testId);
    } catch (err) {
      setSaveError(describeError(err));
    } finally {
      setSaving(false);
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
        </div>
      )}

      {editQuestions.length > 0 && (
        <div className={styles.analyzeSection}>
          <span className={styles.badge}>2단계 · 문항 정보 확인·수정</span>
          <p className={styles.caption}>
            GPT가 분석한 결과예요. 틀린 부분이 있으면 아래 표에서 직접 고치세요. 문항을 빼려면 그 줄의
            "삭제"를, 빠진 문항이 있으면 아래 "+ 문항 추가"를 눌러 채우면 됩니다.
          </p>
          {analysisPartial && (
            <p className={styles.errorText} style={{ color: '#b8860b' }}>
              ⚠️ 문항 수가 많아서 수식 정제 텍스트는 만들지 못했어요(문항 분석표는 정상적으로 복구됨). 아래
              표 내용을 확인해서 저장하시면 됩니다 — "수식 정제된 전체 텍스트"는 이번엔 비어 있어요.
            </p>
          )}

          <div className={styles.questionTableWrap}>
            <table className={styles.questionTable}>
              <thead>
                <tr>
                  <th>번호</th>
                  <th>유형</th>
                  <th>단원</th>
                  <th>풀이유형</th>
                  <th>난이도</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {editQuestions.map((q, idx) => (
                  <tr key={idx}>
                    <td>
                      <input
                        className={styles.cellInput}
                        style={{ width: 52 }}
                        value={q.questionNumber}
                        onChange={(e) => updateQuestion(idx, { questionNumber: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className={styles.cellSelect}
                        value={q.questionType}
                        onChange={(e) => updateQuestion(idx, { questionType: e.target.value as QuestionType })}
                      >
                        {QUESTION_TYPE_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className={styles.cellInput}
                        style={{ width: 110 }}
                        value={q.topic}
                        onChange={(e) => updateQuestion(idx, { topic: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className={styles.cellInput}
                        style={{ width: 220 }}
                        value={q.method}
                        onChange={(e) => updateQuestion(idx, { method: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className={styles.cellSelect}
                        value={q.difficulty}
                        onChange={(e) => updateQuestion(idx, { difficulty: e.target.value as DifficultyLevel })}
                      >
                        {DIFFICULTY_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={styles.rowDeleteButton}
                        onClick={() => removeQuestion(idx)}
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className={styles.addRowButton} onClick={addQuestion}>
              + 문항 추가
            </button>
          </div>

          <div className={styles.testTypeRow}>
            <span className={styles.fieldLabel}>테스트 종류</span>
            <div className={styles.testTypeButtons}>
              {TEST_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={`${styles.testTypeButton} ${testType === opt ? styles.testTypeButtonActive : ''}`}
                  onClick={() => setTestType(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
            {testType === '기타' && (
              <input
                className={styles.cellInput}
                style={{ width: 220, marginTop: 8 }}
                placeholder="예: 2단원 연립방정식"
                value={testTypeCustom}
                onChange={(e) => setTestTypeCustom(e.target.value)}
              />
            )}
          </div>

          <div className={styles.metaGrid}>
            <div>
              <span className={styles.fieldLabel}>시험일</span>
              <input
                type="date"
                className={styles.cellInput}
                style={{ width: '100%' }}
                value={testDate}
                onChange={(e) => setTestDate(e.target.value)}
              />
            </div>
            <div>
              <span className={styles.fieldLabel}>시험지 제목 (자동 생성 · 수정 가능)</span>
              <input
                className={styles.cellInput}
                style={{ width: '100%' }}
                value={testTitle}
                onChange={(e) => setTestTitle(e.target.value)}
              />
            </div>
          </div>

          <button
            type="button"
            className={styles.extractButton}
            onClick={handleConfirm}
            disabled={saving}
          >
            {saving ? '저장 중...' : '확정 (TEST DB 저장)'}
          </button>

          {saveError && <p className={styles.errorText}>{saveError}</p>}
          {savedTestId !== null && (
            <p className={styles.successText}>
              "{testTitle}" 확정 완료 — 문항 {editQuestions.length}개 · ID {savedTestId}
            </p>
          )}

          {refinedText && (
            <div className={styles.pageBlock}>
              <div className={styles.pageLabel}>수식 정제된 전체 텍스트 (참고용)</div>
              <pre className={styles.pageText}>{refinedText}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
