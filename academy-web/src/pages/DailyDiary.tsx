import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchClasses } from '../lib/classManagement';
import { fetchAttendanceForSession } from '../lib/attendance';
import { fetchHomeworkPerformanceForSession, fetchTodayHomeworkSummary } from '../lib/homework';
import { sendBulkSms, TEACHER_NOTIFY_PHONE } from '../lib/smsSend';
import {
  buildDiarySmsText,
  diaryErrorMessage,
  fetchAcademyName,
  fetchDiary,
  fetchLastCourse,
  fetchLastStudentCourses,
  generateDailyComment,
  genDiaryToken,
  markDiarySent,
  resolveField,
  saveAcademyName,
  saveDiary,
  type DiaryCommon,
  type DiaryDoc,
  type DiaryEntry,
} from '../lib/dailyDiary';
import type { ClassInfo } from '../types/classManagement';
import type { AttendanceStatus } from '../types/attendance';
import styles from './DailyDiary.module.css';

const MOOD_TAGS = ['집중 좋음', '오답 많음', '질문 적극적', '숙제 미흡', '계산 실수', '태도 좋음', '복습 필요'];
const STATUS_LABEL: Record<AttendanceStatus, string> = { present: '출석', late: '지각', absent: '결석', cancelled: '휴강' };

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * 데일리 Diary 작성 — 수업 후 학부모에게 "문자(진도 한 줄 + 링크) → 링크 페이지(Diary 전체)"를 보낸다.
 * 입력은 자동저장(입력 후 약 1초). 결석 학생도 같은 내용으로 발송하고 출석 칸만 '결석'으로 표시된다.
 */
