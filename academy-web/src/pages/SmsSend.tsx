import { useEffect, useMemo, useState } from 'react';
import { fetchStudents } from '../lib/students';
import { sendBulkSms, fetchSmsSendLogs } from '../lib/smsSend';
import type { SendSmsResult, SkippedRecipient, SmsRecipient, SmsSendLog } from '../lib/smsSend';
import type { StudentProfile } from '../types/student';
import styles from './SmsSend.module.css';

// "SMS발송" — 독립 메뉴, 학부모/학생에게 공지나 개인 메시지를 자유롭게 보내는
// 화면(2026-09-01 사용자 요청). 기존 성적표/과제인증 링크 문자와 달리 내용을
// 그때그때 직접 적어서 보내는 용도라, 실수로 이상한 문자가 나가는 걸 막기
// 위해 (1) 보내기 전 브라우저 confirm으로 대상 수를 한 번 더 보여주고,
// (2) 아이폰 문자함처럼 미리보기를 보여줘서 "몇 자 적으면 이렇게 보이는구나"를
// 미리 가늠할 수 있게 했다. 실제 발송은 Solapi(send-sms Edge Function)를 통해서만
// 나가고, 그 Secret이 비어 있으면(dev 환경 기본값) 서버가 안전하게 에러로
// 막는다 — 지난번 일괄 발송 화면에서 실제 재원생에게 문자가 나갔던 사고 이후
// 정착된 방식.

const SMS_BYTE_LIMIT = 90; // 이 바이트 이하면 단문(SMS), 넘으면 장문(LMS)로 자동 전환됨(Solapi 기준)

function estimateSmsBytes(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    bytes += code > 0x7f ? 2 : 1;
  }
  return bytes;
}

function nowTimeLabel(): string {
  const d = new Date();
  const h = d.getHours();
  const period = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${period} ${h12}:${m}`;
}

function formatLogTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const period = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${period} ${h12}:${m}`;
}

const LOG_STATUS_LABEL: Record<SmsSendLog['status'], string> = {
  success: '성공',
  failed: '실패',
  skipped: '건너뜀',
};

type SectionKind = 'parent' | 'student';

