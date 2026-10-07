import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { diaryErrorMessage, fetchPublicDiary, markDiaryViewed, type PublicDiary } from '../lib/dailyDiary';
import { PARENT_REPORT_BASE_URL } from '../lib/reportLinks';
import styles from './ParentDiary.module.css';

const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

function dateLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')} (${WEEKDAYS_KO[d.getDay()]})`;
}

/**
 * 학부모용 데일리 Diary 페이지 — 문자로 받은 링크(?token=)로 로그인 없이 접속.
 * 결석 학생도 같은 내용이 보이고 출석 칸만 '결석'으로 표시된다. 같은 날 테스트 보고서(report_links)가
 * 있으면 이름 붙은 버튼으로 /parent-report 페이지에 연결된다.
 */
export function ParentDiary() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [diary, setDiary] = useState<PublicDiary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setError('링크가 올바르지 않습니다. 문자로 받은 링크를 다시 확인해 주세요.');
        setLoading(false);
        return;
      }
      try {
        const d = await fetchPublicDiary(token);
        if (cancelled) return;
        if (!d) setError('Diary를 찾을 수 없습니다. 학원으로 문의해 주세요.');
        else {
          setDiary(d);
          markDiaryViewed(token).catch(() => undefined);
        }
      } catch (err) {
        if (!cancelled) setError(diaryErrorMessage(err, 'Diary를 불러오지 못했습니다.'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) return <div className={styles.page}><p className={styles.status}>불러오는 중…</p></div>;
  if (error || !diary) return <div className={styles.page}><p className={styles.status}>{error || 'Diary를 찾을 수 없습니다.'}</p></div>;

  const absent = diary.attendance === 'absent';
  const attLabel = { present: '출석', late: '지각', absent: '결석', cancelled: '휴강' }[diary.attendance];
  const courseText = [diary.course, diary.textbook].filter(Boolean).join(' · ');

  return (
    <div className={styles.page}>
      <div className={styles.diary}>
        <div className={styles.head}>
          <small>{diary.academyName} · MATH DIARY</small>
          <h1>{diary.studentName} 학생</h1>
          <div className={styles.meta}>
            <span>{dateLabel(diary.date)}</span>
            <span>{[diary.schoolGrade, diary.className].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
        <div className={styles.body}>
          {absent && (
            <div className={styles.absentNote}>
              오늘 수업에 결석했습니다. 아래는 오늘 수업에서 다룬 내용입니다. 보충이 필요하거나 보강일정 조율은 상의 후 결정하겠습니다.
            </div>
          )}
          <div className={styles.stat}>
            <div className={absent ? styles.statAbs : ''}>
              <small>출석</small>
              <b>{attLabel}</b>
            </div>
            <div>
              <small>과제 수행</small>
              <b>{diary.hwPerformance || '—'}</b>
            </div>
          </div>

          {courseText && <Section title="과정 · 교재" text={courseText} />}
          {diary.progress.trim() && <Section title="오늘 진도" text={diary.progress} />}
          {diary.homework.trim() && <Section title="다음 과제" text={diary.homework} />}
          {diary.message.trim() && <Section title="공지사항 및 전하는 말씀" text={diary.message} highlight />}

          {diary.reports.length > 0 && (
            <div className={styles.sec}>
              <h3>오늘의 테스트</h3>
              {diary.reports.map((r) => (
                <a key={r.token} className={styles.report} href={`${PARENT_REPORT_BASE_URL}?token=${r.token}`}>
                  <span>📄</span>
                  <span>
                    <b>{r.label} 보기</b>
                  </span>
                  <i>›</i>
                </a>
              ))}
            </div>
          )}

          {diary.past.length > 0 && (
            <div className={styles.sec}>
              <h3>지난 Diary</h3>
              <ul className={styles.past}>
                {diary.past.map((p) => (
                  <li key={p.token}>
                    <a href={`?token=${p.token}`}>
                      <b>{dateLabel(p.date)}</b>
                      <span>{p.progress.split('\n')[0]}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className={styles.foot}>
          {[diary.teacherName && `${diary.teacherName} 선생님`, diary.academyName].filter(Boolean).join(' · ')}
        </div>
      </div>
    </div>
  );
}

function Section({ title, text, highlight }: { title: string; text: string; highlight?: boolean }) {
  return (
    <div className={styles.sec}>
      <h3>{title}</h3>
      <p className={highlight ? styles.msg : ''}>{text}</p>
    </div>
  );
}
