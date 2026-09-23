import { useEffect, useState } from 'react';
import { fetchTestResultStudents } from '../../lib/testResults';
import type { TestResultStudent } from '../../lib/testResults';
import { buildIntegratedReportData, summarizeForAiComment } from '../../lib/integratedReport';
import type { IntegratedReportData } from '../../lib/integratedReport';
import { buildWebReportHtml } from '../../lib/webReportHtml';
import { generateParentComment } from '../../lib/parentComment';
import { createReportLink, markReportSent, buildParentReportLinkText } from '../../lib/reportLinks';
import { fetchStudentContact } from '../../lib/students';
import { sendBulkSms } from '../../lib/smsSend';
import styles from './IntegratedTestReportSection.module.css';
import panelStyles from './TestResultAssignPanel.module.css';

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; details?: unknown; hint?: unknown };
    const parts = [e.message, e.details, e.hint].filter(
      (v): v is string => typeof v === 'string' && v.trim() !== '',
    );
    if (parts.length > 0) return parts.join(' — ');
  }
  return String(err);
}

function fallbackComment(studentName: string, score: number): string {
  return (
    `${studentName} 학생은 이번 시험에서 ${score.toFixed(1)}점을 기록하였습니다. ` +
    '전반적인 개념 이해도는 양호하나 응용 문제에서 보완이 필요합니다. ' +
    '앞으로 취약 단원 집중 훈련과 서술형 풀이 연습을 강화하겠습니다.'
  );
}

interface StudentReportState {
  reportData: IntegratedReportData | null;
  comment: string;
  reportHtml: string;
  generating: boolean;
  error: string;
  sending: boolean;
  sendMsg: string;
  sendErr: string;
}

function emptyState(): StudentReportState {
  return {
    reportData: null,
    comment: '',
    reportHtml: '',
    generating: false,
    error: '',
    sending: false,
    sendMsg: '',
    sendErr: '',
  };
}

interface Props {
  testId: number;
  testName: string;
}

/**
 * "학원시험 AI분석" 탭에서 오답 체크 저장 직후 나와야 하는 "보고서 작성"
 * 섹션 — 스트림릿 원본의 ⑤~⑦단계(AI 코멘트 일괄 생성 → 코멘트 확인·수정 →
 * 보고서 일괄 생성)를 재현. React 포팅 과정에서 "오답노트 생성" 자리만 먼저
 * 배치하고(d3246663, 2026-09-02) 이 섹션 자체가 통째로 누락되어 있던 것을
 * 복원(2026-09-23) — "통합보고서 작성" 탭(여러 시험을 묶는 것)과는 별개로,
 * 지금 막 오답 체크를 마친 "이 시험 하나"에 대해 시험 본 학생 전원의 보고서를
 * 그때그때 만들어 보내는 용도.
 *
 * 시험 1개 = buildIntegratedReportData(studentId, [testId])로 넘기면 "통합보고서"와
 * 완전히 같은 집계 로직(백분위·석차·단원별 분석)이 시험 1개 기준으로 그대로
 * 나오므로, 그 계산 로직/HTML 조판(webReportHtml.ts)을 새로 만들지 않고 재사용함.
 */