export function DailyDiary() {
  const { session } = useAuth();
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [doc, setDoc] = useState<DiaryDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [view, setView] = useState<'list' | 'card' | 'table'>('list');
  const [tags, setTags] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [entryTags, setEntryTags] = useState<Record<string, string[]>>({});
  const [aiBusy, setAiBusy] = useState<string>('');
  const [sending, setSending] = useState(false);
  const [sendMessage, setSendMessage] = useState('');
  const [resendSent, setResendSent] = useState(false);
  const dirtyRef = useRef(false);
  const lastStudentRef = useRef<Record<string, { course: string; textbook: string }>>({});

  const cls = classes.find((c) => c.id === classId);

  useEffect(() => {
    fetchClasses()
      .then((list) => {
        setClasses(list);
        setClassId((prev) => prev || list[0]?.id || '');
        if (list.length === 0) setLoading(false);
      })
      .catch((err) => {
        setLoadError(diaryErrorMessage(err, '반 목록을 불러오지 못했습니다.'));
        setLoading(false);
      });
  }, []);

  // 반/날짜가 바뀔 때: 저장된 Diary를 불러오고, 출석·과제수행도는 항상 최신 값으로 갱신한다.
  useEffect(() => {
    if (!cls || !date) return;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setSendMessage('');
    setTags([]);
    dirtyRef.current = false;
    (async () => {
      try {
        const [saved, att, perf, hw, last, academyName, lastStudent] = await Promise.all([
          fetchDiary(cls.id, date),
          fetchAttendanceForSession(cls.id, date),
          fetchHomeworkPerformanceForSession(cls.id, date),
          fetchTodayHomeworkSummary(cls.id, date),
          fetchLastCourse(cls.id, date),
          fetchAcademyName(),
          fetchLastStudentCourses(cls.id, date),
        ]);
        if (cancelled) return;
        lastStudentRef.current = lastStudent;
        const individualMode = saved?.common.individualMode ?? last.individualMode;
        const hwToday = hw && hw.assignedDate === date ? hw : null;
        const indivHw = new Map((hwToday?.individual ?? []).map((i) => [i.studentName, i.summary]));
        const attMap = new Map(att.map((a) => [a.studentId, a.status]));
        const savedByStudent = new Map((saved?.entries ?? []).map((e) => [e.studentId, e]));
        const entries: DiaryEntry[] = cls.students.map((s) => {
          const old = savedByStudent.get(s.id);
          const attendance = attMap.get(s.id) ?? 'present';
          return {
            studentId: s.id,
            studentName: s.name,
            schoolGrade: [s.school, s.grade].filter(Boolean).join(' '),
            token: old?.token ?? genDiaryToken(),
            included: old?.included ?? true,
            attendance,
            hwPerformance: attendance === 'absent' || attendance === 'cancelled' ? '' : (perf[s.id] ?? ''),
            course: old ? old.course : individualMode ? (lastStudent[s.id]?.course ?? null) : null,
            textbook: old ? old.textbook : individualMode ? (lastStudent[s.id]?.textbook ?? null) : null,
            progress: old?.progress ?? null,
            homework: old ? old.homework : (indivHw.get(s.name) ?? null),
            message: old?.message ?? null,
            sentAt: old?.sentAt ?? null,
          };
        });
        const teacherName = cls.teacherName && !cls.teacherName.includes('미지정') ? cls.teacherName : (session?.name ?? '');
        const common: DiaryCommon = saved?.common ?? {
          individualMode,
          academyName,
          teacherName,
          course: last.course,
          textbook: last.textbook,
          progress: '',
          homework: hwToday ? hwToday.summary : '',
          message: '',
        };
        setDoc({ classId: cls.id, date, common, entries });
        setSaveState('idle');
      } catch (err) {
        if (!cancelled) setLoadError(diaryErrorMessage(err, 'Diary를 불러오지 못했습니다.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cls, date, session?.name]);

  // 자동저장: 마지막 입력 후 1.2초 뒤 저장.
  useEffect(() => {
    if (!doc || !dirtyRef.current) return;
    setSaveState('saving');
    const t = setTimeout(async () => {
      dirtyRef.current = false;
      try {
        await saveDiary(doc);
        setSaveState(dirtyRef.current ? 'saving' : 'saved');
      } catch {
        setSaveState('error');
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [doc]);

  const patchDoc = useCallback((fn: (d: DiaryDoc) => DiaryDoc) => {
    dirtyRef.current = true;
    setDoc((d) => (d ? fn(d) : d));
  }, []);

  const patchCommon = (patch: Partial<DiaryCommon>) => patchDoc((d) => ({ ...d, common: { ...d.common, ...patch } }));
  const patchEntry = (studentId: string, patch: Partial<DiaryEntry>) =>
    patchDoc((d) => ({ ...d, entries: d.entries.map((e) => (e.studentId === studentId ? { ...e, ...patch } : e)) }));

  function setOverride(e: DiaryEntry, key: 'progress' | 'homework' | 'message', value: string) {
    const common = doc!.common[key];
    patchEntry(e.studentId, { [key]: value === common ? null : value } as Partial<DiaryEntry>);
  }

  function toggleIndividual(on: boolean) {
    patchDoc((d) => ({
      ...d,
      common: { ...d.common, individualMode: on },
      entries: on
        ? d.entries.map((e) => ({
            ...e,
            course: e.course ?? lastStudentRef.current[e.studentId]?.course ?? null,
            textbook: e.textbook ?? lastStudentRef.current[e.studentId]?.textbook ?? null,
          }))
        : d.entries,
    }));
    if (on) setView('table');
  }

  function setCourseField(e: DiaryEntry, key: 'course' | 'textbook', value: string) {
    const common = doc!.common[key];
    patchEntry(e.studentId, { [key]: value === common ? null : value } as Partial<DiaryEntry>);
  }

  async function handleEntryAi(e: DiaryEntry) {
    if (!doc || !cls) return;
    setAiBusy(e.studentId);
    setAiError('');
    try {
      const text = await generateDailyComment({
        className: cls.name,
        progress: resolveField(e.progress, doc.common.progress),
        homework: resolveField(e.homework, doc.common.homework),
        tags: entryTags[e.studentId] ?? tags,
        studentName: e.studentName,
        attendance: e.attendance,
        hwPerformance: e.hwPerformance,
      });
      setOverride(e, 'message', text);
    } catch (err) {
      setAiError(`${e.studentName}: ${diaryErrorMessage(err, 'AI 초안 생성에 실패했습니다.')}`);
    } finally {
      setAiBusy('');
    }
  }

  async function handleAi() {
    if (!doc || !cls) return;
    setAiLoading(true);
    setAiError('');
    try {
      const text = await generateDailyComment({
        className: cls.name,
        progress: doc.common.progress,
        homework: doc.common.homework,
        tags,
      });
      patchCommon({ message: text });
    } catch (err) {
      setAiError(diaryErrorMessage(err, 'AI 초안 생성에 실패했습니다.'));
    } finally {
      setAiLoading(false);
    }
  }

  const phoneOf = (studentId: string) => (cls?.students.find((s) => s.id === studentId)?.parentPhone ?? '').trim();
  const included = doc?.entries.filter((e) => e.included) ?? [];
  const targets = included.filter((e) => phoneOf(e.studentId) && (resendSent || !e.sentAt));
  const sentCount = included.filter((e) => e.sentAt).length;
  const indiv = doc?.common.individualMode ?? false;
  const isMissing = (e: DiaryEntry) => indiv && !resolveField(e.progress, doc!.common.progress).trim();
  const noPhone = included.filter((e) => !phoneOf(e.studentId));

  function smsTextFor(e: DiaryEntry): string {
    return buildDiarySmsText({
      academyName: doc!.common.academyName,
      studentName: e.studentName,
      date: doc!.date,
      progress: resolveField(e.progress, doc!.common.progress),
      attendance: e.attendance,
      token: e.token,
    });
  }

  async function handleSend(test: boolean) {
    if (!doc) return;
    const list = test ? included.slice(0, 1) : targets;
    if (list.length === 0) {
      setSendMessage(test ? '테스트로 보낼 학생이 없습니다.' : '발송할 학생이 없습니다.');
      return;
    }
    if (!test) {
      const missing = list.filter(isMissing);
      const ask =
        missing.length > 0
          ? `진도가 작성되지 않은 학생이 ${missing.length}명 있습니다.\n(${missing.map((e) => e.studentName).join(', ')})\n\n그래도 ${list.length}명에게 발송하시겠습니까?`
          : `${list.length}명의 학부모에게 Diary 문자를 발송합니다. 계속할까요?`;
      if (!window.confirm(ask)) return;
    }

    setSending(true);
    setSendMessage('');
    try {
      dirtyRef.current = false;
      await saveDiary(doc); // 발송 직전 최신 내용·토큰이 DB에 있어야 링크가 열린다.
      let ok = 0;
      let fail = 0;
      const okTokens: string[] = [];
      for (const e of list) {
        const recipient = test
          ? { name: '테스트(원장님)', phone: TEACHER_NOTIFY_PHONE }
          : { name: `${e.studentName} 학부모님`, phone: phoneOf(e.studentId), studentId: e.studentId };
        try {
          const res = await sendBulkSms([recipient], smsTextFor(e));
          if (res.succeeded > 0) {
            ok += 1;
            okTokens.push(e.token);
          } else fail += 1;
        } catch {
          fail += 1;
        }
      }
      if (test) {
        setSendMessage(ok ? `원장님 번호(${TEACHER_NOTIFY_PHONE})로 ${list[0].studentName} 학생 Diary를 테스트 발송했습니다.` : '테스트 발송에 실패했습니다.');
      } else {
        await markDiarySent(okTokens);
        const now = new Date();
        const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        setDoc((d) =>
          d ? { ...d, entries: d.entries.map((e) => (okTokens.includes(e.token) ? { ...e, sentAt: stamp } : e)) } : d,
        );
        setSendMessage(`발송 완료: 성공 ${ok}명${fail ? ` · 실패 ${fail}명(발송 내역에서 확인)` : ''}`);
      }
    } catch (err) {
      setSendMessage(`발송 실패: ${diaryErrorMessage(err, '알 수 없는 오류')}`);
    } finally {
      setSending(false);
    }
  }

  const previewText = useMemo(() => {
    const first = included[0];
    return doc && first ? smsTextFor(first) : '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  function renderEditor(e: DiaryEntry) {
    const c = doc!.common;
    const custom = e.progress !== null || e.homework !== null || e.message !== null;
    return (
      <div className={styles.fields}>
        {indiv && (
          <div className={styles.g2}>
            <div>
              <label className={styles.lbl}>교재</label>
              <input className={styles.inp} value={e.textbook ?? c.textbook} onChange={(ev) => setCourseField(e, 'textbook', ev.target.value)} placeholder="이 학생 교재" />
            </div>
            <div>
              <label className={styles.lbl}>과정</label>
              <input className={styles.inp} value={e.course ?? c.course} onChange={(ev) => setCourseField(e, 'course', ev.target.value)} placeholder="이 학생 과정" />
            </div>
          </div>
        )}
        <label className={styles.lbl}>
          진도 {indiv ? <span className={styles.auto}>이 학생 진도</span> : <span className={styles.auto}>공통값 자동 · 수정하면 이 학생만 바뀜</span>}
          {isMissing(e) && <span className={styles.missing}>미작성</span>}
        </label>
        <textarea className={`${styles.ta} ${isMissing(e) ? styles.taMissing : ''}`} value={resolveField(e.progress, c.progress)} onChange={(ev) => setOverride(e, 'progress', ev.target.value)} />
        <label className={styles.lbl}>
          과제 {e.homework !== null && !indiv && <span className={styles.mod}>개별 수정</span>}
        </label>
        <textarea className={styles.ta} value={resolveField(e.homework, c.homework)} onChange={(ev) => setOverride(e, 'homework', ev.target.value)} />
        <label className={styles.lbl}>공지사항 및 전하는 말씀 <span className={styles.auto}>공통 초안 자동 · 이 학생만 수정/AI 개별 작성 가능</span></label>
        <div className={styles.tags}>
          {MOOD_TAGS.map((t) => {
            const cur = entryTags[e.studentId] ?? tags;
            return (
              <button
                key={t}
                type="button"
                className={`${styles.tag} ${cur.includes(t) ? styles.tagOn : ''}`}
                onClick={() => setEntryTags((p) => ({ ...p, [e.studentId]: cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t] }))}
              >
                {t}
              </button>
            );
          })}
        </div>
        <textarea className={styles.ta} value={resolveField(e.message, c.message)} onChange={(ev) => setOverride(e, 'message', ev.target.value)} />
        <div className={styles.row}>
          <button type="button" className={`${styles.btn} ${styles.btnGold}`} onClick={() => handleEntryAi(e)} disabled={aiBusy === e.studentId}>
            {aiBusy === e.studentId ? 'AI 작성 중…' : `✨ ${e.studentName} AI 개별 초안`}
          </button>
          {e.message !== null && (
            <button type="button" className={styles.linkBtn} onClick={() => patchEntry(e.studentId, { message: null })}>
              공통 말씀으로 되돌리기
            </button>
          )}
        </div>
        {custom && !indiv && (
          <button type="button" className={styles.linkBtn} onClick={() => patchEntry(e.studentId, { progress: null, homework: null, message: null })}>
            공통 내용으로 되돌리기
          </button>
        )}
      </div>
    );
  }

  function renderTable() {
    const c = doc!.common;
    return (
      <div className={styles.tableWrap}>
        <table className={styles.tbl}>
          <thead>
            <tr>
              <th>학생</th>
              {indiv && <th>교재 · 과정</th>}
              <th>진도</th>
              <th>과제</th>
              <th>전하는 말씀</th>
            </tr>
          </thead>
          <tbody>
            {included.map((e) => (
              <tr key={e.studentId} className={isMissing(e) ? styles.trMissing : ''}>
                <td>
                  <div className={styles.tdName}>
                    <span className={styles.nm}>{e.studentName}</span>
                    {statusBadge(e)}
                    {isMissing(e) && <span className={styles.missing}>진도 미작성</span>}
                    {sentBadge(e)}
                  </div>
                </td>
                {indiv && (
                  <td>
                    <input className={styles.inp} value={e.textbook ?? c.textbook} onChange={(ev) => setCourseField(e, 'textbook', ev.target.value)} placeholder="교재" />
                    <input className={`${styles.inp} ${styles.inpGap}`} value={e.course ?? c.course} onChange={(ev) => setCourseField(e, 'course', ev.target.value)} placeholder="과정" />
                  </td>
                )}
                <td>
                  <textarea className={`${styles.ta} ${styles.taCell} ${isMissing(e) ? styles.taMissing : ''}`} value={resolveField(e.progress, c.progress)} onChange={(ev) => setOverride(e, 'progress', ev.target.value)} />
                </td>
                <td>
                  <textarea className={`${styles.ta} ${styles.taCell}`} value={resolveField(e.homework, c.homework)} onChange={(ev) => setOverride(e, 'homework', ev.target.value)} />
                </td>
                <td>
                  <textarea className={`${styles.ta} ${styles.taCell}`} value={resolveField(e.message, c.message)} onChange={(ev) => setOverride(e, 'message', ev.target.value)} />
                  <button type="button" className={`${styles.btn} ${styles.btnGold} ${styles.btnSm}`} onClick={() => handleEntryAi(e)} disabled={aiBusy === e.studentId}>
                    {aiBusy === e.studentId ? '작성 중…' : '✨ AI 개별'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function statusBadge(e: DiaryEntry) {
    const cls2 = e.attendance === 'absent' ? styles.bAbs : e.attendance === 'late' ? styles.bLate : styles.bOk;
    return <span className={`${styles.badge} ${cls2}`}>{STATUS_LABEL[e.attendance]}</span>;
  }

  const customBadge = (e: DiaryEntry) =>
    !indiv && (e.progress !== null || e.homework !== null || e.message !== null) && <span className={`${styles.badge} ${styles.bMod}`}>개별 수정됨</span>;
  const sentBadge = (e: DiaryEntry) => e.sentAt && <span className={`${styles.badge} ${styles.bSent}`}>발송 {e.sentAt.slice(5)}</span>;

  return (
    <div className={styles.wrap}>
      <div className={styles.headerRow}>
        <h1 className={styles.pageTitle}>데일리 Diary</h1>
        <div className={styles.pageSub}>
          수업 후 오늘 진도·과제를 학부모에게 보냅니다. 입력은 자동저장되고, 문자에는 요약+링크만 나가며 상세 내용은 링크 페이지에서 보입니다.
          <span className={`${styles.saveState} ${styles[`s_${saveState}`]}`}>
            {saveState === 'saving' ? '저장 중…' : saveState === 'saved' ? '자동 저장됨 ✓' : saveState === 'error' ? '저장 실패 — 다시 입력해 주세요' : ''}
          </span>
        </div>
      </div>

      {loadError && <p className={styles.error}>{loadError}</p>}
      {!loadError && classes.length === 0 && !loading && <p className={styles.pageSub}>등록된 수업이 없습니다.</p>}

      {doc && (
        <div className={styles.grid}>
          <div>
            <div className={styles.card}>
              <div className={styles.g2}>
                <div>
                  <label className={styles.lbl0}>반</label>
                  <select className={styles.inp} value={classId} onChange={(e) => setClassId(e.target.value)}>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={styles.lbl0}>수업일</label>
                  <input type="date" className={styles.inp} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
                </div>
              </div>
              <div className={styles.g2}>
                <div>
                  <label className={styles.lbl}>학원명 <span className={styles.auto}>언제든 수정 · 이후 모든 Diary 기본값</span></label>
                  <input
                    className={styles.inp}
                    value={doc.common.academyName}
                    onChange={(e) => patchCommon({ academyName: e.target.value })}
                    onBlur={(e) => e.target.value.trim() && saveAcademyName(e.target.value).catch(() => undefined)}
                  />
                </div>
                <div>
                  <label className={styles.lbl}>선생님 표기</label>
                  <input className={styles.inp} value={doc.common.teacherName} onChange={(e) => patchCommon({ teacherName: e.target.value })} />
                </div>
              </div>
              {!indiv && (
              <div className={styles.g2}>
                <div>
                  <label className={styles.lbl}>과정 <span className={styles.auto}>다음 Diary에 자동 이어짐</span></label>
                  <input className={styles.inp} value={doc.common.course} onChange={(e) => patchCommon({ course: e.target.value })} placeholder="예: 미적분 심화" />
                </div>
                <div>
                  <label className={styles.lbl}>교재</label>
                  <input className={styles.inp} value={doc.common.textbook} onChange={(e) => patchCommon({ textbook: e.target.value })} placeholder="예: 실력정석 미적분" />
                </div>
              </div>
              )}

              <label className={styles.check} style={{ marginTop: 14 }}>
                <input type="checkbox" checked={indiv} onChange={(e) => toggleIndividual(e.target.checked)} />
                <b>개별진도반</b> — 학생마다 교재·진도·과제가 달라서 아래 표에서 학생별로 직접 입력
              </label>

              <label className={styles.lbl}>발송 대상 <span className={styles.auto}>눌러서 선택/해제 · 빨간 점 = 결석(결석도 같은 내용으로 발송)</span></label>
              <div className={styles.chips}>
                {doc.entries.map((e) => (
                  <button
                    key={e.studentId}
                    type="button"
                    className={`${styles.chip} ${e.included ? styles.chipOn : ''} ${e.attendance === 'absent' ? styles.chipAbs : ''}`}
                    onClick={() => patchEntry(e.studentId, { included: !e.included })}
                  >
                    {e.studentName}
                  </button>
                ))}
                {doc.entries.length === 0 && <span className={styles.auto}>이 반에 등록된 학생이 없습니다.</span>}
              </div>

              {!indiv && (
                <>
              <label className={styles.lbl}>오늘 진도 <span className={styles.common}>● 전원에게 공통 입력</span></label>
              <textarea className={styles.ta} value={doc.common.progress} onChange={(e) => patchCommon({ progress: e.target.value })} placeholder="예: 미적분 · 함수의 극한 유형별 문제 풀이" />
              <label className={styles.lbl}>과제 <span className={styles.common}>● 전원에게 공통 입력 (과제 인증에 오늘 등록한 과제가 있으면 자동으로 채워짐)</span></label>
              <textarea className={styles.ta} value={doc.common.homework} onChange={(e) => patchCommon({ homework: e.target.value })} />
                </>
              )}
              {indiv && <p className={styles.auto} style={{ marginTop: 12 }}>개별진도반: 진도·과제·교재는 아래 "학생별 확인 · 수정" 표에서 학생마다 입력하세요. 진도를 비워 둔 학생은 빨간색으로 표시되고, 발송할 때 한 번 더 확인합니다.</p>}

              <label className={styles.lbl}>공지사항 및 전하는 말씀 <span className={styles.common}>● 공통 AI 초안 · 학생 카드에서 개별 AI 작성도 가능</span></label>
              <div className={styles.tags}>
                {MOOD_TAGS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`${styles.tag} ${tags.includes(t) ? styles.tagOn : ''}`}
                    onClick={() => setTags((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]))}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <textarea className={styles.ta} value={doc.common.message} onChange={(e) => patchCommon({ message: e.target.value })} placeholder="비워 두면 학부모 화면에 표시되지 않습니다." />
              <div className={styles.row}>
                <button type="button" className={`${styles.btn} ${styles.btnGold}`} onClick={handleAi} disabled={aiLoading}>
                  {aiLoading ? 'AI 작성 중…' : '✨ AI 초안 쓰기'}
                </button>
                <span className={styles.auto}>위 태그를 고른 뒤 누르면 2~3문장 초안이 나옵니다. 수정해서 쓰세요.</span>
              </div>
              {aiError && <p className={styles.error}>{aiError}</p>}
            </div>

            <div className={styles.card} style={{ marginTop: 14 }}>
              <div className={styles.row}>
                <h2 className={styles.h2}>학생별 확인 · 수정</h2>
                <div className={styles.viewToggle}>
                  <button type="button" className={view === 'list' ? styles.vOn : ''} onClick={() => setView('list')}>접고 펼치기</button>
                  <button type="button" className={view === 'card' ? styles.vOn : ''} onClick={() => setView('card')}>카드 나열</button>
                  <button type="button" className={view === 'table' ? styles.vOn : ''} onClick={() => setView('table')}>표 입력</button>
                </div>
              </div>
              {view === 'table' ? (
                renderTable()
              ) : view === 'list' ? (
                <div>
                  {included.map((e) => (
                    <details key={e.studentId} className={styles.stu} open={e.attendance === 'absent'}>
                      <summary>
                        <span className={styles.nm}>{e.studentName}</span>
                        {statusBadge(e)}
                        {customBadge(e)}
                        {isMissing(e) && <span className={styles.missing}>진도 미작성</span>}
                        {sentBadge(e)}
                        <span className={styles.sp}>{e.hwPerformance ? `과제수행 ${e.hwPerformance}` : ''}</span>
                      </summary>
                      <div className={styles.stuBody}>{renderEditor(e)}</div>
                    </details>
                  ))}
                </div>
              ) : (
                <div className={styles.cards}>
                  {included.map((e) => (
                    <div key={e.studentId} className={`${styles.sc} ${e.attendance === 'absent' ? styles.scAbs : ''}`}>
                      <h4>
                        {e.studentName} {statusBadge(e)} {customBadge(e)} {isMissing(e) && <span className={styles.missing}>진도 미작성</span>} {sentBadge(e)}
                      </h4>
                      <div className={styles.auto}>{e.schoolGrade}{e.hwPerformance ? ` · 과제수행 ${e.hwPerformance}` : ''}</div>
                      {renderEditor(e)}
                    </div>
                  ))}
                </div>
              )}
              {included.length === 0 && <p className={styles.auto}>발송 대상이 선택되지 않았습니다.</p>}
            </div>
          </div>

          <div className={styles.side}>
            <div className={styles.card}>
              <h2 className={styles.h2}>발송 미리보기</h2>
              <div className={styles.auto}>문자 (학부모에게 가는 내용 · 첫 번째 학생 기준)</div>
              <div className={styles.bubble}>{previewText || '발송 대상을 선택하면 문자 미리보기가 나옵니다.'}</div>
              <p className={styles.auto} style={{ marginTop: 10 }}>
                링크를 열면 학부모용 Diary 페이지가 나오고, 같은 날 이 학생의 테스트 보고서가 있으면 버튼으로 함께 붙습니다.
              </p>
              {noPhone.length > 0 && (
                <p className={styles.warn}>학부모 번호 없음: {noPhone.map((e) => e.studentName).join(', ')} (발송 제외)</p>
              )}
              {sentCount > 0 && (
                <label className={styles.check}>
                  <input type="checkbox" checked={resendSent} onChange={(e) => setResendSent(e.target.checked)} />
                  이미 발송한 {sentCount}명도 다시 보내기
                </label>
              )}
              <div className={styles.sendbar}>
                <button type="button" className={`${styles.btn} ${styles.btnLine}`} onClick={() => handleSend(true)} disabled={sending || included.length === 0}>
                  내 번호로 테스트
                </button>
                <button type="button" className={`${styles.btn} ${styles.btnGreen}`} onClick={() => handleSend(false)} disabled={sending || targets.length === 0}>
                  {sending ? '발송 중…' : `${targets.length}명에게 발송`}
                </button>
              </div>
              {sendMessage && <p className={styles.msg}>{sendMessage}</p>}
            </div>
          </div>
        </div>
      )}

      {loading && <p className={styles.pageSub}>불러오는 중…</p>}
    </div>
  );
}
