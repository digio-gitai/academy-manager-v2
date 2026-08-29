import { useEffect, useState } from 'react';
import { extractTextFromFiles } from '../../lib/visionOcr';
import { refineAndAnalyzeTest } from '../../lib/examAnalysis';
import {
  saveTestWithQuestions,
  inferDominantTopic,
  suggestTestTitle,
  fetchRecentTests,
  fetchTestQuestions,
  deleteTestCascade,
  numericQuestionNumbers,
} from '../../lib/testAnalysis';
import type {
  TestQuestionDraft,
  QuestionType,
  DifficultyLevel,
  TestListItem,
} from '../../lib/testAnalysis';
import { TestResultAssignPanel } from './TestResultAssignPanel';
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
 * "학원시험 AI분석" 탭 — 시험지 업로드/OCR/GPT분석/문항편집/반·학생배정까지
 * 담당하는 화면. 스트림릿 page_ai_test_analysis()와 동일한 구조로 재정리함
 * (2026-08-29, 실사용 피드백 반영):
 *
 *  ① 기존 시험지 불러오기 — 이미 확정해둔 시험지를 다시 골라서, 시간차를
 *     두고 시험 본 학생들의 오답을 이어서 입력할 수 있음(스트림릿의
 *     _render_existing_test_selector()와 동일). 이게 없으면 매번 새로
 *     업로드해야 하고, 새로고침하면 방금 확정한 시험지를 다시 선택할 방법이
 *     없어서 저장이 잘 됐는지도 확인 못 하는 문제가 있었음 — 이번에 추가.
 *  ② 새 시험지 업로드 — OCR(Vision)과 GPT 분석을 버튼 하나로 한 번에 실행
 *     (원래는 확인 목적으로 "텍스트 추출"과 "GPT 분석"을 2단계로 나눠서
 *     따로 보여줬는데, 이제 둘 다 정상 동작 확인이 끝나서 스트림릿처럼
 *     하나로 합침 — 추출된 원문 텍스트도 더 이상 화면에 보여주지 않음).
 *  ③ 문항 확인·수정 — GPT 분석 결과를 표로 검토·수정 후 "확정"하면 TEST로 저장.
 *  ④ 학생별 오답 체크 — ①에서 고른 기존 시험지, 또는 방금 ③에서 확정한
 *     시험지 중 "현재 활성 시험지"를 대상으로 반/학생 오답 체크 → 저장.
 */