export function SmsSend() {
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [selectedParentIds, setSelectedParentIds] = useState<Set<string>>(new Set());
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [messageText, setMessageText] = useState('');

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendResult, setSendResult] = useState<SendSmsResult | null>(null);

  const [logs, setLogs] = useState<SmsSendLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsError, setLogsError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        const data = await fetchStudents();
        if (!cancelled) setStudents(data);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : '학생 목록을 불러오지 못했습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadLogs() {
    setLogsLoading(true);
    setLogsError('');
    try {
      const data = await fetchSmsSendLogs(50);
      setLogs(data);
    } catch (e) {
      setLogsError(e instanceof Error ? e.message : '발송 내역을 불러오지 못했습니다.');
    } finally {
      setLogsLoading(false);
    }
  }

  useEffect(() => {
    loadLogs();
  }, []);

  const sortedStudents = useMemo(
    () => [...students].sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [students],
  );

  function toggle(kind: SectionKind, id: string) {
    const setState = kind === 'parent' ? setSelectedParentIds : setSelectedStudentIds;
    setState((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(kind: SectionKind) {
    const phoneOf = (s: StudentProfile) => (kind === 'parent' ? s.parentPhone : s.studentPhone);
    const eligible = sortedStudents.filter((s) => (phoneOf(s) ?? '').trim().length > 0);
    const setState = kind === 'parent' ? setSelectedParentIds : setSelectedStudentIds;
    const current = kind === 'parent' ? selectedParentIds : selectedStudentIds;
    const allSelected = eligible.length > 0 && eligible.every((s) => current.has(s.id));
    setState(allSelected ? new Set() : new Set(eligible.map((s) => s.id)));
  }

  const recipients: SmsRecipient[] = useMemo(() => {
    const list: SmsRecipient[] = [];
    for (const s of sortedStudents) {
      if (selectedParentIds.has(s.id) && (s.parentPhone ?? '').trim()) {
        list.push({ name: `${s.name} 학부모님`, phone: s.parentPhone });
      }
      if (selectedStudentIds.has(s.id) && (s.studentPhone ?? '').trim()) {
        list.push({ name: s.name, phone: s.studentPhone ?? '' });
      }
    }
    return list;
  }, [sortedStudents, selectedParentIds, selectedStudentIds]);

  const byteLength = estimateSmsBytes(messageText);
  const msgType = byteLength === 0 ? '' : byteLength <= SMS_BYTE_LIMIT ? '단문(SMS)' : '장문(LMS)';

  function resetSelection() {
    setSelectedParentIds(new Set());
    setSelectedStudentIds(new Set());
  }

  async function handleSend() {
    setSendError('');
    setSendResult(null);

    if (recipients.length === 0) {
      setSendError('받는 사람을 1명 이상 선택해주세요.');
      return;
    }
    if (!messageText.trim()) {
      setSendError('메시지 내용을 입력해주세요.');
      return;
    }

    const preview = recipients
      .slice(0, 8)
      .map((r) => r.name)
      .join(', ');
    const more = recipients.length > 8 ? ` 외 ${recipients.length - 8}명` : '';
    const ok = window.confirm(
      `${recipients.length}명에게 문자를 보냅니다.\n(${preview}${more})\n\n이 내용 그대로 실제로 발송됩니다. 계속할까요?`,
    );
    if (!ok) return;

    setSending(true);
    try {
      const result = await sendBulkSms(recipients, messageText.trim());
      setSendResult(result);
      loadLogs();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'SMS 발송 중 오류가 발생했습니다.');
    } finally {
      setSending(false);
    }
  }

  function renderSection(kind: SectionKind) {
    const title = kind === 'parent' ? '학부모에게 보내기' : '학생에게 보내기';
    const hint = kind === 'parent' ? '체크한 학생의 학부모 번호로 전송됩니다.' : '체크한 학생 본인 번호로 전송됩니다.';
    const selected = kind === 'parent' ? selectedParentIds : selectedStudentIds;
    const phoneOf = (s: StudentProfile) => (kind === 'parent' ? s.parentPhone : s.studentPhone) ?? '';

    return (
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionTitle}>{title}</div>
            <div className={styles.sectionHint}>{hint}</div>
          </div>
          <button type="button" className={styles.selectAllButton} onClick={() => toggleAll(kind)}>
            전체 선택/해제
          </button>
        </div>
        <div className={styles.studentList}>
          {sortedStudents.map((s) => {
            const phone = phoneOf(s);
            const disabled = !phone.trim();
            const checked = selected.has(s.id);
            return (
              <label
                key={s.id}
                className={styles.studentRow}
                data-disabled={disabled}
                data-checked={checked}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(kind, s.id)}
                />
                <span className={styles.studentName}>{s.name}</span>
                <span className={styles.studentMeta}>{s.className}</span>
                <span className={styles.studentPhone}>{disabled ? '번호 없음' : phone}</span>
              </label>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>SMS발송</h1>
      <p className={styles.caption}>학부모·학생에게 공지나 개인 메시지를 자유롭게 작성해서 보냅니다.</p>

      {loading && <div className={styles.card}>학생 목록을 불러오는 중입니다…</div>}
      {loadError && <div className={styles.errorText}>{loadError}</div>}

      {!loading && !loadError && (
        <div className={styles.layout}>
          <div className={styles.card}>
            {renderSection('parent')}
            <div className={styles.sectionDivider} />
            {renderSection('student')}

            <div className={styles.selectionSummary}>
              <span>
                선택된 받는 사람 <strong>{recipients.length}명</strong>
              </span>
              <button type="button" className={styles.resetButton} onClick={resetSelection}>
                선택 초기화
              </button>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.sectionTitle}>메시지 작성</div>
            <textarea
              className={styles.textarea}
              placeholder="여기에 보낼 내용을 입력하세요. (예: 안녕하세요, ○○학원입니다. ...)"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              rows={6}
            />
            <div className={styles.byteInfo}>
              {byteLength}바이트{msgType && ` · ${msgType} 예상`}
              {byteLength > SMS_BYTE_LIMIT && (
                <span className={styles.byteWarn}> (90바이트 초과 — 장문 문자로 자동 전환되어 발송됩니다)</span>
              )}
            </div>

            <div className={styles.phoneMock}>
              <div className={styles.phoneNotch} />
              <div className={styles.phoneStatusBar}>
                <span>{nowTimeLabel()}</span>
              </div>
              <div className={styles.phoneHeader}>문자 메시지</div>
              <div className={styles.phoneBody}>
                {messageText.trim() ? (
                  <div className={styles.bubbleRow}>
                    <div className={styles.bubble}>{messageText}</div>
                  </div>
                ) : (
                  <div className={styles.bubblePlaceholder}>메시지를 입력하면 여기에 미리보기가 표시됩니다</div>
                )}
              </div>
            </div>

            <button
              type="button"
              className={styles.sendButton}
              onClick={handleSend}
              disabled={sending || recipients.length === 0 || !messageText.trim()}
            >
              {sending ? '발송 중…' : `${recipients.length > 0 ? recipients.length + '명에게 ' : ''}문자 보내기`}
            </button>

            {sendError && <div className={styles.errorText}>{sendError}</div>}
            {sendResult && <SendResultView result={sendResult} />}
          </div>
        </div>
      )}

      <div className={styles.card} style={{ marginTop: 20 }}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionTitle}>발송 내역</div>
            <div className={styles.sectionHint}>최근 50건 · 보낸 날짜/시간, 받는 사람, 성공 여부를 확인할 수 있습니다.</div>
          </div>
          <button type="button" className={styles.selectAllButton} onClick={loadLogs} disabled={logsLoading}>
            {logsLoading ? '불러오는 중...' : '새로고침'}
          </button>
        </div>

        {logsError && <div className={styles.errorText}>{logsError}</div>}

        {!logsLoading && !logsError && logs.length === 0 && (
          <p className={styles.sectionHint}>아직 발송 내역이 없습니다.</p>
        )}

        {logs.length > 0 && (
          <div className={styles.logTableWrap}>
            <table className={styles.logTable}>
              <thead>
                <tr>
                  <th>보낸 일시</th>
                  <th>받는 사람</th>
                  <th>번호</th>
                  <th>상태</th>
                  <th>내용</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className={styles.logTimeCell}>{formatLogTime(log.sentAt)}</td>
                    <td>{log.recipientName ?? '—'}</td>
                    <td className={styles.logTimeCell}>{log.recipientPhone}</td>
                    <td>
                      <span className={styles.logStatusBadge} data-status={log.status}>
                        {LOG_STATUS_LABEL[log.status]}
                      </span>
                    </td>
                    <td className={styles.logMessageCell}>{log.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SendResultView({ result }: { result: SendSmsResult }) {
  return (
    <div className={styles.resultBox}>
      <div className={styles.resultLine}>
        요청 {result.requested}건 · 성공 {result.succeeded}건 · 실패 {result.failed}건
      </div>
      {result.skipped.length > 0 && (
        <div className={styles.skippedBox}>
          <div className={styles.skippedTitle}>보내지 못한 대상 ({result.skipped.length}건)</div>
          <ul className={styles.skippedList}>
            {result.skipped.map((s: SkippedRecipient, i: number) => (
              <li key={i}>
                {s.name ?? '이름 없음'} — {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
