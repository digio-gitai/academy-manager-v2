import { useEffect, useState } from 'react';
import { fetchTestResultStudents } from '../../lib/testResults';
import type { TestResultStudent } from '../../lib/testResults';
import {
  fetchTestMeta,
  fetchTestQuestionDetails,
  fetchTestAllScores,
  fetchStudentReportProfile,
  fetchStudentResultRecord,
  fetchStudentScoreHistory,
  fetchStudentAttendanceSummary,
  fetchStudentHomeworkPerfStats,
  fetchStudentMonthTopicStats,
  prevYearMonth,
  reportModeFor,
  reportMonthPeriod,
} from '../../lib/academyTestReportData';
import type { TestMeta, ReportMode, QuestionDetail } from '../../lib/academyTestReportData';
import {
  buildAcademyTestReportHtml,
  isSingleTopicTest,
  distinctQuestionMethods,
  wrongDetailsForAi,
} from '../../lib/academyTestReportHtml';
import type { AttendanceStatsInput, HomeworkPerfStatsInput } from '../../lib/academyTestReportHtml';
import {
  generateTeacherCommentDraft,
  generateWrongQuestionComments,
  clusterQuestionMethods,
} from '../../lib/claudeReportAi';
import { createReportLink, markReportSent, buildParentReportLinkText } from '../../lib/reportLinks';
import { sendBulkSms } from '../../lib/smsSend';
import styles from './IntegratedTestReportSection.module.css';
import panelStyles from './TestResultAssignPanel.module.css';
import own from './TestReportWritePanel.module.css';

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

/** 동시에 limit개씩 처리 — 스트림릿 ThreadPoolExecutor(max_workers=5)와 같은 목적(속도). */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

const MODE_LABEL: Record<ReportMode, string> = {
  lite: '라이트(간단)',
  standard: '표준',
  premium: '프리미엄(월간 누적)',
};
const MODE_CHOICES = ['자동', '라이트(간단)', '표준', '프리미엄(월간 누적)'] as const;
type ModeChoice = (typeof MODE_CHOICES)[number];
const MODE_BY_CHOICE: Partial<Record<ModeChoice, ReportMode>> = {
  '라이트(간단)': 'lite',
  표준: 'standard',
  '프리미엄(월간 누적)': 'premium',
};

const SMS_TYPE_BY_CATEGORY: Record<string, string> = {
  일일테스트: '일일 성적표',
  주간테스트: '주간 성적표',
  월간테스트: '월간 성적표',
  단원테스트: '단원 성적표',
};
const SMS_TYPES = ['일일 성적표', '주간 성적표', '월간 성적표', '단원 성적표', '성적표'];

const EMPTY_COMMENT = '선생님 코멘트를 입력해 주세요.';

interface GeneratedReport {
  studentId: string;
  name: string;
  fname: string;
  html: string;
  parentPhone: string;
}

interface Props {
  testId: number;
  /** 오답 저장이 끝날 때마다 바뀌는 값 — 대상 학생 목록을 다시 불러오는 신호. */
  refreshKey: number;
}

/**
 * "학원시험 AI분석" 탭 — 오답 체크 저장 뒤에 나오는 "그때그때 시험 본 것"의
 * 학부모 보고서 작성 섹션. 스트림릿 app.py의 ⑤ AI 코멘트 일괄 생성 → ⑥ 학생별
 * 코멘트 확인·수정 → ⑦ 보고서 일괄 생성(포함 항목 체크박스 5개 + 보고서 형식)
 * → 다운로드 → 학부모 문자 일괄 발송 흐름을 그대로 재현. 보고서 양식은
 * claude_report.py의 generate_parent_report_html()을 이식한 academyTestReportHtml.ts
 * (블루+핑크 A4)이며, "통합보고서 작성" 탭의 양식과는 별개.
 */
