import { useEffect, useState } from 'react';
import {
  fetchAcademyTestOptions,
  buildIntegratedReportData,
  summarizeForAiComment,
} from '../../lib/integratedReport';
import type { AcademyTestOption, IntegratedReportData, CategoryStat } from '../../lib/integratedReport';
import { buildWebReportHtml } from '../../lib/webReportHtml';
import { generateParentComment } from '../../lib/parentComment';
import { createReportLink, markReportSent, buildParentReportLinkText } from '../../lib/reportLinks';
import { fetchStudentContact } from '../../lib/students';
import { sendBulkSms } from '../../lib/smsSend';
import styles from './IntegratedTestReportSection.module.css';

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

function CategoryTable({ title, rows }: { title: string; rows: CategoryStat[] }) {
  if (rows.length === 0) return null;
  return (
    <div className={styles.subBlock}>
      <div className={styles.subBlockTitle}>{title}</div>
      <div className={styles.tableWrap}>
              <table className={styles.table}>
        <thead>
          <tr>
            <th>항목</th>
            <th>문항수</th>
            <th>정답</th>
            <th>오답</th>
            <th>정답률</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td>{r.total}</td>
              <td>{r.correct}</td>
              <td>{r.wrong}</td>
              <td className={r.accuracy < 60 ? styles.lowAccuracy : undefined}>{r.accuracy}%</td>
            </tr>
          ))}
        </tbody>
      </table>
            </div>
    </div>
  );
}

/**
 * "3단계: 여러 단원테스트 통합 집계 로직" — 기존 IntegratedReportSection(빈
 * 안내문 스텁)을 대체. 학생이 실제로 오답 체크까지 끝낸 학원TEST(단원테스트
 * 등) 중 여러 개를 체크박스로 골라서 하나로 합친 분석 결과를 계산해 보여줌.
 *
 * 지금은 데이터 계산 로직이 맞게 나오는지 확인하기 위한 "미리보기" 화면이고,
 * 실제 학부모용 A4 인쇄 스타일 보고서(Chart.js 그래프 포함)는 다음 단계(4단계)
 * 에서 이 데이터를 입력값으로 받아 별도로 만들 예정.
 *
 * 기본 체크 상태: test_type이 "단원테스트"인 것만 미리 체크해 둠(원래 기획한
 * "1~6단원 단원테스트 + 전범위테스트(있으면)" 범위와 맞추기 위함). 다른
 * 종류(예: 전범위를 "기타"로 등록한 시험)는 선생님이 필요하면 직접 체크하면 됨.
 */
