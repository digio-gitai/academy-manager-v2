import { useEffect, useMemo, useState } from 'react';
import { fetchStudentContact, fetchStudents } from '../../lib/students';
import { generateParentComment } from '../../lib/parentComment';
import { buildParentReportLinkText, createReportLink, markReportSent } from '../../lib/reportLinks';
import { sendBulkSms } from '../../lib/smsSend';
import {
  computeBundle,
  fetchBundleTests,
  fetchRetestsForTests,
  fetchStudentTestIds,
  loadRetestThreshold,
  renameTest,
  summarizeForAi,
  saveRetestThreshold,
  type RetestAttempt,
  type BundleResult,
  type BundleStudentRow,
  type BundleTest,
} from '../../lib/bundleAnalysis';
import { buildBundleReportHtml } from '../../lib/bundleReportHtml';
import type { StudentProfile } from '../../types/student';
import styles from './BundleAnalysisPanel.module.css';

const ALL = '전체';

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 성적 리포트 → "묶음 분석" 탭 (2026-10-10 신규).
 * ① 분석할 시험지 체크(이름 직접 수정 가능) → ② 대상 학년/비교 방식 →
 * ③ 학생별 집계 표 → 미리보기(집단 비교 보고서 HTML).
 * 개인 추이 모드 / AI 종합분석 / 문자 발송은 2차 업데이트에서 추가.
 */