export function AiTestOcrPanel() {
  // ① 기존 시험지 불러오기
  const [existingTests, setExistingTests] = useState<TestListItem[]>([]);
  const [existingTestsLoading, setExistingTestsLoading] = useState(true);
  const [existingTestsError, setExistingTestsError] = useState('');
  const [selectedExistingId, setSelectedExistingId] = useState<number | null>(null);
  const [selectedExistingQuestions, setSelectedExistingQuestions] = useState<TestQuestionDraft[]>([]);
  const [selectedExistingLoading, setSelectedExistingLoading] = useState(false);
  const [selectedExistingError, setSelectedExistingError] = useState('');
  const [deleting, setDeleting] = useState(false);

  // ② 새 시험지 업로드
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [stage, setStage] = useState<'idle' | 'ocr' | 'analyzing'>('idle');
  const [uploadError, setUploadError] = useState('');
  const [refinedText, setRefinedText] = useState('');
  const [analysisPartial, setAnalysisPartial] = useState(false);

  // ③ 문항 확인·수정 + 확정 저장
  const [editQuestions, setEditQuestions] = useState<TestQuestionDraft[]>([]);
  const [testType, setTestType] = useState(TEST_TYPE_OPTIONS[0]);
  const [testTypeCustom, setTestTypeCustom] = useState('');
  const [testDate, setTestDate] = useState(todayStr());
  const [testTitle, setTestTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedTestId, setSavedTestId] = useState<number | null>(null);

  useEffect(() => {
    loadExistingTests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadExistingTests() {
    setExistingTestsLoading(true);
    setExistingTestsError('');
    fetchRecentTests()
      .then(setExistingTests)
      .catch((err) => setExistingTestsError(describeError(err)))
      .finally(() => setExistingTestsLoading(false));
  }

  function handleSelectExisting(idStr: string) {
    if (!idStr) {
      setSelectedExistingId(null);
      setSelectedExistingQuestions([]);
      setSelectedExistingError('');
      return;
    }
    const id = Number(idStr);
    setSelectedExistingId(id);
    setSelectedExistingLoading(true);
    setSelectedExistingError('');
    // 기존 시험지를 고르면, 방금 하던 새 업로드 확정 결과는 활성 상태에서 내려감(혼동 방지).
    setSavedTestId(null);
    fetchTestQuestions(id)
      .then(setSelectedExistingQuestions)
      .catch((err) => setSelectedExistingError(describeError(err)))
      .finally(() => setSelectedExistingLoading(false));
  }

  async function handleDeleteExisting() {
    if (selectedExistingId == null) return;
    const meta = existingTests.find((t) => t.id === selectedExistingId);
    const ok = window.confirm(
      `"${meta?.name ?? ''}" (${meta?.date ?? ''}) 시험지를 삭제할까요?\n\n` +
        '문항 정보와 저장된 학생 오답·점수 기록이 모두 삭제되며 되돌릴 수 없습니다.',
    );
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteTestCascade(selectedExistingId);
      setSelectedExistingId(null);
      setSelectedExistingQuestions([]);
      loadExistingTests();
    } catch (err) {
      setSelectedExistingError(describeError(err));
    } finally {
      setDeleting(false);
    }
  }

  function applyFiles(list: File[]) {
    setFiles(list);
    resetUploadAnalysis();
  }

  function resetUploadAnalysis() {
    setEditQuestions([]);
    setRefinedText('');
    setAnalysisPartial(false);
    setUploadError('');
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

  async function handleUploadAnalyze() {
    if (files.length === 0) return;
    resetUploadAnalysis();
    setStage('ocr');
    try {
      const pages = await extractTextFromFiles(files);
      const rawText = pages.map((p) => p.text || '').join('\n\n').trim();
      setStage('analyzing');
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
      // 새로 분석한 시험지가 이제부터 "현재 활성 시험지" — 기존 선택은 해제.
      setSelectedExistingId(null);
      setSelectedExistingQuestions([]);
    } catch (err) {
      setUploadError(describeError(err));
    } finally {
      setStage('idle');
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
      loadExistingTests(); // 방금 만든 시험지가 "기존 시험지" 목록에도 바로 보이도록 갱신
    } catch (err) {
      setSaveError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  const selectedExistingMeta = existingTests.find((t) => t.id === selectedExistingId) ?? null;

  const activeTest = selectedExistingId != null
    ? {
        id: selectedExistingId,
        name: selectedExistingMeta?.name ?? '',
        total: selectedExistingMeta?.totalQuestions ?? selectedExistingQuestions.length,
        questionNumbers: numericQuestionNumbers(selectedExistingQuestions),
      }
    : savedTestId != null
    ? {
        id: savedTestId,
        name: testTitle,
        total: editQuestions.length,
        questionNumbers: numericQuestionNumbers(editQuestions),
      }
    : null;

  return (
    <div>
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>📋 기존 시험지 불러오기</h3>
        <p className={styles.caption}>
          이미 확정해둔 시험지를 골라서, 시간차를 두고 시험 본 학생들의 오답을 이어서 입력할 수 있어요.
          예를 들어 오늘 3명, 내일 2명이 같은 시험을 봐도 같은 시험지로 기록됩니다.
        </p>

        {existingTestsLoading ? (
          <p className={styles.caption}>불러오는 중...</p>
        ) : existingTestsError ? (
          <p className={styles.errorText}>{existingTestsError}</p>
        ) : existingTests.length === 0 ? (
          <p className={styles.caption}>아직 저장된 시험지가 없습니다. 아래에서 새 시험지를 업로드해 주세요.</p>
        ) : (
          <select
            className={styles.existingSelect}
            value={selectedExistingId != null ? String(selectedExistingId) : ''}
            onChange={(e) => handleSelectExisting(e.target.value)}
          >
            <option value="">— 새 시험지 업로드 —</option>
            {existingTests.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.name} · {t.date} · {t.totalQuestions}문항
              </option>
            ))}
          </select>
        )}

        {selectedExistingId != null && (
          <>
            {selectedExistingLoading ? (
              <p className={styles.caption}>문항 불러오는 중...</p>
            ) : selectedExistingError ? (
              <p className={styles.errorText}>{selectedExistingError}</p>
            ) : (
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
                    {selectedExistingQuestions.map((q, i) => (
                      <tr key={i}>
                        <td>{q.questionNumber}</td>
                        <td>{q.questionType}</td>
                        <td>{q.topic}</td>
                        <td>{q.method}</td>
                        <td>{q.difficulty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button
              type="button"
              className={styles.deleteButton}
              onClick={handleDeleteExisting}
              disabled={deleting}
            >
              {deleting ? '삭제 중...' : '🗑️ 이 시험지 삭제'}
            </button>
          </>
        )}
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>📷 새 시험지 업로드</h3>
        <p className={styles.caption}>
          시험지 사진(1장 이상) 또는 PDF를 올리고 버튼을 누르면, OCR 텍스트 인식과 GPT 문항 분석(단원·풀이유형·
          난이도·유형, 수식 정리)이 한 번에 진행돼요. PDF는 페이지마다 자동으로 나눠서 처리합니다.
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
          onClick={handleUploadAnalyze}
          disabled={files.length === 0 || stage !== 'idle'}
        >
          {stage === 'ocr'
            ? 'OCR 텍스트 인식 중...'
            : stage === 'analyzing'
            ? 'GPT 분석 중... (10~20초)'
            : `OCR 실행 (Vision + GPT 분석) — ${files.length}개 파일`}
        </button>

        {uploadError && <p className={styles.errorText}>{uploadError}</p>}
      </div>

      {editQuestions.length > 0 && (
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>✏️ 문항 확인·수정</h3>
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

      {activeTest && (
        <div className={styles.card}>
          <div className={styles.activeTestBanner}>
            현재 선택된 시험지: <strong>{activeTest.name}</strong> · {activeTest.total}문항
          </div>
          <TestResultAssignPanel
            key={activeTest.id}
            testId={activeTest.id}
            testName={activeTest.name}
            totalQuestions={activeTest.total}
            questionNumbers={activeTest.questionNumbers}
          />
        </div>
      )}
    </div>
  );
}