export function IntegratedTestReportSection({
  studentId,
  parentComment,
}: {
  studentId: string;
  parentComment: string;
}) {
  const [options, setOptions] = useState<AcademyTestOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState('');
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());

  const [reportData, setReportData] = useState<IntegratedReportData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [reportHtml, setReportHtml] = useState('');
  const [reportComment, setReportComment] = useState('');
  const [commentGenerating, setCommentGenerating] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [sendingToParent, setSendingToParent] = useState(false);
  const [sendResultMessage, setSendResultMessage] = useState('');
  const [sendError, setSendError] = useState('');

  useEffect(() => {
    if (!studentId) return;
    let cancelled = false;
    setOptionsLoading(true);
    setOptionsError('');
    setReportData(null);
    setReportHtml('');
    setGenerateError('');
    fetchAcademyTestOptions(studentId)
      .then((data) => {
        if (cancelled) return;
        setOptions(data);
        setCheckedIds(new Set(data.filter((o) => o.testType === '단원테스트').map((o) => o.id)));
      })
      .catch((err) => {
        if (cancelled) return;
        setOptionsError(describeError(err));
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  function toggle(id: number) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleGenerate() {
    if (checkedIds.size === 0) return;
    setGenerating(true);
    setGenerateError('');
    setReportData(null);
    setReportHtml('');
    try {
      const data = await buildIntegratedReportData(studentId, Array.from(checkedIds));
      setReportData(data);
      setReportComment(parentComment); // 일단 기존 "학부모님께 전하는 글"을 초안으로 채워둠 — 아래 버튼으로 통합 데이터 기반으로 다시 쓸 수 있음
    } catch (err) {
      setGenerateError(describeError(err));
    } finally {
      setGenerating(false);
    }
  }

  async function handleGenerateComment() {
    if (!reportData) return;
    setCommentGenerating(true);
    setCommentError('');
    try {
      const summary = summarizeForAiComment(reportData);
      const draft = await generateParentComment(reportData.studentName, [], summary);
      setReportComment(draft);
    } catch (err) {
      setCommentError(describeError(err));
    } finally {
      setCommentGenerating(false);
    }
  }

  function handleBuildReport() {
    if (!reportData) return;
    const html = buildWebReportHtml(reportData, reportComment);
    setReportHtml(html);
  }

  function handleDownload() {
    if (!reportHtml || !reportData) return;
    const blob = new Blob([reportHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `통합보고서_${reportData.studentName}_${reportData.generatedAt.slice(0, 10)}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // 2026-09-07 추가: 보고서를 인쇄용 팝업이 아니라 그냥 새 탭에서 편하게
  // 볼 수 있게 하는 버튼. handlePrint()는 열자마자 인쇄 대화상자를 띄우는
  // 반면, 이 함수는 그냥 페이지로만 열어서 사용자가 여유롭게 보거나
  // 필요하면 그 탭에서 직접 인쇄/저장하게 둔다.
  function handleOpenInNewTab() {
    if (!reportHtml) return;
    const newTab = window.open('', '_blank');
    if (!newTab) return;
    newTab.document.open();
    newTab.document.write(reportHtml);
    newTab.document.close();
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

  /**
   * [2026-09-08] "학부모에게 문자로 보내기" — report_links(token/html_content)에
   * 보고서를 저장하고, 학부모 열람 페이지(ParentReport.tsx, /parent-report?token=)
   * 링크를 문자로 발송한다. 학생 인증 업로드 링크 발송(RecentAssignmentsPanel의
   * handleSendLink)과 같은 구조 — 다만 여기는 항상 보호자 번호로만 보낸다(성적은
   * 학생이 아니라 학부모에게 보여주는 정보라 학생 번호 대체 발송을 하지 않음).
   */
  async function handleSendToParent() {
    if (!reportHtml || !reportData) return;
    setSendingToParent(true);
    setSendError('');
    setSendResultMessage('');
    try {
      const contact = await fetchStudentContact(studentId);
      const phone = contact?.parentPhone?.trim();
      if (!phone) {
        throw new Error('보호자 연락처가 없어 문자를 보낼 수 없습니다.');
      }
      const token = await createReportLink({
        html: reportHtml,
        studentName: reportData.studentName,
        studentId,
        testType: '통합보고서',
        testDate: reportData.generatedAt.slice(0, 10),
        testName: `통합보고서(${reportData.tests.length}개 시험)`,
      });
      const text = buildParentReportLinkText({ studentName: reportData.studentName, token });
      await sendBulkSms([{ name: reportData.studentName, phone }], text);
      await markReportSent(token);
      setSendResultMessage(`${reportData.studentName} 학부모님께 리포트 링크 문자를 발송했습니다.`);
    } catch (err) {
      setSendError(describeError(err));
    } finally {
      setSendingToParent(false);
    }
  }

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>통합보고서 생성</h3>
      <p className={styles.caption}>
        '학원시험 AI분석' 탭에서 오답 체크까지 끝낸 학원TEST 중, 하나로 합쳐서 분석할 시험들을 골라 주세요
        (보통 이번 과정의 단원테스트 전체 + 전범위테스트가 있다면 포함).
      </p>

      {optionsLoading ? (
        <p className={styles.caption}>불러오는 중...</p>
      ) : optionsError ? (
        <p className={styles.errorText}>{optionsError}</p>
      ) : options.length === 0 ? (
        <div className={styles.infoBanner}>
          학원 TEST 결과가 없습니다. '학원시험 AI분석' 탭에서 오답을 저장한 뒤 다시 시도해 주세요.
        </div>
      ) : (
        <>
          <ul className={styles.checkList}>
            {options.map((o) => (
              <li key={o.id} className={styles.checkItem}>
                <label>
                  <input
                    type="checkbox"
                    checked={checkedIds.has(o.id)}
                    onChange={() => toggle(o.id)}
                  />
                  <span className={styles.checkLabel}>
                    {o.name} · {o.date} · {o.score.toFixed(1)}점
                    <span className={styles.checkMeta}> ({o.testType}, {o.totalQuestions}문항)</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <button
            type="button"
            className={styles.generateButton}
            onClick={handleGenerate}
            disabled={checkedIds.size === 0 || generating}
          >
            {generating ? '분석 중...' : `선택한 ${checkedIds.size}개 시험 통합 분석`}
          </button>
          {generateError && <p className={styles.errorText}>{generateError}</p>}
        </>
      )}

      {reportData && (
        <div className={styles.resultBlock}>
          <div className={styles.kpiRow}>
            <div className={styles.kpiTile}>
              <div className={styles.kpiLabel}>선택 시험 수</div>
              <div className={styles.kpiValue}>{reportData.tests.length}개</div>
            </div>
            <div className={styles.kpiTile}>
              <div className={styles.kpiLabel}>평균 점수</div>
              <div className={styles.kpiValue}>{reportData.averageScore}점</div>
            </div>
            <div className={styles.kpiTile}>
              <div className={styles.kpiLabel}>통합 정답률</div>
              <div className={styles.kpiValue}>{reportData.combinedAccuracy}%</div>
            </div>
            <div className={styles.kpiTile}>
              <div className={styles.kpiLabel}>전체 문항수</div>
              <div className={styles.kpiValue}>{reportData.combinedTotalQuestions}문항</div>
            </div>
          </div>

          <div className={styles.subBlock}>
            <div className={styles.subBlockTitle}>시험별 상세 (같은 반 기준 백분위·등급)</div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
              <thead>
                <tr>
                  <th>시험명</th>
                  <th>날짜</th>
                  <th>점수</th>
                  <th>백분위</th>
                  <th>석차</th>
                  <th>등급</th>
                </tr>
              </thead>
              <tbody>
                {reportData.tests.map((t) => (
                  <tr key={t.testId}>
                    <td>{t.testName}</td>
                    <td>{t.date}</td>
                    <td>{t.score.toFixed(1)}</td>
                    <td>{t.irt.percentile}%</td>
                    <td>{t.irt.rank}/{t.irt.peerCount}</td>
                    <td>{t.irt.grade}등급</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          <CategoryTable title="단원별 분석" rows={reportData.unitAnalysis} />
          <CategoryTable title="유형별 분석 (풀이유형)" rows={reportData.typeAnalysis} />
          <CategoryTable title="난이도별 분석" rows={reportData.difficultyAnalysis} />
          <CategoryTable title="인지영역별 분석" rows={reportData.cognitiveAnalysis} />

          <div className={styles.weakStrongRow}>
            <div className={styles.subBlock}>
              <div className={styles.subBlockTitle}>취약 단원 Top 3</div>
              {reportData.weakTopics.length === 0 ? (
                <p className={styles.caption}>문항 2개 이상인 단원이 부족해 계산할 수 없습니다.</p>
              ) : (
                <ul className={styles.plainList}>
                  {reportData.weakTopics.map((t) => (
                    <li key={t.label}>
                      {t.label} — 정답률 {t.accuracy}% ({t.correct}/{t.total})
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className={styles.subBlock}>
              <div className={styles.subBlockTitle}>강점 단원 Top 3</div>
              {reportData.strongTopics.length === 0 ? (
                <p className={styles.caption}>문항 2개 이상인 단원이 부족해 계산할 수 없습니다.</p>
              ) : (
                <ul className={styles.plainList}>
                  {reportData.strongTopics.map((t) => (
                    <li key={t.label}>
                      {t.label} — 정답률 {t.accuracy}% ({t.correct}/{t.total})
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className={styles.reportBuildRow}>
            <div className={styles.subBlockTitle}>학부모님께 전하는 글 (보고서에 포함)</div>
            <p className={styles.caption}>
              위에서 만든 통합 분석(단원별·난이도별·취약/강점 단원)을 바탕으로 AI가 구체적인 총평을 쓰게 할 수
              있어요. 그대로 써도 되고, 아래 칸에서 직접 고쳐도 됩니다.
            </p>
            <textarea
              className={styles.commentTextarea}
              value={reportComment}
              onChange={(e) => setReportComment(e.target.value)}
              placeholder="AI로 총평을 생성하거나 직접 입력하세요."
              rows={5}
            />
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleGenerateComment}
              disabled={commentGenerating}
            >
              {commentGenerating ? '작성 중...' : '🤖 통합 분석 기반으로 AI 총평 다시 쓰기'}
            </button>
            {commentError && <p className={styles.errorText}>{commentError}</p>}

            <div className={styles.reportBuildButtonRow}>
              <button type="button" className={styles.generateButton} onClick={handleBuildReport}>
                📄 A4 보고서 만들기 (미리보기)
              </button>
            </div>
          </div>

          {reportHtml && (
            <div className={styles.reportPreviewBlock}>
              <div className={styles.reportPreviewActions}>
                <button type="button" className={styles.secondaryButton} onClick={handleOpenInNewTab}>
                  🔗 새 창에서 보기
                </button>
                <button type="button" className={styles.secondaryButton} onClick={handleDownload}>
                  ⬇️ HTML 파일로 다운로드
                </button>
                <button type="button" className={styles.secondaryButton} onClick={handlePrint}>
                  🖨️ 인쇄 / PDF로 저장
                </button>
                <button
                  type="button"
                  className={styles.generateButton}
                  onClick={handleSendToParent}
                  disabled={sendingToParent}
                >
                  {sendingToParent ? '발송 중...' : '📱 학부모에게 문자로 보내기'}
                </button>
              </div>
              {sendResultMessage && <p className={styles.successText}>{sendResultMessage}</p>}
              {sendError && <p className={styles.errorText}>{sendError}</p>}
              <iframe
                title="통합보고서 미리보기"
                srcDoc={reportHtml}
                className={styles.reportIframe}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