export function BundleAnalysisPanel() {
  const [tests, setTests] = useState<BundleTest[]>([]);
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 시작 방식: 'test' = 시험지를 체크 → 본 학생들 자동 나열 / 'student' = 학생 1명 선택 → 그 학생이 본 시험 중 체크
  const [basis, setBasis] = useState<'test' | 'student'>('test');
  const [studentId, setStudentId] = useState('');
  const [studentTestIds, setStudentTestIds] = useState<Set<number>>(new Set());
  const [studentLoading, setStudentLoading] = useState(false);

  const [typeFilter, setTypeFilter] = useState(ALL);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [nameDrafts, setNameDrafts] = useState<Record<number, string>>({});
  const [renameMsg, setRenameMsg] = useState('');

  const [gradeFilter, setGradeFilter] = useState('');
  const [title, setTitle] = useState('내신대비 기출 분석');

  const [mode, setMode] = useState<'group' | 'trend'>('group');
  const [threshold, setThreshold] = useState<number>(loadRetestThreshold);
  const [retests, setRetests] = useState<RetestAttempt[]>([]);

  // 학생별 AI 총평 초안 — 학생을 오가도 유지되고, 일괄 발송 때 그대로 보고서에 들어간다.
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [showAvg, setShowAvg] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sentIds, setSentIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkLog, setBulkLog] = useState<{ name: string; ok: boolean; msg: string }[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [sendBusy, setSendBusy] = useState(false);
  const [sendMsg, setSendMsg] = useState('');
  const [sendError, setSendError] = useState('');

  const [result, setResult] = useState<BundleResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [computeError, setComputeError] = useState('');
  const [previewId, setPreviewId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchBundleTests(), fetchStudents()])
      .then(([t, s]) => {
        if (cancelled) return;
        setTests(t);
        setStudents(s);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '시험 목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const types = useMemo(() => [ALL, ...Array.from(new Set(tests.map((t) => t.testType)))], [tests]);
  const visibleTests = useMemo(() => {
    const base = basis === 'student' ? tests.filter((t) => studentTestIds.has(t.id)) : tests;
    return typeFilter === ALL ? base : base.filter((t) => t.testType === typeFilter);
  }, [tests, typeFilter, basis, studentTestIds]);
  const sortedStudents = useMemo(
    () =>
      [...students].sort(
        (a, b) => (a.className || '').localeCompare(b.className || '', 'ko') || a.name.localeCompare(b.name, 'ko'),
      ),
    [students],
  );
  const grades = useMemo(
    () => Array.from(new Set(students.map((s) => s.grade).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko')),
    [students],
  );

  const resetSelection = () => {
    setChecked(new Set());
    setResult(null);
    setPreviewId(null);
    setDrafts({});
    setSelected(new Set());
    setSentIds(new Set());
    setBulkLog([]);
  };

  const switchBasis = (next: 'test' | 'student') => {
    if (next === basis) return;
    setBasis(next);
    setStudentId('');
    setStudentTestIds(new Set());
    setTypeFilter(ALL);
    resetSelection();
  };

  /** 학생 기준: 학생을 고르면 그 학생이 본 시험만 목록에 올리고, 대상 학년은 학생 본인 학년으로 자동 설정한다. */
  const pickStudent = async (id: string) => {
    setStudentId(id);
    resetSelection();
    setStudentTestIds(new Set());
    if (!id) return;
    const profile = students.find((s) => s.id === id);
    if (profile?.grade) setGradeFilter(profile.grade);
    setStudentLoading(true);
    try {
      setStudentTestIds(await fetchStudentTestIds(Number(id)));
    } catch (e) {
      setComputeError(e instanceof Error ? e.message : '학생의 시험 목록을 불러오지 못했습니다.');
    } finally {
      setStudentLoading(false);
    }
  };

  const toggle = (id: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setResult(null);
    setPreviewId(null);
  };

  const selectVisible = (on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const t of visibleTests) {
        if (on) next.add(t.id);
        else next.delete(t.id);
      }
      return next;
    });
    setResult(null);
    setPreviewId(null);
  };

  const saveName = async (t: BundleTest) => {
    const draft = (nameDrafts[t.id] ?? t.name).trim();
    if (draft === t.name) return;
    try {
      await renameTest(t.id, draft);
      setTests((prev) => prev.map((x) => (x.id === t.id ? { ...x, name: draft } : x)));
      setNameDrafts((prev) => {
        const next = { ...prev };
        delete next[t.id];
        return next;
      });
      setRenameMsg(`이름을 "${draft}"(으)로 저장했습니다.`);
      setResult(null);
    } catch (e) {
      setRenameMsg(e instanceof Error ? e.message : '이름 저장에 실패했습니다.');
    }
  };

  const run = async () => {
    setComputing(true);
    setComputeError('');
    setPreviewId(null);
    setDrafts({});
    setSelected(new Set());
    setSentIds(new Set());
    setBulkLog([]);
    try {
      const picked = tests.filter((t) => checked.has(t.id));
      const [bundle, retestRows] = await Promise.all([
        computeBundle(picked, students, gradeFilter),
        mode === 'trend' ? fetchRetestsForTests(picked.map((t) => t.id)) : Promise.resolve([] as RetestAttempt[]),
      ]);
      setRetests(retestRows);
      // 학생 기준이면 그 학생 1명만 남기고(평균·상위 비율은 위에서 전체 응시자 기준으로 이미 계산됨) 바로 미리보기를 연다.
      const only =
        basis === 'student' && studentId
          ? bundle.students.filter((s) => String(s.studentId) === studentId)
          : bundle.students;
      setResult({ ...bundle, students: only });
      if (basis === 'student' && only[0]) setPreviewId(only[0].studentId);
    } catch (e) {
      setResult(null);
      setComputeError(e instanceof Error ? e.message : '집계에 실패했습니다.');
    } finally {
      setComputing(false);
    }
  };

  const previewStudent: BundleStudentRow | undefined = result?.students.find((s) => s.studentId === previewId);
  const aiText = previewId !== null ? (drafts[previewId] ?? '') : '';
  const setAiText = (v: string) => {
    if (previewId !== null) setDrafts((prev) => ({ ...prev, [previewId]: v }));
  };

  /** 학생 1명의 보고서 HTML — 미리보기/개별 발송/일괄 발송이 모두 이 함수를 쓴다. */
  const buildHtmlFor = (student: BundleStudentRow): string =>
    buildBundleReportHtml({
      student,
      tests: result?.tests ?? [],
      title,
      createdAt: todayStr(),
      mode,
      retests,
      threshold,
      showAvg,
      aiComment: (drafts[student.studentId] ?? '').trim() || undefined,
    });

  const previewHtml = useMemo(
    () => (previewStudent && result ? buildHtmlFor(previewStudent) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewStudent, result, title, mode, retests, threshold, showAvg, drafts],
  );

  const openPreview = (id: number) => {
    setPreviewId(id);
    setAiError('');
    setSendMsg('');
    setSendError('');
  };

  const draftAi = async () => {
    if (!previewStudent || !result) return;
    setAiBusy(true);
    setAiError('');
    try {
      const summary = summarizeForAi({ student: previewStudent, tests: result.tests, mode, retests, threshold });
      setAiText(await generateParentComment(previewStudent.name, [], summary));
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'AI 초안 생성에 실패했습니다.');
    } finally {
      setAiBusy(false);
    }
  };

  /** report_links에 저장 → 보호자 번호로 링크 문자 발송 (통합보고서 발송과 같은 흐름). 학생 1명 단위. */
  const sendReportTo = async (student: BundleStudentRow, html: string): Promise<void> => {
    const contact = await fetchStudentContact(String(student.studentId));
    const phone = contact?.parentPhone?.trim();
    if (!phone) throw new Error('보호자 연락처가 없습니다.');
    const token = await createReportLink({
      html,
      studentName: student.name,
      studentId: String(student.studentId),
      testType: '묶음 분석',
      testDate: todayStr(),
      testName: title,
    });
    const text = buildParentReportLinkText({ studentName: student.name, token, reportType: `${title} 보고서` });
    await sendBulkSms([{ name: student.name, phone, studentId: String(student.studentId) }], text, 'report');
    await markReportSent(token);
    setSentIds((prev) => new Set(prev).add(student.studentId));
  };

  /** 미리보기 화면의 개별 발송. */
  const sendToParent = async () => {
    if (!previewStudent || !previewHtml) return;
    if (!window.confirm(`${previewStudent.name} 학부모님께 보고서 링크 문자를 발송할까요?`)) return;
    setSendBusy(true);
    setSendError('');
    setSendMsg('');
    try {
      await sendReportTo(previewStudent, previewHtml);
      setSendMsg(`${previewStudent.name} 학부모님께 보고서 링크 문자를 발송했습니다.`);
    } catch (e) {
      setSendError(e instanceof Error ? e.message : '문자 발송에 실패했습니다.');
    } finally {
      setSendBusy(false);
    }
  };

  /** 표에서 체크한 학생들에게 일괄 발송 — 한 명씩 순서대로 보내고 결과를 학생별로 남긴다. */
  const sendSelected = async () => {
    if (!result) return;
    const targets = result.students.filter((s) => selected.has(s.studentId));
    if (targets.length === 0) return;
    const withAi = targets.filter((s) => (drafts[s.studentId] ?? '').trim()).length;
    const again = targets.filter((s) => sentIds.has(s.studentId)).length;
    const msg =
      `${targets.length}명 학부모님께 보고서 링크 문자를 발송합니다.\n` +
      `- AI 총평 포함 ${withAi}명 / 없음 ${targets.length - withAi}명\n` +
      (again > 0 ? `- 이미 발송한 학생 ${again}명이 포함되어 있습니다(다시 발송됨)\n` : '') +
      '진행할까요?';
    if (!window.confirm(msg)) return;
    setBulkBusy(true);
    setBulkLog([]);
    const log: { name: string; ok: boolean; msg: string }[] = [];
    for (const st of targets) {
      try {
        await sendReportTo(st, buildHtmlFor(st));
        log.push({ name: st.name, ok: true, msg: '발송 완료' });
      } catch (e) {
        log.push({ name: st.name, ok: false, msg: e instanceof Error ? e.message : '발송 실패' });
      }
      setBulkLog([...log]);
    }
    setBulkBusy(false);
  };

  const toggleSelected = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const download = () => {
    if (!previewStudent || !previewHtml) return;
    const blob = new Blob([previewHtml], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${previewStudent.name}_${title}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (loading) return <p className={styles.caption}>시험 목록을 불러오는 중…</p>;
  if (error) return <p className={styles.errorText}>{error}</p>;

  return (
    <div>
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>무엇을 기준으로 시작할까요?</h3>
        <div className={styles.modes}>
          <button type="button" className={styles.mode} data-on={basis === 'test'} onClick={() => switchBasis('test')}>
            <b>시험지 기준</b>
            <small>시험지를 체크하면 그 시험을 본 학생들이 자동으로 나열됩니다 (반 전체를 한 번에)</small>
          </button>
          <button type="button" className={styles.mode} data-on={basis === 'student'} onClick={() => switchBasis('student')}>
            <b>학생 기준</b>
            <small>학생 1명을 고르면 그 학생이 본 시험이 나열됩니다. 보낼 시험만 체크하세요</small>
          </button>
        </div>
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>
          <span className={styles.stepNo}>1</span>{basis === 'student' ? '학생 선택 · 보낼 시험 체크' : '분석할 시험지 체크'}
        </h3>
        <p className={styles.caption}>
          학원에 저장된 시험지 전체 목록입니다. 체크한 시험지가 분석 대상입니다. 이름 칸을 고친 뒤 다른 곳을 누르면 저장됩니다
          (점수는 그대로).
        </p>
        {basis === 'student' && (
          <div className={styles.toolbar} style={{ marginTop: 0, marginBottom: 10 }}>
            <label className={styles.meta}>
              학생{' '}
              <select className={styles.select} value={studentId} onChange={(e) => void pickStudent(e.target.value)}>
                <option value="">학생을 선택하세요</option>
                {sortedStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({[s.className, s.grade].filter(Boolean).join(' · ') || '반 미지정'})
                  </option>
                ))}
              </select>
            </label>
            {studentLoading && <span className={styles.meta}>시험 목록을 불러오는 중…</span>}
            {studentId && !studentLoading && <span className={styles.meta}>응시한 시험 {studentTestIds.size}개</span>}
          </div>
        )}
        <div className={styles.chips}>
          {types.map((t) => (
            <button key={t} type="button" className={styles.chip} data-on={t === typeFilter} onClick={() => setTypeFilter(t)}>
              {t}
            </button>
          ))}
        </div>
        {visibleTests.length === 0 ? (
          <p className={styles.caption}>
            {basis === 'student' && !studentId ? '학생을 먼저 선택해 주세요.' : '표시할 시험지가 없습니다.'}
          </p>
        ) : (
          <div className={styles.examList}>
            {visibleTests.map((t) => (
              <div key={t.id} className={styles.examRow}>
                <input type="checkbox" checked={checked.has(t.id)} onChange={() => toggle(t.id)} />
                <input
                  className={styles.nameInput}
                  value={nameDrafts[t.id] ?? t.name}
                  onChange={(e) => setNameDrafts((prev) => ({ ...prev, [t.id]: e.target.value }))}
                  onBlur={() => saveName(t)}
                />
                <span className={styles.meta}>
                  {t.testType} · {t.date} · 응시 {t.takers}명
                </span>
              </div>
            ))}
          </div>
        )}
        <div className={styles.toolbar}>
          <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSmall}`} onClick={() => selectVisible(true)}>
            보이는 시험지 모두 체크
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnGhost} ${styles.btnSmall}`} onClick={() => selectVisible(false)}>
            체크 해제
          </button>
          <span className={styles.meta}>선택 {checked.size}개</span>
          {renameMsg && <span className={styles.okText}>{renameMsg}</span>}
        </div>
      </div>

      <div className={styles.card}>
        <h3 className={styles.cardTitle}>
          <span className={styles.stepNo}>2</span>대상과 비교 방식
        </h3>
        <div className={styles.modes} style={{ marginBottom: 12 }}>
          <button
            type="button"
            className={styles.mode}
            data-on={mode === 'group'}
            onClick={() => {
              setMode('group');
              setResult(null);
              setPreviewId(null);
            }}
          >
            <b>집단 비교</b>
            <small>응시자 평균·상위 비율과 비교 (내신기출용)</small>
          </button>
          <button
            type="button"
            className={styles.mode}
            data-on={mode === 'trend'}
            onClick={() => {
              setMode('trend');
              setResult(null);
              setPreviewId(null);
            }}
          >
            <b>개인 추이</b>
            <small>본인 점수 흐름 + 재시험 현황만 (단원평가용)</small>
          </button>
        </div>
        <div className={styles.toolbar} style={{ marginTop: 0 }}>
          <label className={styles.meta}>
            대상 학년{' '}
            <select className={styles.select} value={gradeFilter} onChange={(e) => { setGradeFilter(e.target.value); setResult(null); }}>
              <option value="">전체 학년</option>
              {grades.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.meta}>
            보고서 제목{' '}
            <input className={styles.nameInput} style={{ width: 240 }} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          {mode === 'trend' && (
            <label className={styles.meta}>
              보강 기준{' '}
              <input
                className={styles.numInput}
                type="number"
                min={1}
                max={100}
                value={threshold}
                onChange={(e) => {
                  const v = Number(e.target.value) || 70;
                  setThreshold(v);
                  saveRetestThreshold(v);
                }}
              />{' '}
              점 미만
            </label>
          )}
          {mode === 'trend' && (
            <label className={styles.meta}>
              <input type="checkbox" checked={showAvg} onChange={(e) => setShowAvg(e.target.checked)} /> 응시자 평균 참고선 표시
            </label>
          )}
          <button type="button" className={styles.btn} disabled={checked.size === 0 || computing} onClick={run}>
            {computing ? '집계 중…' : '집계하기'}
          </button>
        </div>
        {computeError && <p className={styles.errorText}>{computeError}</p>}
      </div>

      {result && (
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>
            <span className={styles.stepNo}>3</span>{basis === 'student' ? '선택한 학생 결과' : '학생별 결과'}
          </h3>
          <p className={styles.caption}>
            체크한 시험지를 1회 이상 본 학생이 반과 관계없이 나열됩니다. 평균·상위 비율은 그 회차를 실제로 본 학생끼리만 계산합니다.
          </p>
          {result.students.length === 0 ? (
            <p className={styles.caption}>선택한 시험지에 응시 기록이 있는 학생이 없습니다.</p>
          ) : (
            <>
            {basis === 'test' && (
              <div className={styles.toolbar} style={{ marginTop: 0, marginBottom: 10 }}>
                <button
                  type="button"
                  className={styles.btn}
                  disabled={bulkBusy || selected.size === 0}
                  onClick={sendSelected}
                >
                  {bulkBusy ? '발송 중…' : `📱 선택 학생 문자 발송 (${selected.size}명)`}
                </button>
                <span className={styles.meta}>
                  AI 총평은 학생별로 「미리보기」에서 만들어 두면 발송 시 보고서에 함께 들어갑니다. 만들지 않은 학생은 AI 칸 없이 나갑니다.
                </span>
              </div>
            )}
            {bulkLog.length > 0 && (
              <ul style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 12.5 }}>
                {bulkLog.map((l) => (
                  <li key={l.name} className={l.ok ? styles.okText : styles.errorText}>
                    {l.name} — {l.msg}
                  </li>
                ))}
              </ul>
            )}
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        checked={selected.size > 0 && selected.size === result.students.length}
                        onChange={(e) =>
                          setSelected(e.target.checked ? new Set(result.students.map((x) => x.studentId)) : new Set())
                        }
                      />
                    </th>
                    <th>학생</th>
                    <th>반</th>
                    <th>학년</th>
                    <th>응시</th>
                    <th>평균 점수</th>
                    <th>평균 편차</th>
                    <th>평균 상위 비율</th>
                    <th>AI</th>
                    <th>발송</th>
                    <th>보고서</th>
                  </tr>
                </thead>
                <tbody>
                  {result.students.map((s) => (
                    <tr key={s.studentId}>
                      <td>
                        <input type="checkbox" checked={selected.has(s.studentId)} onChange={() => toggleSelected(s.studentId)} />
                      </td>
                      <td className={styles.left}>{s.name}</td>
                      <td>{s.className || '—'}</td>
                      <td>{s.grade || '—'}</td>
                      <td>
                        {s.taken}/{s.total}
                        {s.taken < 3 && <span className={styles.warn}> 횟수 적음</span>}
                      </td>
                      <td>{s.avgScore === null ? '–' : s.avgScore.toFixed(1)}</td>
                      <td>{s.avgDev === null ? '–' : `${s.avgDev >= 0 ? '+' : ''}${s.avgDev.toFixed(1)}`}</td>
                      <td>{s.avgTopPct === null ? '–' : `상위 ${s.avgTopPct.toFixed(0)}%`}</td>
                      <td>{(drafts[s.studentId] ?? '').trim() ? '✔' : '—'}</td>
                      <td>{sentIds.has(s.studentId) ? <span className={styles.okText}>발송됨</span> : '—'}</td>
                      <td>
                        <button
                          type="button"
                          className={`${styles.btn} ${styles.btnGhost} ${styles.btnSmall}`}
                          onClick={() => openPreview(s.studentId)}
                        >
                          미리보기
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </div>
      )}

      {previewStudent && (
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>{previewStudent.name} 보고서 미리보기</h3>
          <div className={styles.toolbar} style={{ marginTop: 0, marginBottom: 10 }}>
            <button type="button" className={styles.btn} onClick={download}>
              HTML 저장
            </button>
            <button type="button" className={styles.btn} disabled={sendBusy} onClick={sendToParent}>
              {sendBusy ? '발송 중…' : '📱 학부모 문자 발송'}
            </button>
            <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => setPreviewId(null)}>
              닫기
            </button>
          </div>
          {sendMsg && <p className={styles.okText}>{sendMsg}</p>}
          {sendError && <p className={styles.errorText}>{sendError}</p>}
          <div className={styles.card} style={{ marginBottom: 12, background: 'var(--color-surface)' }}>
            <h4 className={styles.cardTitle} style={{ fontSize: 13.5 }}>AI 종합 분석 (선택)</h4>
            <p className={styles.caption}>초안을 만든 뒤 직접 고칠 수 있습니다. 비워 두면 보고서에 AI 칸이 들어가지 않습니다.</p>
            <div className={styles.toolbar} style={{ marginTop: 0, marginBottom: 8 }}>
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} disabled={aiBusy} onClick={draftAi}>
                {aiBusy ? 'AI 작성 중…' : 'AI 초안 생성'}
              </button>
            </div>
            <textarea
              className={styles.nameInput}
              style={{ width: '100%', height: 110, padding: 8, boxSizing: 'border-box' }}
              value={aiText}
              onChange={(e) => setAiText(e.target.value)}
              placeholder="AI 초안이 여기에 나타납니다."
            />
            {aiError && <p className={styles.errorText}>{aiError}</p>}
          </div>
          <iframe className={styles.preview} title="묶음 분석 보고서" srcDoc={previewHtml} />
        </div>
      )}
    </div>
  );
}