export function TestReportWritePanel({ testId, testName }: Props) {
  const [students, setStudents] = useState<TestResultStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [perStudent, setPerStudent] = useState<Map<string, StudentReportState>>(new Map());
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    fetchTestResultStudents(testId)
      .then((list) => {
        if (cancelled) return;
        setStudents(list);
        setPerStudent(new Map(list.map((s) => [s.studentId, emptyState()])));
      })
      .catch((err) => {
        if (!cancelled) setLoadError(describeError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [testId]);

  function patchState(studentId: string, patch: Partial<StudentReportState>) {
    setPerStudent((prev) => {
      const next = new Map(prev);
      next.set(studentId, { ...(next.get(studentId) ?? emptyState()), ...patch });
      return next;
    });
  }

  function getState(studentId: string): StudentReportState {
    return perStudent.get(studentId) ?? emptyState();
  }

  async function generateOne(s: TestResultStudent) {
    patchState(s.studentId, { generating: true, error: '' });
    try {
      const reportData = await buildIntegratedReportData(s.studentId, [testId]);
      let comment: string;
      try {
        comment = await generateParentComment(s.name, [], summarizeForAiComment(reportData));
      } catch {
        const score = reportData.tests[0]?.score ?? 0;
        comment = fallbackComment(s.name, score);
      }
      const reportHtml = buildWebReportHtml(reportData, comment);
      patchState(s.studentId, { reportData, comment, reportHtml, generating: false });
    } catch (err) {
      patchState(s.studentId, { generating: false, error: describeError(err) });
    }
  }

  async function handleGenerateAll() {
    setBatchRunning(true);
    for (let i = 0; i < students.length; i++) {
      setBatchProgress(`보고서 생성 중... (${i + 1}/${students.length})`);
      await generateOne(students[i]);
    }
    setBatchProgress('');
    setBatchRunning(false);
  }

  function rebuildHtml(s: TestResultStudent) {
    const state = getState(s.studentId);
    if (!state.reportData) return;
    const reportHtml = buildWebReportHtml(state.reportData, state.comment);
    patchState(s.studentId, { reportHtml });
  }

  function handleOpenInNewTab(state: StudentReportState) {
    if (!state.reportHtml) return;
    const newTab = window.open('', '_blank');
    if (!newTab) return;
    newTab.document.open();
    newTab.document.write(state.reportHtml);
    newTab.document.close();
  }

  function handleDownload(s: TestResultStudent, state: StudentReportState) {
    if (!state.reportHtml) return;
    const blob = new Blob([state.reportHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `보고서_${s.name}_${testName}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handlePrint(state: StudentReportState) {
    if (!state.reportHtml) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.open();
    printWindow.document.write(state.reportHtml);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
    };
  }

  async function handleSendToParent(s: TestResultStudent) {
    const state = getState(s.studentId);
    if (!state.reportHtml) return;
    patchState(s.studentId, { sending: true, sendErr: '', sendMsg: '' });
    try {
      const contact = await fetchStudentContact(s.studentId);
      const phone = contact?.parentPhone?.trim();
      if (!phone) {
        throw new Error('보호자 연락처가 없어 문자를 보낼 수 없습니다.');
      }
      const token = await createReportLink({
        html: state.reportHtml,
        studentName: s.name,
        studentId: s.studentId,
        testType: testName,
        testDate: state.reportData?.generatedAt.slice(0, 10) ?? '',
        testName,
      });
      const text = buildParentReportLinkText({ studentName: s.name, token });
      await sendBulkSms([{ name: s.name, phone }], text);
      await markReportSent(token);
      patchState(s.studentId, { sending: false, sendMsg: `${s.name} 학부모님께 리포트 링크 문자를 발송했습니다.` });
    } catch (err) {
      patchState(s.studentId, { sending: false, sendErr: describeError(err) });
    }
  }

  const generatedCount = students.filter((s) => getState(s.studentId).reportHtml).length;

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>📝 보고서 작성</h3>
      <p className={styles.caption}>
        이 시험(<strong>{testName}</strong>)을 본 학생들의 AI 코멘트와 학부모용 보고서를 그때그때 만들어
        보낼 수 있어요. 여러 시험을 묶어서 보는 "통합보고서 작성" 탭과는 별개로, 지금 방금 오답 체크를
        마친 이 시험 하나만 다룹니다.
      </p>

      {loading ? (
        <p className={styles.caption}>불러오는 중...</p>
      ) : loadError ? (
        <p className={styles.errorText}>{loadError}</p>
      ) : students.length === 0 ? (
        <div className={styles.infoBanner}>
          이 시험에 저장된 학생 오답 기록이 없습니다. 위에서 먼저 오답을 체크·저장해 주세요.
        </div>
      ) : (
        <>
          <button
            type="button"
            className={styles.generateButton}
            onClick={handleGenerateAll}
            disabled={batchRunning}
          >
            {batchRunning ? batchProgress : `🎨 전원 보고서 일괄 생성 (${students.length}명)`}
          </button>
          {generatedCount > 0 && (
            <p className={styles.successText}>{generatedCount}/{students.length}명 보고서 생성됨</p>
          )}

          <div className={panelStyles.studentList} style={{ marginTop: 14 }}>
            {students.map((s) => {
              const state = getState(s.studentId);
              return (
                <details key={s.studentId} className={panelStyles.studentDetails}>
                  <summary className={panelStyles.studentSummary}>
                    <span>{s.className} · {s.name}</span>
                    <span className={state.reportHtml ? panelStyles.statusSaved : panelStyles.statusUnsaved}>
                      {state.generating
                        ? '⏳ 생성 중...'
                        : state.reportHtml
                        ? '✅ 보고서 생성됨'
                        : '⬜ 미생성'}
                    </span>
                  </summary>
                  <div className={panelStyles.studentBody}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => generateOne(s)}
                      disabled={state.generating || batchRunning}
                    >
                      {state.reportHtml ? '🔄 다시 생성' : '✨ 이 학생 보고서 생성'}
                    </button>
                    {state.error && <p className={styles.errorText}>{state.error}</p>}

                    {state.reportData && (
                      <>
                        <textarea
                          className={styles.commentTextarea}
                          value={state.comment}
                          onChange={(e) => patchState(s.studentId, { comment: e.target.value })}
                          onBlur={() => rebuildHtml(s)}
                          placeholder="학부모님께 전하는 글"
                          rows={4}
                        />
                        <p className={panelStyles.previewText}>
                          점수 {state.reportData.tests[0]?.score.toFixed(1) ?? '-'}점 · 백분위{' '}
                          {state.reportData.tests[0]?.irt.percentile ?? '-'}% · {state.reportData.tests[0]?.irt.rank ?? '-'}
                          /{state.reportData.tests[0]?.irt.peerCount ?? '-'}등
                        </p>
                      </>
                    )}

                    {state.reportHtml && (
                      <div className={styles.reportPreviewActions} style={{ marginTop: 10, flexWrap: 'wrap' }}>
                        <button type="button" className={styles.secondaryButton} onClick={() => handleOpenInNewTab(state)}>
                          🔗 새 창에서 보기
                        </button>
                        <button type="button" className={styles.secondaryButton} onClick={() => handleDownload(s, state)}>
                          ⬇️ HTML 다운로드
                        </button>
                        <button type="button" className={styles.secondaryButton} onClick={() => handlePrint(state)}>
                          🖨️ 인쇄 / PDF로 저장
                        </button>
                        <button
                          type="button"
                          className={styles.generateButton}
                          onClick={() => handleSendToParent(s)}
                          disabled={state.sending}
                        >
                          {state.sending ? '발송 중...' : '📱 학부모에게 문자로 보내기'}
                        </button>
                      </div>
                    )}
                    {state.sendMsg && <p className={styles.successText}>{state.sendMsg}</p>}
                    {state.sendErr && <p className={styles.errorText}>{state.sendErr}</p>}
                  </div>
                </details>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