export function TestReportWritePanel({ testId, refreshKey }: Props) {
  const [meta, setMeta] = useState<TestMeta | null>(null);
  const [students, setStudents] = useState<TestResultStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [comments, setComments] = useState<Record<string, string>>({});
  const [commentRunning, setCommentRunning] = useState(false);
  const [commentProgress, setCommentProgress] = useState('');
  const [commentMessages, setCommentMessages] = useState<string[]>([]);
  const [commentDone, setCommentDone] = useState('');

  const [showAvg, setShowAvg] = useState(true);
  const [showRank, setShowRank] = useState(true);
  const [showChart, setShowChart] = useState(true);
  const [showAttendance, setShowAttendance] = useState(true);
  const [showHwPerf, setShowHwPerf] = useState(true);
  const [modeChoice, setModeChoice] = useState<ModeChoice>('자동');

  const [reportRunning, setReportRunning] = useState(false);
  const [reportProgress, setReportProgress] = useState('');
  const [reportErrors, setReportErrors] = useState<string[]>([]);
  const [generated, setGenerated] = useState<GeneratedReport[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  // 학생별 확인 후 발송: 미리보기를 연 학생만 체크할 수 있고, 체크한 학생만 발송.
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [sendIds, setSendIds] = useState<Set<string>>(new Set());

  const [smsType, setSmsType] = useState('성적표');
  const [smsRunning, setSmsRunning] = useState(false);
  const [smsProgress, setSmsProgress] = useState('');
  const [smsResult, setSmsResult] = useState<{ ok: number; total: number; fails: string[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    Promise.all([fetchTestMeta(testId), fetchTestResultStudents(testId)])
      .then(([m, list]) => {
        if (cancelled) return;
        setMeta(m);
        setStudents(list);
        setSmsType(SMS_TYPE_BY_CATEGORY[m.testType] ?? '성적표');
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
  }, [testId, refreshKey]);

  const autoMode: ReportMode = reportModeFor(meta?.testType ?? '');
  const reportMode: ReportMode = MODE_BY_CHOICE[modeChoice] ?? autoMode;

  async function handleGenerateComments() {
    if (!meta) return;
    setCommentRunning(true);
    setCommentMessages([]);
    setCommentDone('');
    const warnings: string[] = [];
    try {
      const allScores = await fetchTestAllScores(testId);
      const classAvg = allScores.length ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 10) / 10 : null;
      let done = 0;
      setCommentProgress(`AI 코멘트 생성 중... (0/${students.length}명)`);
      await runPool(students, 5, async (s) => {
        try {
          const [history, record] = await Promise.all([
            fetchStudentScoreHistory(s.studentId),
            fetchStudentResultRecord(s.studentId, testId),
          ]);
          if (!record) return;
          const draft = await generateTeacherCommentDraft({
            studentName: s.name,
            score: record.score,
            classAvg,
            rank: allScores.length ? allScores.filter((sc) => sc > record.score).length + 1 : null,
            totalStudents: allScores.length || null,
            wrongNumbers: record.wrongNumbers,
            totalQuestions: meta.totalQuestions || 20,
            historyScores: history.map((h) => h.score),
            testName: meta.testName,
          });
          setComments((prev) => ({ ...prev, [s.studentId]: draft }));
        } catch (err) {
          setComments((prev) => ({ ...prev, [s.studentId]: '' }));
          warnings.push(`${s.name} 코멘트 생성 실패: ${describeError(err)}`);
        } finally {
          done += 1;
          setCommentProgress(`AI 코멘트 생성 중... (${done}/${students.length}명)`);
        }
      });
      setCommentDone(`✅ ${students.length}명 AI 코멘트 생성 완료! 아래에서 확인·수정 후 보고서를 생성하세요.`);
    } catch (err) {
      warnings.push(describeError(err));
    } finally {
      setCommentMessages(warnings);
      setCommentProgress('');
      setCommentRunning(false);
    }
  }

  async function handleGenerateReports() {
    if (!meta) return;
    setReportRunning(true);
    setReportErrors([]);
    setGenerated([]);
    setPreviewId(null);
    setReviewedIds(new Set());
    setSendIds(new Set());
    setSmsResult(null);
    const errors: string[] = [];
    const results: GeneratedReport[] = [];
    try {
      const [allScores, questionDetails] = await Promise.all([
        fetchTestAllScores(testId),
        fetchTestQuestionDetails(testId),
      ]);
      const details: QuestionDetail[] | null = questionDetails.length > 0 ? questionDetails : null;

      // 단원 1개짜리 시험의 풀이유형 AI 묶기는 시험 공통이라 1번만 호출(학생마다 결과가 달라지지 않게).
      let methodMapping: Record<string, string> | null = null;
      if (reportMode !== 'lite' && details && isSingleTopicTest(details)) {
        methodMapping = await clusterQuestionMethods(distinctQuestionMethods(details));
      }

      let done = 0;
      setReportProgress(`보고서 생성 중... (0/${students.length}명)`);
      await runPool(students, 5, async (s) => {
        try {
          const [profile, record, history] = await Promise.all([
            fetchStudentReportProfile(s.studentId),
            fetchStudentResultRecord(s.studentId, testId),
            fetchStudentScoreHistory(s.studentId),
          ]);
          if (!record) {
            errors.push(`${s.name} — DB 기록 없음, 건너뜁니다.`);
            return;
          }

          let attendanceStats: AttendanceStatsInput | null = null;
          let homeworkPerfStats: HomeworkPerfStatsInput | null = null;
          if (showAttendance || showHwPerf) {
            const period = reportMonthPeriod(meta.date);
            if (showAttendance) {
              const cur = await fetchStudentAttendanceSummary(s.studentId, period.from, period.to);
              attendanceStats = { month: period.month, ...cur };
            }
            if (showHwPerf) {
              const cur = await fetchStudentHomeworkPerfStats(s.studentId, period.from, period.to);
              homeworkPerfStats = { month: period.month, ...cur };
            }
          }

          let monthlyTopicStats = null;
          let prevMonthAvg: number | null = null;
          if (reportMode === 'premium') {
            const ym = meta.date.slice(0, 7);
            monthlyTopicStats = await fetchStudentMonthTopicStats(s.studentId, ym);
            const pm = prevYearMonth(ym);
            const prevScores = history.filter((h) => h.date.slice(0, 7) === pm).map((h) => h.score);
            prevMonthAvg = prevScores.length
              ? Math.round((prevScores.reduce((a, b) => a + b, 0) / prevScores.length) * 10) / 10
              : null;
          }

          const wrongComments =
            reportMode === 'lite'
              ? {}
              : await generateWrongQuestionComments(s.name, wrongDetailsForAi(record.wrongNumbers, details));

          const comment = (comments[s.studentId] ?? '').trim() || EMPTY_COMMENT;
          const html = buildAcademyTestReportHtml({
            studentName: s.name,
            school: profile.school || '—',
            grade: profile.grade || '—',
            className: s.className,
            testName: meta.testName,
            testDate: meta.date,
            score: record.score,
            totalQuestions: meta.totalQuestions || 20,
            wrongNumbers: record.wrongNumbers,
            allScores,
            history: history.map((h) => ({ testName: h.testName, date: h.date, score: h.score })),
            teacherComment: comment,
            showClassAvg: showAvg,
            showClassRank: showRank,
            showHistoryChart: showChart,
            testCategory: meta.testType,
            reportMode,
            monthlyTopicStats,
            prevMonthAvg,
            questionDetails: details,
            showAttendance,
            attendanceStats,
            showHomeworkPerf: showHwPerf,
            homeworkPerfStats,
            wrongComments,
            methodMapping,
          });
          const fname = `${s.name}_${meta.date}_${Array.from(meta.testName).slice(0, 15).join('')}.html`
            .replace(/ /g, '_')
            .replace(/\//g, '-');
          results.push({ studentId: s.studentId, name: s.name, fname, html, parentPhone: profile.parentPhone.trim() });
        } catch (err) {
          errors.push(`${s.name} 보고서 생성 실패: ${describeError(err)}`);
        } finally {
          done += 1;
          setReportProgress(`보고서 생성 중... (${done}/${students.length}명)`);
        }
      });
      const order = new Map(students.map((s, i) => [s.studentId, i]));
      results.sort((a, b) => (order.get(a.studentId) ?? 999) - (order.get(b.studentId) ?? 999));
      setGenerated(results);
    } catch (err) {
      errors.push(describeError(err));
    } finally {
      setReportErrors(errors);
      setReportProgress('');
      setReportRunning(false);
    }
  }

  function openInNewTab(html: string) {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function download(rep: GeneratedReport) {
    const blob = new Blob([rep.html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = rep.fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function print(html: string) {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.onload = () => {
      w.focus();
      w.print();
    };
  }

  function togglePreview(id: string) {
    setPreviewId((cur) => (cur === id ? null : id));
    setReviewedIds((prev) => new Set(prev).add(id));
  }

  function toggleSend(id: string) {
    setSendIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSendSms() {
    if (!meta) return;
    const targets = generated.filter((r) => r.parentPhone && sendIds.has(r.studentId));
    if (targets.length === 0) return;
    const names = targets.map((r) => r.name).join(', ');
    if (!window.confirm(`${targets.length}명(${names}) 학부모님께 "${smsType}" 문자를 보냅니다. 계속할까요?`)) return;
    const sentIds: string[] = [];
    setSmsRunning(true);
    setSmsResult(null);
    let ok = 0;
    const fails: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      const rep = targets[i];
      setSmsProgress(`문자 발송 중... (${i + 1}/${targets.length}명)`);
      try {
        const token = await createReportLink({
          html: rep.html,
          studentName: rep.name,
          studentId: rep.studentId,
          testType: meta.testType,
          testDate: meta.date,
          testName: meta.testName,
        });
        const text = buildParentReportLinkText({ studentName: rep.name, token, reportType: smsType });
        const result = await sendBulkSms(
          [{ name: rep.name, phone: rep.parentPhone, studentId: rep.studentId }],
          text,
          'report',
        );
        if (result.succeeded > 0) {
          ok += 1;
          sentIds.push(rep.studentId);
          markReportSent(token).catch(() => {});
        } else {
          fails.push(`${rep.name}: ${result.skipped[0]?.reason ?? '발송 실패'}`);
        }
      } catch (err) {
        fails.push(`${rep.name}: ${describeError(err)}`);
      }
    }
    setSmsProgress('');
    setSmsRunning(false);
    setSmsResult({ ok, total: targets.length, fails });
    setSendIds((prev) => {
      const next = new Set(prev);
      for (const id of sentIds) next.delete(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className={styles.card}>
        <p className={styles.caption}>보고서 작성 정보를 불러오는 중...</p>
      </div>
    );
  }
  if (loadError || !meta) {
    return (
      <div className={styles.card}>
        <p className={styles.errorText}>{loadError || '시험 정보를 불러오지 못했습니다.'}</p>
      </div>
    );
  }
  if (students.length === 0) {
    return (
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>📝 보고서 작성</h3>
        <div className={styles.infoBanner}>
          이 시험에 저장된 학생 오답 기록이 없습니다. 위에서 오답을 체크한 뒤 "전원 오답 일괄 저장"을 눌러 주세요.
        </div>
      </div>
    );
  }

  const noPhoneCount = generated.filter((r) => !r.parentPhone).length;
  const sendCount = generated.filter((r) => r.parentPhone && sendIds.has(r.studentId)).length;
  const smsOptions = [smsType, ...SMS_TYPES.filter((o) => o !== smsType)];
  const previewReport = generated.find((r) => r.studentId === previewId) ?? null;

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>📝 보고서 작성</h3>
      <p className={styles.caption}>
        이 시험(<strong>{meta.testName}</strong>)을 본 학생들의 학부모 보고서를 만듭니다. 여러 시험을 묶는 "통합보고서
        작성" 탭과는 별개의 양식입니다.
      </p>

      {/* ⑤ AI 코멘트 일괄 생성 */}
      <div className={own.stepBlock}>
        <div className={own.stepTitle}>⑤ AI 코멘트 일괄 생성 — {students.length}명</div>
        <button
          type="button"
          className={`${styles.secondaryButton} ${own.fullButton}`}
          onClick={handleGenerateComments}
          disabled={commentRunning || reportRunning}
        >
          {commentRunning ? commentProgress : '✨ 전원 AI 코멘트 생성'}
        </button>
        {commentDone && <p className={styles.successText}>{commentDone}</p>}
        {commentMessages.map((m) => (
          <p key={m} className={own.warnText}>
            {m}
          </p>
        ))}
      </div>

      {/* ⑥ 학생별 코멘트 확인·수정 */}
      <div className={own.stepBlock}>
        <div className={own.stepTitle}>⑥ 학생별 코멘트 확인 · 수정</div>
        <div className={panelStyles.studentList}>
          {students.map((s) => (
            <details key={s.studentId} className={panelStyles.studentDetails}>
              <summary className={panelStyles.studentSummary}>
                <span>
                  💬 {s.className} · {s.name}
                </span>
                <span className={comments[s.studentId]?.trim() ? panelStyles.statusSaved : panelStyles.statusUnsaved}>
                  {comments[s.studentId]?.trim() ? '작성됨' : '비어 있음'}
                </span>
              </summary>
              <div className={panelStyles.studentBody}>
                <textarea
                  className={styles.commentTextarea}
                  rows={5}
                  value={comments[s.studentId] ?? ''}
                  onChange={(e) => setComments((prev) => ({ ...prev, [s.studentId]: e.target.value }))}
                  placeholder="AI 코멘트 생성 후 여기에 표시됩니다. 직접 입력도 가능합니다."
                />
              </div>
            </details>
          ))}
        </div>
      </div>

      {/* ⑦ 보고서 일괄 생성 */}
      <div className={own.stepBlock}>
        <div className={own.stepTitle}>⑦ 보고서 일괄 생성</div>
        <div className={own.optionGrid}>
          <label className={own.optionLabel}>
            <input type="checkbox" checked={showAvg} onChange={(e) => setShowAvg(e.target.checked)} />반 평균 포함
          </label>
          <label className={own.optionLabel}>
            <input type="checkbox" checked={showRank} onChange={(e) => setShowRank(e.target.checked)} />반 석차 포함
          </label>
          <label className={own.optionLabel}>
            <input type="checkbox" checked={showChart} onChange={(e) => setShowChart(e.target.checked)} />누적 그래프
            포함
          </label>
          <label className={own.optionLabel}>
            <input type="checkbox" checked={showAttendance} onChange={(e) => setShowAttendance(e.target.checked)} />
            출석 현황 포함
          </label>
          <label className={own.optionLabel}>
            <input type="checkbox" checked={showHwPerf} onChange={(e) => setShowHwPerf(e.target.checked)} />
            과제 수행도 포함
          </label>
        </div>

        <div className={own.selectRow}>
          <span className={own.selectLabel}>보고서 형식</span>
          <select
            className={own.select}
            value={modeChoice}
            onChange={(e) => setModeChoice(e.target.value as ModeChoice)}
            title={`자동: 이 시험은 '${meta.testType}' → ${MODE_LABEL[autoMode]} 보고서로 생성됩니다.`}
          >
            {MODE_CHOICES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <p className={styles.caption}>
          시험 유형: <strong>{meta.testType}</strong> → 전원 <strong>{MODE_LABEL[reportMode]}</strong> 보고서로
          생성됩니다.
        </p>

        <button
          type="button"
          className={`${styles.generateButton} ${own.fullButton}`}
          onClick={handleGenerateReports}
          disabled={reportRunning || commentRunning}
        >
          {reportRunning ? reportProgress : '🎨 전원 보고서 일괄 생성'}
        </button>
        {reportErrors.map((m) => (
          <p key={m} className={styles.errorText}>
            {m}
          </p>
        ))}
        {!reportRunning && generated.length > 0 && (
          <p className={styles.successText}>✅ {generated.length}명 보고서 생성 완료!</p>
        )}
      </div>

      {generated.length > 0 && (
        <>
          <div className={own.stepBlock}>
            <div className={own.stepTitle}>📥 보고서 다운로드</div>
            <div className={own.reportList}>
              {generated.map((rep) => (
                <div key={rep.studentId} className={own.reportRow}>
                  <span>{rep.name}</span>
                  <div className={own.reportRowActions}>
                    <button type="button" className={own.smallButton} onClick={() => togglePreview(rep.studentId)}>
                      {previewId === rep.studentId ? '미리보기 닫기' : '👁️ 미리보기'}
                    </button>
                    <button type="button" className={own.smallButton} onClick={() => openInNewTab(rep.html)}>
                      🔗 새 창
                    </button>
                    <button type="button" className={own.smallButton} onClick={() => download(rep)}>
                      ⬇️ 다운로드
                    </button>
                    <button type="button" className={own.smallButton} onClick={() => print(rep.html)}>
                      🖨️ 인쇄/PDF
                    </button>
                    <label
                      className={own.sendCheck}
                      title={
                        !reviewedIds.has(rep.studentId)
                          ? '미리보기로 먼저 확인해 주세요'
                          : !rep.parentPhone
                          ? '보호자 연락처가 없습니다'
                          : ''
                      }
                    >
                      <input
                        type="checkbox"
                        checked={sendIds.has(rep.studentId)}
                        disabled={!reviewedIds.has(rep.studentId) || !rep.parentPhone || smsRunning}
                        onChange={() => toggleSend(rep.studentId)}
                      />
                      {rep.parentPhone ? '확인 · 발송' : '연락처 없음'}
                    </label>
                  </div>
                </div>
              ))}
            </div>
            {previewReport && (
              <iframe title={`${previewReport.name} 보고서 미리보기`} srcDoc={previewReport.html} className={styles.reportIframe} />
            )}
          </div>

          <div className={own.stepBlock}>
            <div className={own.stepTitle}>📱 학부모에게 문자 발송</div>
            <p className={styles.caption}>
              위 목록에서 학생마다 👁️ 미리보기로 확인한 뒤 "확인 · 발송"에 체크한 학생에게만 문자가 나갑니다.
            </p>
            {noPhoneCount > 0 && (
              <p className={own.warnText}>
                연락처가 등록되지 않은 학생이 {noPhoneCount}명 있습니다. 해당 학생은 발송에서 제외됩니다. (학생 명부에서
                연락처를 등록하세요)
              </p>
            )}
            <div className={own.selectRow}>
              <span className={own.selectLabel}>보고서 종류 (문자 문구에 표시됩니다 — 시험 유형에 맞춰 자동 선택됨)</span>
              <select className={own.select} value={smsType} onChange={(e) => setSmsType(e.target.value)}>
                {smsOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className={`${styles.generateButton} ${own.fullButton}`}
              onClick={handleSendSms}
              disabled={smsRunning || sendCount === 0}
            >
              {smsRunning ? smsProgress : `📤 확인한 ${sendCount}명 학부모에게 문자 발송`}
            </button>
            {smsResult && (
              <>
                <p className={styles.successText}>
                  ✅ 문자 발송 완료 — 성공 {smsResult.ok}명 / 대상 {smsResult.total}명
                </p>
                {smsResult.fails.map((m) => (
                  <p key={m} className={styles.errorText}>
                    {m}
                  </p>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
